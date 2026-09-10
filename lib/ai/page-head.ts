// What one public page adds to its own document head: its structured data, and
// where its Markdown twin lives.
//
// The whole of it is ONE indexed read, and only when the owner has asked for
// it. Both switches share that read, so turning both on costs no more than
// turning one on - which is why they sit together on the screen rather than
// pretending to be independent.

import { cache } from 'react'
import { headers } from 'next/headers'
import { getPageFacts } from './db'
import { buildPageJsonLd, markdownTwinUrl, type BreadcrumbStep, type PageFacts } from './json-ld'
import { ENTITY_TYPES, type EntityType, type SeoAiSettings } from '../types'

/**
 * The document path for the page being rendered, or null when there is not one.
 *
 * `x-cactus-path` is set by core's proxy (core 0.5.1565), which is the only
 * thing in the request that knows: a server component cannot ask what address
 * it is answering, and the client component that could would mean shipping
 * JavaScript to every page to find out.
 */
async function currentDocumentPath(): Promise<string | null> {
  let raw: string | null
  try {
    raw = (await headers()).get('x-cactus-path')
  } catch {
    // Rendered outside a request - a build-time pass, a test.
    return null
  }
  if (!raw || !raw.startsWith('/')) return null

  const clean = (raw.split('?')[0] ?? '/').replace(/\/+$/, '')
  // Nothing under these is a page with content of its own, and an older core
  // that does not set the header at all simply lands here as null above.
  if (/^\/(api|_next|cactus-admin|setup|cactus-status|page-preview|layout-preview)\b/.test(clean)) return null

  // The home page's twin is stored under 'index' - see pathOf in ai/documents.ts.
  return clean === '' || clean === '/' ? 'index' : clean.replace(/^\/+/, '')
}

const ENTITY_TYPE_SET: ReadonlySet<string> = new Set(ENTITY_TYPES)

function steps(value: unknown): BreadcrumbStep[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const e = entry as { name?: unknown; path?: unknown }
    if (typeof e.name !== 'string' || typeof e.path !== 'string') return []
    return [{ name: e.name, path: e.path }]
  })
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

/**
 * The stored facts, read back defensively.
 *
 * The column is JSONB, so its contents are whatever shape was written the day
 * they were written - and this runs on the render path of every public page.
 * A row from an older build that is missing a field must cost that field and
 * nothing else.
 */
export function normalisePageFacts(raw: unknown): PageFacts | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.kind !== 'string' || !ENTITY_TYPE_SET.has(r.kind)) return null
  if (typeof r.title !== 'string' || !r.title.trim()) return null
  return {
    kind: r.kind as EntityType,
    title: r.title,
    description: optionalString(r.description),
    breadcrumb: steps(r.breadcrumb),
    image: optionalString(r.image),
    publishedAt: optionalString(r.publishedAt),
    updatedAt: optionalString(r.updatedAt),
    author: optionalString(r.author),
    items: steps(r.items),
    telephone: optionalString(r.telephone),
    email: optionalString(r.email),
    address: optionalString(r.address),
    website: optionalString(r.website),
  }
}

// One read per request however many times the head is assembled, the same
// treatment the settings read gets in lib/head.ts.
const readFacts = cache(async (path: string) => {
  try {
    return await getPageFacts(path)
  } catch {
    // Before the migration has run there is no column to read. A page missing
    // its breadcrumbs is a page; a page that throws is a 500.
    return null
  }
})

export type PageHeadPart = {
  jsonLd: Record<string, unknown>[]
  links: Array<{ rel: string; href: string; type?: string; title?: string }>
}

const NOTHING: PageHeadPart = { jsonLd: [], links: [] }

/** The current page's own head contributions. Empty unless asked for. */
export async function getPageHead(siteUrl: string, settings: SeoAiSettings): Promise<PageHeadPart> {
  // The twin link is only offered when there are twins to point at: a link to a
  // page that answers 404 is worse than no link.
  const wantsLink = settings.pageMarkdownLink && settings.markdown
  if (!settings.pageStructuredData && !wantsLink) return NOTHING

  const path = await currentDocumentPath()
  if (!path) return NOTHING

  const row = await readFacts(path)
  if (!row) return NOTHING

  const jsonLd: PageHeadPart['jsonLd'] = []
  const links: PageHeadPart['links'] = []

  if (wantsLink) {
    links.push({
      rel: 'alternate',
      type: 'text/markdown',
      href: markdownTwinUrl(siteUrl, row.path),
      title: 'Markdown version of this page',
    })
  }

  if (settings.pageStructuredData) {
    const facts = normalisePageFacts(row.page_facts)
    if (facts) jsonLd.push(...buildPageJsonLd(siteUrl, facts))
  }

  return { jsonLd, links }
}
