// /llms.txt and /llms-full.txt.
//
// The convention is a Markdown file at the site root: an H1 with the site's
// name, a blockquote saying what it is, then linked lists of pages under
// headings. A reader with a small context window takes the index and fetches
// the two documents it needs; llms-full.txt is the same index with the short
// documents already inlined, for a reader that would rather make one request.

import { prisma } from '@/lib/db/prisma'
import { normaliseStructuredData } from '../settings'
import { ENTITY_TYPES, type EntityType, type SeoAiSettings, type SeoStructuredData } from '../types'
import { absolutiseMarkdown } from './absolutise'
import { businessFactsSection } from './business-facts'
import { listDocumentBodies, listDocumentIndex, type DocumentIndexRow } from './db'
import { ENTITY_KIND_LABEL } from './documents'

// The heading each content type is listed under, and the order the sections
// come in. Pages first because they are what a site is about; products last
// because there are twenty thousand of them and nobody reads to the end.
const SECTIONS: ReadonlyArray<{ heading: string; types: EntityType[] }> = [
  { heading: 'Pages', types: ['core-page'] },
  { heading: 'Product categories', types: ['shop-category'] },
  { heading: 'Product collections', types: ['shop-collection', 'filter-collection'] },
  { heading: 'Directory', types: ['directory-entry'] },
  { heading: 'Blog posts', types: ['gazette-post'] },
  { heading: 'Products', types: ['shop-product'] },
]

/**
 * What llms-full.txt inlines.
 *
 * Everything except the products. A catalogue that size would make the file
 * tens of megabytes - past the point where any reader fetches it, and a bill
 * for serving it every time one tries. The products stay in the index, one line
 * each, with their own .md address to fetch if they are wanted.
 */
const FULL_TEXT_TYPES: readonly EntityType[] = ENTITY_TYPES.filter((t) => t !== 'shop-product')

// A ceiling on llms-full.txt whatever the site holds. Four megabytes is already
// more than most readers will take, and the alternative to a ceiling is a route
// whose cost is set by how much content the owner has written.
const FULL_TEXT_MAX_BYTES = 4 * 1024 * 1024
const FULL_TEXT_MAX_DOCUMENTS = 2000

type SiteFacts = { name: string; summary: string | null; structuredData: SeoStructuredData | null }

async function siteFacts(settings: SeoAiSettings): Promise<SiteFacts> {
  let name = 'This site'
  let description: string | null = null
  let structuredData: SeoStructuredData | null = null
  // Both reads go out together, and each one's failure costs only itself.
  // Promise.all would not do: it rejects on the first failure, so a profile read
  // that threw - an install yet to run the migration, a permissions wrinkle -
  // would take the site's own name and description down with it and publish a
  // file headed "This site".
  const [config, profile] = await Promise.allSettled([
    prisma.siteConfig.findUnique({
      where: { id: 'singleton' },
      select: { siteName: true, description: true, tagline: true },
    }),
    prisma.$queryRaw<Array<{ structured_data: Record<string, unknown> | null }>>`
      SELECT "structured_data" FROM "seo_settings" WHERE "id" = 'singleton' LIMIT 1
    `,
  ])

  // Nothing to say about the site is not a reason to publish nothing.
  if (config.status === 'fulfilled' && config.value) {
    if (config.value.siteName) name = config.value.siteName
    description = config.value.description?.trim() || config.value.tagline?.trim() || null
  }
  if (profile.status === 'fulfilled') {
    structuredData = normaliseStructuredData(profile.value[0]?.structured_data ?? null)
  }
  return { name, summary: settings.siteSummary.trim() || description, structuredData }
}

function indexLine(row: DocumentIndexRow, siteUrl: string): string {
  const url = `${siteUrl}/${row.path}.md`
  const label = row.title.replace(/[[\]]/g, '').trim() || row.path
  return row.summary ? `- [${label}](${url}): ${row.summary}` : `- [${label}](${url})`
}

function renderIndex(
  facts: SiteFacts,
  siteUrl: string,
  rows: DocumentIndexRow[],
  settings: SeoAiSettings,
  /** True when this index is the head of llms-full.txt, which is that file. */
  inlined = false,
): string {
  const byType = new Map<string, DocumentIndexRow[]>()
  for (const row of rows) {
    const list = byType.get(row.entity_type)
    if (list) list.push(row)
    else byType.set(row.entity_type, [row])
  }

  const parts: string[] = [`# ${facts.name}`]
  if (facts.summary) parts.push(`> ${facts.summary.replace(/\s+/g, ' ').trim()}`)

  // Only claimed when there is something to claim it about. This line used to be
  // unconditional, and on a site whose twins had not been built yet it promised a
  // reader that every page below had a Markdown copy - below an index with no
  // pages in it and above nothing at all. A file that lies about what it holds is
  // worse than a file that admits it holds nothing.
  if (rows.length > 0 && settings.markdown) {
    parts.push('Every page below is also available as Markdown at the same address with `.md` on the end.')
  }

  // Named here or nowhere. A reader holding the index has no way of guessing
  // that a second file exists with the documents already inlined, and the whole
  // point of that file is to save it the round trips it is about to make.
  if (rows.length > 0 && settings.llmsFull && !inlined) {
    parts.push(`Everything except the product pages is also available inlined in one file at ${siteUrl}/llms-full.txt.`)
  }

  // Who this actually is. Placed above the page lists on purpose: a reader with a
  // small context window takes the top of the file, and identity is what decides
  // whether anything underneath it is worth fetching.
  //
  // Gated on emitOrganization as well as on its own switch. The profile can be
  // filled in and deliberately not published - and an owner who has turned the
  // organisation record OFF has said, in the only way the screen offers, that
  // they do not want these facts on their site. Publishing them here anyway
  // because a different switch defaults to on is not a decision this module gets
  // to make on an update.
  if (settings.businessFacts && facts.structuredData?.emitOrganization) {
    const about = businessFactsSection(facts.structuredData, facts.name)
    if (about) parts.push(about)
  }

  // Where the agent endpoint is announced. There is no agreed well-known path
  // for one, so rather than invent a standard and serve a file nothing asks
  // for, it is named in the document a reader is already holding.
  if (settings.mcp) {
    parts.push(`This site also answers agent queries over MCP at \`${siteUrl}/api/m/ultimate-seo/mcp\` (read-only, JSON-RPC over POST).`)
  }

  for (const section of SECTIONS) {
    const lines = section.types.flatMap((type) => byType.get(type) ?? []).map((row) => indexLine(row, siteUrl))
    if (lines.length === 0) continue
    parts.push(`## ${section.heading}\n\n${lines.join('\n')}`)
  }

  // A content type added to the module after this list was written still gets
  // listed, rather than quietly vanishing from the index.
  const covered = new Set(SECTIONS.flatMap((s) => s.types as string[]))
  for (const [type, rowsOfType] of byType) {
    if (covered.has(type)) continue
    const heading = ENTITY_KIND_LABEL[type as EntityType] ?? type
    parts.push(`## ${heading}\n\n${rowsOfType.map((row) => indexLine(row, siteUrl)).join('\n')}`)
  }

  // Said out loud rather than left as an absence. An empty index and a
  // still-building one look identical to a reader, and the difference decides
  // whether it comes back.
  if (rows.length === 0) {
    parts.push('_No page index is published yet. The Markdown copies of this site are built on a schedule and this file will list them once that has run._')
  }

  return `${parts.join('\n\n').trim()}\n`
}

/** /llms.txt, or null when the owner has it switched off. */
export async function buildLlmsIndex(siteUrl: string, settings: SeoAiSettings): Promise<string | null> {
  if (!settings.llmsTxt) return null
  const [facts, rows] = await Promise.all([
    siteFacts(settings),
    listDocumentIndex(settings.markdownTypes),
  ])
  return renderIndex(facts, siteUrl, rows, settings)
}

/** /llms-full.txt, or null when it is switched off. */
export async function buildLlmsFull(siteUrl: string, settings: SeoAiSettings): Promise<string | null> {
  if (!settings.llmsTxt || !settings.llmsFull) return null

  const wanted = settings.markdownTypes.filter((t) => (FULL_TEXT_TYPES as readonly string[]).includes(t))
  const [facts, rows, bodies] = await Promise.all([
    siteFacts(settings),
    listDocumentIndex(settings.markdownTypes),
    listDocumentBodies(wanted, FULL_TEXT_MAX_DOCUMENTS),
  ])

  const parts = [renderIndex(facts, siteUrl, rows, settings, true).trim(), '---', '# Full text']
  let bytes = parts.join('').length
  let included = 0

  for (const body of bodies) {
    // Absolute, because an inlined body has been lifted out of the document it
    // was stored as: nothing downstream knows which site `/office-desks` meant.
    const chunk = `${absolutiseMarkdown(body.markdown, siteUrl).trim()}\n`
    const size = Buffer.byteLength(chunk, 'utf8')
    // Stop at the ceiling rather than truncating mid-document: half a product
    // description is worse than not having it, because a reader cannot tell.
    if (bytes + size > FULL_TEXT_MAX_BYTES) break
    parts.push(chunk)
    bytes += size
    included++
  }

  if (included < bodies.length) {
    parts.push(`_${bodies.length - included} further documents were left out to keep this file a sensible size. Each is at its own address with \`.md\` on the end._`)
  }

  return `${parts.join('\n\n').trim()}\n`
}
