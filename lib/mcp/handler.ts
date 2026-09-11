// Dispatching one MCP message.
//
// Split out from the route so the whole protocol can be exercised without an
// HTTP server: every branch below is a plain function of its input.

import {
  DEFAULT_PROTOCOL_VERSION,
  RPC_INVALID_PARAMS,
  RPC_METHOD_NOT_FOUND,
  fail,
  numberParam,
  ok,
  optionalNumberParam,
  stringParam,
  textResult,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './protocol'
import { absolutiseMarkdown } from '../ai/absolutise'
import { findProducts, getPageMarkdown, getSiteInfo, listSections, searchSite, toolDefinitions, type ProductFilter, type SearchHit } from './tools'
import { PRODUCT_AVAILABILITY, type ProductAvailability } from '../types'

const ENTITY_TYPE_VALUES = new Set([
  'core-page', 'gazette-post', 'shop-product', 'shop-category',
  'shop-collection', 'filter-collection', 'directory-entry',
])

export type McpContext = {
  siteName: string
  siteUrl: string
  /** The owner's one-paragraph description of the business, as llms.txt opens with. */
  siteSummary: string
  maxResults: number
}

const AVAILABILITY_LABEL: Record<ProductAvailability, string> = {
  'in-stock': 'In stock',
  'made-to-order': 'Made to order',
  'pre-order': 'Available to pre-order',
  backorder: 'On backorder',
  'out-of-stock': 'Out of stock',
}

/**
 * The price and the stock on the hit itself, rather than buried in the summary.
 *
 * An agent comparing three shops compares the numbers it was handed. Making it
 * fetch each product's Markdown to find out what the thing costs is three extra
 * round trips it will not make.
 */
function facetLine(hit: SearchHit): string {
  const facets = hit.facets
  if (!facets) return ''
  const parts: string[] = []
  if (facets.priceMin !== null) {
    const money = (n: number) => `${facets.currency} ${n.toFixed(2)}`
    const price = facets.priceMax !== null && facets.priceMax > facets.priceMin
      ? `${money(facets.priceMin)} to ${money(facets.priceMax)}`
      : money(facets.priceMin)
    parts.push(facets.priceSuffix ? `${price} ${facets.priceSuffix}` : price)
  }
  parts.push(AVAILABILITY_LABEL[facets.availability])
  return `\n  ${parts.join(' - ')}`
}

function formatHits(hits: Awaited<ReturnType<typeof searchSite>>, siteUrl: string): string {
  // Not a full stop. An agent told only "nothing matches" concludes the site
  // does not sell the thing and goes elsewhere; told where to look next, it
  // asks a second question, which is the whole point of having an endpoint.
  if (hits.length === 0) {
    return 'Nothing on this site matches that. Try fewer or different words, list_sections to see what is published, or get_site_info for what this business does.'
  }
  return hits
    .map((hit) => {
      const url = `${siteUrl}/${hit.path === 'index' ? '' : hit.path}`.replace(/\/$/, '') || siteUrl
      const summary = hit.summary ? `\n  ${hit.summary}` : ''
      return `- ${hit.title} (${hit.kind})\n  ${url}\n  Markdown: ${siteUrl}/${hit.path}.md${facetLine(hit)}${summary}`
    })
    .join('\n')
}

async function callTool(name: string, params: Record<string, unknown> | undefined, ctx: McpContext): Promise<unknown> {
  switch (name) {
    case 'search_site': {
      const query = stringParam(params, 'query')
      if (!query) return textResult('Give me something to search for.', true)
      const rawType = stringParam(params, 'type')
      const type = ENTITY_TYPE_VALUES.has(rawType) ? rawType : null
      const limit = numberParam(params, 'limit', Math.min(10, ctx.maxResults), ctx.maxResults)
      return textResult(formatHits(await searchSite(query, type, limit), ctx.siteUrl))
    }
    case 'find_products': {
      const rawSort = stringParam(params, 'sort')
      const rawAvailability = stringParam(params, 'availability')
      const filter: ProductFilter = {
        query: stringParam(params, 'query'),
        category: stringParam(params, 'category'),
        minPrice: optionalNumberParam(params, 'min_price'),
        maxPrice: optionalNumberParam(params, 'max_price'),
        availability: (PRODUCT_AVAILABILITY as readonly string[]).includes(rawAvailability)
          ? (rawAvailability as ProductAvailability)
          : null,
        sort: rawSort === 'price-low-to-high' || rawSort === 'price-high-to-low' ? rawSort : 'relevance',
      }
      const limit = numberParam(params, 'limit', Math.min(10, ctx.maxResults), ctx.maxResults)
      const hits = await findProducts(filter, limit)
      if (hits.length === 0) {
        // Which filter did the damage is the one thing the caller cannot see,
        // and the difference between "loosen the budget" and "this shop sells
        // nothing of the kind" decides whether it asks again or goes elsewhere.
        return textResult('Nothing in the catalogue matches all of that. Try a wider price range, drop the category, or use search_site for a plain text search.')
      }
      return textResult(formatHits(hits, ctx.siteUrl))
    }
    case 'get_page': {
      const path = stringParam(params, 'path')
      if (!path) return textResult('Give me the address of a page.', true)
      const markdown = await getPageMarkdown(path)
      // Absolute addresses: a tool result is text with no page around it, and an
      // agent that quotes `/office-desks` back to somebody has quoted nothing.
      return markdown
        ? textResult(absolutiseMarkdown(markdown, ctx.siteUrl))
        : textResult(`This site has no page at ${path}.`, true)
    }
    case 'list_sections': {
      const sections = await listSections()
      // Not "this site publishes nothing". The site is full of pages; it is the
      // agent-readable copies of them that have not been built yet, and telling a
      // caller the business is empty when it is not is the worst answer available.
      if (sections.length === 0) {
        return textResult(`No agent-readable copies of this site's pages have been built yet. Read ${ctx.siteUrl} directly, or try get_site_info.`)
      }
      return textResult(sections.map((s) => `- ${s.kind}: ${s.count}`).join('\n'))
    }
    case 'get_site_info': {
      const info = await getSiteInfo()
      // What the business sells, above who it is. An agent weighing up whether
      // to name somebody needs both, and a company number is no use to it until
      // it knows the company is in the right trade.
      const summary = ctx.siteSummary.trim()
      const parts = [summary ? `What this site is: ${summary}` : null, info].filter(Boolean)
      return textResult(parts.length ? parts.join('\n\n') : `${ctx.siteName} has not published its business details.`)
    }
    default:
      return null
  }
}

/** Answers one message, or returns null for a notification that needs no answer. */
export async function handleMcpRequest(request: JsonRpcRequest, ctx: McpContext): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null

  switch (request.method) {
    case 'initialize': {
      const asked = request.params?.protocolVersion
      return ok(id, {
        // Echo the version the client asked for when it named one: an agent
        // built against an older revision is better served by being answered in
        // it than by being told a number it does not recognise.
        protocolVersion: typeof asked === 'string' && asked ? asked : DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: `${ctx.siteName} (Cactus)`, version: '1.0.0' },
        // The summary goes in the handshake as well as in get_site_info: a client
        // that only ever reads `instructions` still learns what this site sells.
        instructions: [
          `Read-only access to everything ${ctx.siteName} publishes.`,
          ctx.siteSummary.trim(),
          'Start with get_site_info to learn who runs this site and where it trades, then list_sections, then search_site, then get_page for the full text of anything worth reading. Where the question carries a budget, a deadline or a category, use find_products rather than search_site.',
        ].filter(Boolean).join(' '),
      })
    }

    // Sent by a client once it has finished starting up. No answer expected.
    case 'notifications/initialized':
      return null

    case 'ping':
      return ok(id, {})

    case 'tools/list':
      return ok(id, { tools: toolDefinitions(ctx.maxResults) })

    case 'tools/call': {
      const name = stringParam(request.params, 'name')
      if (!name) return fail(id, RPC_INVALID_PARAMS, 'No tool named')
      const args = request.params?.arguments
      const result = await callTool(name, args && typeof args === 'object' ? args as Record<string, unknown> : undefined, ctx)
      return result === null
        ? fail(id, RPC_METHOD_NOT_FOUND, `No such tool: ${name}`)
        : ok(id, result)
    }

    // Declared in no capability, so a well-behaved client never asks. Answered
    // as empty lists rather than errors because some ask anyway on connect, and
    // an error there reads to them as a broken server.
    case 'resources/list':
      return ok(id, { resources: [] })
    case 'prompts/list':
      return ok(id, { prompts: [] })

    default:
      return fail(id, RPC_METHOD_NOT_FOUND, `Unsupported method: ${request.method}`)
  }
}
