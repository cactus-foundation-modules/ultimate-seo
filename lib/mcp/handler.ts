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
  stringParam,
  textResult,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './protocol'
import { getPageMarkdown, getSiteInfo, listSections, searchSite, toolDefinitions } from './tools'

const ENTITY_TYPE_VALUES = new Set([
  'core-page', 'gazette-post', 'shop-product', 'shop-category',
  'shop-collection', 'filter-collection', 'directory-entry',
])

export type McpContext = {
  siteName: string
  siteUrl: string
  maxResults: number
}

function formatHits(hits: Awaited<ReturnType<typeof searchSite>>, siteUrl: string): string {
  if (hits.length === 0) return 'Nothing on this site matches that.'
  return hits
    .map((hit) => {
      const url = `${siteUrl}/${hit.path === 'index' ? '' : hit.path}`.replace(/\/$/, '') || siteUrl
      const summary = hit.summary ? `\n  ${hit.summary}` : ''
      return `- ${hit.title} (${hit.kind})\n  ${url}\n  Markdown: ${siteUrl}/${hit.path}.md${summary}`
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
    case 'get_page': {
      const path = stringParam(params, 'path')
      if (!path) return textResult('Give me the address of a page.', true)
      const markdown = await getPageMarkdown(path)
      return markdown
        ? textResult(markdown)
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
      return textResult(info ?? `${ctx.siteName} has not published its business details.`)
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
        instructions: `Read-only access to everything ${ctx.siteName} publishes. Start with get_site_info to learn who runs this site and where it trades, then list_sections, then search_site, then get_page for the full text of anything worth reading.`,
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
