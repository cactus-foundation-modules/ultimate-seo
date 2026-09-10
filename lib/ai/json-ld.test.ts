import { describe, expect, it } from 'vitest'
import { buildPageJsonLd, markdownTwinUrl, type PageFacts } from './json-ld'
import type { EntityType } from '../types'

const SITE = 'https://example.com'

const facts = (over: Partial<PageFacts> & { kind: EntityType }): PageFacts => ({
  title: 'A thing',
  description: 'What it is.',
  breadcrumb: [{ name: 'Home', path: '' }, { name: 'A thing', path: 'a-thing' }],
  ...over,
})

function typesOf(blocks: object[]): string[] {
  return blocks.map((b) => (b as { '@type': string })['@type'])
}

describe('breadcrumbs', () => {
  it('are emitted for every content type that has a trail', () => {
    for (const kind of ['shop-product', 'gazette-post', 'shop-category', 'directory-entry'] as const) {
      expect(typesOf(buildPageJsonLd(SITE, facts({ kind })))).toContain('BreadcrumbList')
    }
  })

  it('are left out when the page is its own only step', () => {
    const out = buildPageJsonLd(SITE, facts({ kind: 'shop-product', breadcrumb: [{ name: 'A thing', path: 'a-thing' }] }))
    expect(typesOf(out)).not.toContain('BreadcrumbList')
  })

  it('number from one and carry absolute addresses', () => {
    const out = buildPageJsonLd(SITE, facts({
      kind: 'shop-product',
      breadcrumb: [
        { name: 'Home', path: '' },
        { name: 'Chairs', path: 'shop/categories/chairs' },
        { name: 'Task chair', path: 'task-chair' },
      ],
    }))
    const crumbs = out[0] as { itemListElement: Array<{ position: number; item: string; name: string }> }
    expect(crumbs.itemListElement.map((e) => [e.position, e.item])).toEqual([
      [1, 'https://example.com'],
      [2, 'https://example.com/shop/categories/chairs'],
      [3, 'https://example.com/task-chair'],
    ])
  })
})

describe('what each content type publishes', () => {
  it('leaves Product to the shop, which already publishes it', () => {
    expect(typesOf(buildPageJsonLd(SITE, facts({ kind: 'shop-product' })))).toEqual(['BreadcrumbList'])
  })

  it('says nothing extra about an ordinary page', () => {
    expect(typesOf(buildPageJsonLd(SITE, facts({ kind: 'core-page' })))).toEqual(['BreadcrumbList'])
  })

  it('publishes a blog post as a BlogPosting', () => {
    const out = buildPageJsonLd(SITE, facts({
      kind: 'gazette-post',
      publishedAt: '2026-09-01T09:00:00.000Z',
      updatedAt: '2026-09-05T09:00:00.000Z',
      author: 'Ben',
      image: 'https://media.example.com/desk.jpg',
    }))
    const post = out[1] as Record<string, unknown>
    expect(post['@type']).toBe('BlogPosting')
    expect(post.headline).toBe('A thing')
    expect(post.author).toEqual({ '@type': 'Person', name: 'Ben' })
    expect(post.datePublished).toBe('2026-09-01T09:00:00.000Z')
    expect(post.dateModified).toBe('2026-09-05T09:00:00.000Z')
    expect(post.image).toBe('https://media.example.com/desk.jpg')
    expect(post['@id']).toBe('https://example.com/a-thing')
  })

  it('falls back to the publication date when a post has never been edited', () => {
    const out = buildPageJsonLd(SITE, facts({ kind: 'gazette-post', publishedAt: '2026-09-01T09:00:00.000Z' }))
    expect((out[1] as Record<string, unknown>).dateModified).toBe('2026-09-01T09:00:00.000Z')
  })

  it('leaves a date out rather than publishing an invalid one', () => {
    const out = buildPageJsonLd(SITE, facts({ kind: 'gazette-post', publishedAt: 'last Tuesday' }))
    const post = out[1] as Record<string, unknown>
    expect(post).not.toHaveProperty('datePublished')
    expect(post).not.toHaveProperty('dateModified')
  })

  it('publishes a category as a CollectionPage listing what is on it', () => {
    const out = buildPageJsonLd(SITE, facts({
      kind: 'shop-category',
      items: [{ name: 'Luna', path: 'luna' }, { name: 'Iris', path: 'iris' }],
    }))
    const page = out[1] as { '@type': string; mainEntity: { numberOfItems: number; itemListElement: Array<{ url: string }> } }
    expect(page['@type']).toBe('CollectionPage')
    expect(page.mainEntity.numberOfItems).toBe(2)
    expect(page.mainEntity.itemListElement[0]!.url).toBe('https://example.com/luna')
  })

  it('caps a very long list rather than putting a whole catalogue in the head', () => {
    const items = Array.from({ length: 500 }, (_, i) => ({ name: `P${i}`, path: `p${i}` }))
    const out = buildPageJsonLd(SITE, facts({ kind: 'shop-collection', items }))
    const page = out[1] as { mainEntity: { numberOfItems: number } }
    expect(page.mainEntity.numberOfItems).toBe(30)
  })

  it('leaves the list out entirely when the page shows nothing', () => {
    const out = buildPageJsonLd(SITE, facts({ kind: 'filter-collection', items: [] }))
    expect(out[1]).not.toHaveProperty('mainEntity')
  })

  it('publishes a directory entry as a LocalBusiness with its contact details', () => {
    const out = buildPageJsonLd(SITE, facts({
      kind: 'directory-entry',
      telephone: '01234 567890',
      address: '1 High Street',
      website: 'https://elsewhere.example',
    }))
    const biz = out[1] as Record<string, unknown>
    expect(biz['@type']).toBe('LocalBusiness')
    expect(biz.telephone).toBe('01234 567890')
    expect(biz.address).toEqual({ '@type': 'PostalAddress', streetAddress: '1 High Street' })
    expect(biz.sameAs).toEqual(['https://elsewhere.example'])
  })

  it('omits a detail rather than publishing an empty one', () => {
    const biz = buildPageJsonLd(SITE, facts({ kind: 'directory-entry' }))[1] as Record<string, unknown>
    expect(biz).not.toHaveProperty('telephone')
    expect(biz).not.toHaveProperty('address')
  })
})

describe('addresses', () => {
  it('leaves a media URL that is already absolute alone', () => {
    const out = buildPageJsonLd(SITE, facts({ kind: 'gazette-post', image: 'https://cdn.example.net/a.jpg' }))
    expect((out[1] as Record<string, unknown>).image).toBe('https://cdn.example.net/a.jpg')
  })

  it('makes a site path absolute', () => {
    const out = buildPageJsonLd(SITE, facts({ kind: 'gazette-post', image: '/media/a.jpg' }))
    expect((out[1] as Record<string, unknown>).image).toBe('https://example.com/media/a.jpg')
  })

  it('points at the Markdown twin', () => {
    expect(markdownTwinUrl(SITE, 'shop/products/task-chair')).toBe('https://example.com/shop/products/task-chair.md')
    expect(markdownTwinUrl(SITE, 'index')).toBe('https://example.com/index.md')
  })
})
