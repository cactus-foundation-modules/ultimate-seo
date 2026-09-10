import { beforeEach, describe, expect, it, vi } from 'vitest'

const headerStore = { value: null as string | null }
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => (name === 'x-cactus-path' ? headerStore.value : null) }),
}))
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  // cache() memoises per request; there is no request here, so it is identity.
  return { ...actual, cache: <T,>(fn: T) => fn }
})
vi.mock('./db', () => ({ getPageFacts: vi.fn() }))

import { getPageHead, normalisePageFacts } from './page-head'
import { getPageFacts } from './db'
import { DEFAULT_AI_SETTINGS, type SeoAiSettings } from '../types'

const SITE = 'https://example.com'
const settings = (over: Partial<SeoAiSettings> = {}): SeoAiSettings => ({ ...DEFAULT_AI_SETTINGS, ...over })

const storedFacts = {
  kind: 'gazette-post',
  title: 'On sitting',
  description: 'Do less of it.',
  breadcrumb: [{ name: 'Home', path: '' }, { name: 'On sitting', path: 'blog/sitting' }],
  publishedAt: '2026-09-01T00:00:00.000Z',
  author: 'Ben',
}

beforeEach(() => {
  headerStore.value = '/blog/sitting'
  vi.mocked(getPageFacts).mockReset().mockResolvedValue({ path: 'blog/sitting', page_facts: storedFacts })
})

describe('getPageHead', () => {
  it('does nothing at all, and asks nothing, while both switches are off', async () => {
    expect(await getPageHead(SITE, settings())).toEqual({ jsonLd: [], links: [] })
    expect(vi.mocked(getPageFacts)).not.toHaveBeenCalled()
  })

  it('offers no twin link while the twins themselves are switched off', async () => {
    const out = await getPageHead(SITE, settings({ pageMarkdownLink: true, markdown: false }))
    expect(out.links).toEqual([])
    expect(vi.mocked(getPageFacts)).not.toHaveBeenCalled()
  })

  it('points at the twin at the stored path, not the requested one', async () => {
    vi.mocked(getPageFacts).mockResolvedValue({ path: 'blog/sitting', page_facts: storedFacts })
    const out = await getPageHead(SITE, settings({ pageMarkdownLink: true }))
    expect(out.links).toEqual([{
      rel: 'alternate',
      type: 'text/markdown',
      href: 'https://example.com/blog/sitting.md',
      title: 'Markdown version of this page',
    }])
  })

  it('publishes the page’s own structured data', async () => {
    const out = await getPageHead(SITE, settings({ pageStructuredData: true }))
    expect(out.jsonLd.map((b) => b['@type'])).toEqual(['BreadcrumbList', 'BlogPosting'])
  })

  it('makes one lookup for both switches, not two', async () => {
    await getPageHead(SITE, settings({ pageStructuredData: true, pageMarkdownLink: true }))
    expect(vi.mocked(getPageFacts)).toHaveBeenCalledTimes(1)
  })

  it('maps the home page to its stored path', async () => {
    headerStore.value = '/'
    await getPageHead(SITE, settings({ pageStructuredData: true }))
    expect(vi.mocked(getPageFacts)).toHaveBeenCalledWith('index')
  })

  it('drops a trailing slash and a query string', async () => {
    headerStore.value = '/shop/categories/chairs/?colour=green'
    await getPageHead(SITE, settings({ pageStructuredData: true }))
    expect(vi.mocked(getPageFacts)).toHaveBeenCalledWith('shop/categories/chairs')
  })

  it('asks nothing for an address that is not a page', async () => {
    for (const path of ['/api/m/shop/thing', '/cactus-admin/pages', '/_next/static/x', '/setup']) {
      headerStore.value = path
      expect(await getPageHead(SITE, settings({ pageStructuredData: true }))).toEqual({ jsonLd: [], links: [] })
    }
    expect(vi.mocked(getPageFacts)).not.toHaveBeenCalled()
  })

  it('says nothing when core is too old to set the header', async () => {
    headerStore.value = null
    expect(await getPageHead(SITE, settings({ pageStructuredData: true }))).toEqual({ jsonLd: [], links: [] })
  })

  it('says nothing for a page with no twin built', async () => {
    vi.mocked(getPageFacts).mockResolvedValue(null)
    expect(await getPageHead(SITE, settings({ pageStructuredData: true, pageMarkdownLink: true })))
      .toEqual({ jsonLd: [], links: [] })
  })

  it('still offers the link when the stored facts are unreadable', async () => {
    vi.mocked(getPageFacts).mockResolvedValue({ path: 'blog/sitting', page_facts: null })
    const out = await getPageHead(SITE, settings({ pageStructuredData: true, pageMarkdownLink: true }))
    expect(out.jsonLd).toEqual([])
    expect(out.links).toHaveLength(1)
  })

  it('costs the page nothing when the read throws', async () => {
    vi.mocked(getPageFacts).mockRejectedValue(new Error('no such column'))
    expect(await getPageHead(SITE, settings({ pageStructuredData: true }))).toEqual({ jsonLd: [], links: [] })
  })
})

describe('normalisePageFacts', () => {
  it('refuses anything that is not a facts object', () => {
    for (const bad of [null, undefined, 'text', 42, [], {}, { kind: 'nonsense', title: 'x' }, { kind: 'core-page', title: '  ' }]) {
      expect(normalisePageFacts(bad)).toBeNull()
    }
  })

  it('keeps only breadcrumb steps that are whole', () => {
    const facts = normalisePageFacts({
      kind: 'core-page',
      title: 'About',
      breadcrumb: [{ name: 'Home', path: '' }, { name: 'No path' }, 'nonsense', { path: 'no-name' }],
    })
    expect(facts!.breadcrumb).toEqual([{ name: 'Home', path: '' }])
  })

  it('reads a row written before a field existed without losing the rest', () => {
    const facts = normalisePageFacts({ kind: 'shop-category', title: 'Chairs' })
    expect(facts).toMatchObject({ kind: 'shop-category', title: 'Chairs', description: null, breadcrumb: [], items: [] })
  })

  it('treats a blank string as absent', () => {
    expect(normalisePageFacts({ kind: 'core-page', title: 'A', author: '   ' })!.author).toBeNull()
  })
})
