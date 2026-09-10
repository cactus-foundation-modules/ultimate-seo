// The tools the agent endpoint offers, and what they do.
//
// Every one of them reads the materialised Markdown twins and nothing else. So
// an agent can only ever see what the site already publishes to anybody with a
// browser, the answers cost one indexed query each, and there is no second
// definition of "what this site says" to drift out of step with the first.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { ENTITY_KIND_LABEL } from '../ai/documents'
import type { EntityType } from '../types'

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
  ]
}

export type SearchHit = { path: string; title: string; summary: string | null; kind: string }

/**
 * Search across the twins.
 *
 * A plain ILIKE over title, summary and body rather than Postgres full-text: it
 * needs no index this module does not already have, it behaves the same on
 * every install, and at the size a Cactus site reaches the difference is not
 * measurable. If that stops being true, this is the one function to change.
 */
export async function searchSite(query: string, type: string | null, limit: number): Promise<SearchHit[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  // % and _ are wildcards in LIKE. A search for "50%" must look for "50%".
  const pattern = `%${trimmed.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

  const rows = await prisma.$queryRaw<Array<{ path: string; title: string; summary: string | null; entity_type: string }>>`
    SELECT "path", "title", "summary", "entity_type"
    FROM "seo_llm_documents"
    WHERE (${type}::text IS NULL OR "entity_type" = ${type})
      AND ("title" ILIKE ${pattern} ESCAPE '\\'
        OR "summary" ILIKE ${pattern} ESCAPE '\\'
        OR "markdown" ILIKE ${pattern} ESCAPE '\\')
    ORDER BY
      -- A title match is what was being looked for; a body match is a mention.
      (CASE WHEN "title" ILIKE ${pattern} ESCAPE '\\' THEN 0 ELSE 1 END),
      "title" ASC
    LIMIT ${Prisma.sql`${limit}`}
  `

  return rows.map((r) => ({
    path: r.path,
    title: r.title,
    summary: r.summary,
    kind: ENTITY_KIND_LABEL[r.entity_type as EntityType] ?? r.entity_type,
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
