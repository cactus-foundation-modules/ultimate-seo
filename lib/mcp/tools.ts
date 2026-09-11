// The tools the agent endpoint offers, and what they do.
//
// Every one of them reads the materialised Markdown twins and nothing else. So
// an agent can only ever see what the site already publishes to anybody with a
// browser, the answers cost one indexed query each, and there is no second
// definition of "what this site says" to drift out of step with the first.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { businessFactsText } from '../ai/business-facts'
import { ENTITY_KIND_LABEL } from '../ai/documents'
import { normaliseStructuredData } from '../settings'
import type { EntityType, ProductAvailability, ProductFacets } from '../types'

export type ToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export function toolDefinitions(maxResults: number): ToolDefinition[] {
  return [
    {
      name: 'search_site',
      description: 'Search everything this site publishes - pages, products, categories, collections and blog posts. Returns titles, addresses and one-line summaries.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to look for.' },
          type: {
            type: 'string',
            description: 'Optional. Narrow to one kind of content.',
            enum: ['core-page', 'gazette-post', 'shop-product', 'shop-category', 'shop-collection', 'filter-collection', 'directory-entry'],
          },
          limit: { type: 'number', description: `How many results, up to ${maxResults}.` },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_page',
      description: 'Fetch one page in full, as Markdown. Takes the address as it appears on the site, with or without a leading slash.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: "The page address, e.g. 'shop/products/task-chair'. Use 'index' for the home page." } },
        required: ['path'],
      },
    },
    {
      name: 'list_sections',
      description: 'List what kinds of content this site publishes and how much of each. A good first call before searching.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      // The one tool that does something llms.txt cannot. An index of four
      // hundred products answers "what do you sell"; it does not answer "an
      // office chair under £250 I can have this week", which is the question
      // somebody actually asked their assistant. A reader that has to fetch the
      // whole catalogue to work that out fetches somebody else's instead.
      name: 'find_products',
      description: 'Find products by price, availability and category - the filtered version of search_site. Use this for any question with a budget, a deadline or a shelf in it ("office chairs under £250 that are in stock"). Prices are exactly as the shop publishes them; read the note that comes back with each one.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional words to match, as in search_site. Leave it out to browse a category or a price band on its own.' },
          category: { type: 'string', description: 'Optional. A category or collection, by the name or the address it uses on the site.' },
          min_price: { type: 'number', description: 'Optional. Lowest price to include, in the shop\'s own currency.' },
          max_price: { type: 'number', description: 'Optional. Highest price to include.' },
          availability: {
            type: 'string',
            description: 'Optional. Narrow to what can be had on these terms.',
            enum: ['in-stock', 'made-to-order', 'pre-order', 'backorder', 'out-of-stock'],
          },
          sort: {
            type: 'string',
            description: 'Optional. Default is best match.',
            enum: ['relevance', 'price-low-to-high', 'price-high-to-low'],
          },
          limit: { type: 'number', description: `How many results, up to ${maxResults}.` },
        },
      },
    },
    {
      // Named for what a caller wants rather than for where it comes from. An
      // agent weighing up whether to recommend this business is asking "who are
      // these people" - not "show me the structured-data profile".
      name: 'get_site_info',
      description: 'Who runs this site: legal name, company registration, VAT number, address, the countries it sells to, and how to contact a human. Call this before recommending or quoting the business to anybody.',
      inputSchema: { type: 'object', properties: {} },
    },
  ]
}

export type SearchHit = {
  path: string
  title: string
  summary: string | null
  kind: string
  /** Present on a product whose twin has been rebuilt since facets existed. */
  facets: ProductFacets | null
}

/** A document's facets column, or null for anything that is not a product. */
function productFacets(raw: unknown): ProductFacets | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const facets = raw as Partial<ProductFacets>
  return facets.kind === 'product' ? (facets as ProductFacets) : null
}

// Words that carry no meaning on their own. A search for "a desk with drawers"
// must not be scored on how often "a" and "with" appear, and on a catalogue
// every document contains both.
const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'about', 'all', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'best', 'but', 'by',
  'can', 'do', 'does', 'for', 'from', 'get', 'good', 'has', 'have', 'how', 'i', 'if', 'in', 'into',
  'is', 'it', 'its', 'me', 'my', 'need', 'of', 'on', 'one', 'or', 'our', 'out', 'please', 'show',
  'some', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to', 'up',
  'want', 'was', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would',
  'you', 'your',
])

// Enough to describe what somebody is after, few enough that the query stays one
// pass over the table. A sentence longer than this is a sentence whose first six
// meaningful words already said it.
const MAX_TOKENS = 6

/**
 * The words worth searching for in a question.
 *
 * An agent does not send keywords, it sends what its user said - "a desk with
 * drawers for a small room". Matching that as one string finds nothing, which
 * the caller reads as "this site sells no desks" rather than as "ask again
 * differently", and moves on to a site that answered.
 */
export function searchTokens(query: string): string[] {
  const seen = new Set<string>()
  const tokens: string[] = []
  // Currency and percent signs survive: "50%" and "£100" are things people
  // search a shop for, and splitting them apart loses the question.
  for (const raw of query.toLowerCase().split(/[^a-z0-9\u00a3$%.+-]+/)) {
    const token = raw.replace(/^[.+-]+/, '').replace(/[.+-]+$/, '')
    if (token.length < 2) continue
    if (STOP_WORDS.has(token)) continue
    if (seen.has(token)) continue
    seen.add(token)
    tokens.push(token)
    if (tokens.length === MAX_TOKENS) break
  }
  return tokens
}

// % and _ are wildcards in LIKE. A search for "50%" must look for "50%".
function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/**
 * Search across the twins.
 *
 * Two passes in one query. The whole phrase is what was actually asked, so it
 * scores far above anything else; the individual words are the fallback that
 * keeps a natural-language question from coming back empty, weighted by where
 * each one turns up and added together so a document matching three of them
 * outranks one matching a single word in its title.
 *
 * A plain ILIKE rather than Postgres full-text: it needs no index this module
 * does not already have, it behaves the same on every install, and at the size a
 * Cactus site reaches the difference is not measurable. If that stops being
 * true, this is the one function to change.
 */
export async function searchSite(query: string, type: string | null, limit: number): Promise<SearchHit[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const phrase = likePattern(trimmed)
  const tokens = searchTokens(trimmed)

  const tokenScore = tokens.length
    ? Prisma.join(
      tokens.map((token) => {
        const p = likePattern(token)
        return Prisma.sql`(CASE
          WHEN "title" ILIKE ${p} ESCAPE '\\' THEN 5
          WHEN "summary" ILIKE ${p} ESCAPE '\\' THEN 3
          WHEN "markdown" ILIKE ${p} ESCAPE '\\' THEN 2
          ELSE 0 END)`
      }),
      ' + '
    )
    : Prisma.sql`0`

  const tokenMatch = tokens.length
    ? Prisma.join(
      tokens.map((token) => {
        const p = likePattern(token)
        return Prisma.sql`("title" ILIKE ${p} ESCAPE '\\' OR "summary" ILIKE ${p} ESCAPE '\\' OR "markdown" ILIKE ${p} ESCAPE '\\')`
      }),
      ' OR '
    )
    : Prisma.sql`FALSE`

  const rows = await prisma.$queryRaw<Array<{ path: string; title: string; summary: string | null; entity_type: string; facets: unknown }>>`
    SELECT "path", "title", "summary", "entity_type", "facets",
      (CASE WHEN "title" ILIKE ${phrase} ESCAPE '\\' THEN 100 ELSE 0 END)
      + (CASE WHEN "summary" ILIKE ${phrase} ESCAPE '\\' THEN 40 ELSE 0 END)
      + (CASE WHEN "markdown" ILIKE ${phrase} ESCAPE '\\' THEN 20 ELSE 0 END)
      + (${tokenScore}) AS score
    FROM "seo_llm_documents"
    WHERE (${type}::text IS NULL OR "entity_type" = ${type})
      AND (
        "title" ILIKE ${phrase} ESCAPE '\\'
        OR "summary" ILIKE ${phrase} ESCAPE '\\'
        OR "markdown" ILIKE ${phrase} ESCAPE '\\'
        OR (${tokenMatch})
      )
    ORDER BY score DESC, "title" ASC
    LIMIT ${Prisma.sql`${limit}`}
  `

  return rows.map((r) => ({
    path: r.path,
    title: r.title,
    summary: r.summary,
    kind: ENTITY_KIND_LABEL[r.entity_type as EntityType] ?? r.entity_type,
    facets: productFacets(r.facets),
  }))
}

// ---------------------------------------------------------------------------
// find_products
// ---------------------------------------------------------------------------

export type ProductFilter = {
  query: string
  category: string
  minPrice: number | null
  maxPrice: number | null
  availability: ProductAvailability | null
  sort: 'relevance' | 'price-low-to-high' | 'price-high-to-low'
}

/**
 * The catalogue, narrowed.
 *
 * Reads the same twins search_site does, plus the facets column built alongside
 * them - so a filtered answer and a searched one can never describe the same
 * product differently. Every clause is optional: no filters at all is a
 * perfectly good request ("what do you sell, cheapest first").
 *
 * Price comparisons are done in SQL against the facet rather than in TypeScript
 * over the whole table, which is what the price index on the column is for.
 */
export async function findProducts(filter: ProductFilter, limit: number): Promise<SearchHit[]> {
  const trimmed = filter.query.trim()
  const tokens = trimmed ? searchTokens(trimmed) : []
  const phrase = trimmed ? likePattern(trimmed) : null

  // Relevance, when there are words to be relevant to. Without them every row
  // scores the same and the sort below falls through to the title.
  const score = trimmed
    ? Prisma.sql`(CASE WHEN "title" ILIKE ${phrase} ESCAPE '\\' THEN 100 ELSE 0 END)
        + (CASE WHEN "summary" ILIKE ${phrase} ESCAPE '\\' THEN 40 ELSE 0 END)
        + (CASE WHEN "markdown" ILIKE ${phrase} ESCAPE '\\' THEN 20 ELSE 0 END)
        + ${tokens.length
          ? Prisma.join(tokens.map((token) => {
            const p = likePattern(token)
            return Prisma.sql`(CASE
              WHEN "title" ILIKE ${p} ESCAPE '\\' THEN 5
              WHEN "summary" ILIKE ${p} ESCAPE '\\' THEN 3
              WHEN "markdown" ILIKE ${p} ESCAPE '\\' THEN 2
              ELSE 0 END)`
          }), ' + ')
          : Prisma.sql`0`}`
    : Prisma.sql`0`

  const where: Prisma.Sql[] = [
    Prisma.sql`"entity_type" = 'shop-product'`,
    // A product whose twin predates this column has no price to filter on, and
    // silently ranking it alongside the ones that do would hand an agent a
    // "£250 or less" list with unpriced entries in it.
    Prisma.sql`"facets" IS NOT NULL`,
  ]

  if (trimmed) {
    const clauses: Prisma.Sql[] = [
      Prisma.sql`"title" ILIKE ${phrase} ESCAPE '\\'`,
      Prisma.sql`"summary" ILIKE ${phrase} ESCAPE '\\'`,
      Prisma.sql`"markdown" ILIKE ${phrase} ESCAPE '\\'`,
      ...tokens.map((token) => {
        const p = likePattern(token)
        return Prisma.sql`("title" ILIKE ${p} ESCAPE '\\' OR "summary" ILIKE ${p} ESCAPE '\\' OR "markdown" ILIKE ${p} ESCAPE '\\')`
      }),
    ]
    where.push(Prisma.sql`(${Prisma.join(clauses, ' OR ')})`)
  }

  const category = filter.category.trim().toLowerCase()
  if (category) {
    // Containment at the top level rather than `"facets" -> 'groups' @> …`, so
    // the GIN index on the column is actually usable: jsonb_path_ops indexes the
    // whole document, and a query that digs a key out first cannot reach it.
    // The groups array holds both the name and the slug of every shelf, so
    // "office chairs" and "office-chairs" both land.
    where.push(Prisma.sql`"facets" @> ${JSON.stringify({ groups: [category] })}::jsonb`)
  }
  if (filter.minPrice !== null) {
    where.push(Prisma.sql`("facets" ->> 'priceMax')::numeric >= ${filter.minPrice}`)
  }
  if (filter.maxPrice !== null) {
    // Against the LOW end: a listing running £200 to £400 does belong in an
    // answer to "under £250", because £250 buys one.
    where.push(Prisma.sql`("facets" ->> 'priceMin')::numeric <= ${filter.maxPrice}`)
  }
  if (filter.availability) {
    where.push(Prisma.sql`"facets" ->> 'availability' = ${filter.availability}`)
  }

  const order = filter.sort === 'price-low-to-high'
    ? Prisma.sql`("facets" ->> 'priceMin')::numeric ASC NULLS LAST, "title" ASC`
    : filter.sort === 'price-high-to-low'
      ? Prisma.sql`("facets" ->> 'priceMax')::numeric DESC NULLS LAST, "title" ASC`
      : Prisma.sql`score DESC, ("facets" ->> 'priceMin')::numeric ASC NULLS LAST, "title" ASC`

  const rows = await prisma.$queryRaw<Array<{ path: string; title: string; summary: string | null; entity_type: string; facets: unknown }>>`
    SELECT "path", "title", "summary", "entity_type", "facets", (${score}) AS score
    FROM "seo_llm_documents"
    WHERE ${Prisma.join(where, ' AND ')}
    ORDER BY ${order}
    LIMIT ${limit}
  `

  return rows.map((r) => ({
    path: r.path,
    title: r.title,
    summary: r.summary,
    kind: ENTITY_KIND_LABEL[r.entity_type as EntityType] ?? r.entity_type,
    facets: productFacets(r.facets),
  }))
}

export async function getPageMarkdown(path: string): Promise<string | null> {
  const key = path.trim().replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.md$/, '') || 'index'
  const rows = await prisma.$queryRaw<Array<{ markdown: string }>>`
    SELECT "markdown" FROM "seo_llm_documents" WHERE "path" = ${key} LIMIT 1
  `
  return rows[0]?.markdown ?? null
}

export async function listSections(): Promise<Array<{ kind: string; count: number }>> {
  const rows = await prisma.$queryRaw<Array<{ entity_type: string; count: bigint }>>`
    SELECT "entity_type", COUNT(*) AS count FROM "seo_llm_documents" GROUP BY "entity_type" ORDER BY count DESC
  `
  return rows.map((r) => ({
    kind: ENTITY_KIND_LABEL[r.entity_type as EntityType] ?? r.entity_type,
    count: Number(r.count),
  }))
}

/**
 * The business's own identity, read off the same structured-data profile that
 * feeds the JSON-LD on every public page and the top of llms.txt.
 *
 * Deliberately the profile and not a second store of the same facts: an agent
 * being told one company number while a search engine is told another is the
 * kind of contradiction that ends with the business trusted by neither.
 */
export async function getSiteInfo(): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ structured_data: Record<string, unknown> | null }>>`
    SELECT "structured_data" FROM "seo_settings" WHERE "id" = 'singleton' LIMIT 1
  `
  const profile = normaliseStructuredData(rows[0]?.structured_data ?? null)
  // Same gate as llms.txt: a profile the owner has switched off is a profile the
  // owner has switched off, whichever door it is asked for through.
  if (!profile.emitOrganization) return null
  return businessFactsText(profile, '')
}
