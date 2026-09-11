import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    siteConfig: { findUnique: vi.fn().mockResolvedValue({ siteName: 'Deskwell', description: 'Office furniture.', tagline: null }) },
    // The structured-data profile, read alongside the site config.
    $queryRaw: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('./db', () => ({ listDocumentIndex: vi.fn(), listDocumentBodies: vi.fn() }))

import { buildLlmsFull, buildLlmsIndex } from './llms-txt'
import { listDocumentBodies, listDocumentIndex } from './db'
import { prisma } from '@/lib/db/prisma'
import { DEFAULT_AI_SETTINGS, type SeoAiSettings } from '../types'

const settings = (over: Partial<SeoAiSettings> = {}): SeoAiSettings => ({ ...DEFAULT_AI_SETTINGS, ...over })

const rows = [
  { entity_type: 'core-page', path: 'index', title: 'Home', summary: 'The front page.', byte_size: 100 },
  { entity_type: 'shop-product', path: 'task-chair', title: 'Task chair', summary: null, byte_size: 900 },
  { entity_type: 'shop-category', path: 'shop/categories/chairs', title: 'Chairs', summary: 'All of them.', byte_size: 500 },
]

beforeEach(() => {
  vi.mocked(listDocumentIndex).mockReset().mockResolvedValue(rows)
  vi.mocked(listDocumentBodies).mockReset().mockResolvedValue([])
  vi.mocked(prisma.$queryRaw).mockReset().mockResolvedValue([])
})

/** Makes the profile read return one saved structured-data row. */
function withProfile(structured: Record<string, unknown>) {
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ structured_data: structured }])
}

describe('buildLlmsIndex', () => {
  it('is null when the owner has switched it off', async () => {
    expect(await buildLlmsIndex('https://example.com', settings({ llmsTxt: false }))).toBeNull()
  })

  it('opens with the site name and its description', async () => {
    const out = await buildLlmsIndex('https://example.com', settings())
    expect(out!.startsWith('# Deskwell\n\n> Office furniture.')).toBe(true)
  })

  it('prefers the owner’s own summary over the site description', async () => {
    const out = await buildLlmsIndex('https://example.com', settings({ siteSummary: 'Desks, chairs, delivered.' }))
    expect(out).toContain('> Desks, chairs, delivered.')
  })

  it('links each page at its .md address, with its summary', async () => {
    const out = await buildLlmsIndex('https://example.com', settings())
    expect(out).toContain('- [Home](https://example.com/index.md): The front page.')
    expect(out).toContain('- [Task chair](https://example.com/task-chair.md)')
    expect(out).not.toContain('Task chair](https://example.com/task-chair.md):')
  })

  it('puts pages before products, whatever order they arrive in', async () => {
    const out = await buildLlmsIndex('https://example.com', settings())
    expect(out!.indexOf('## Pages')).toBeLessThan(out!.indexOf('## Product categories'))
    expect(out!.indexOf('## Product categories')).toBeLessThan(out!.indexOf('## Products'))
  })

  it('names the agent endpoint only when it is switched on', async () => {
    expect(await buildLlmsIndex('https://example.com', settings())).not.toContain('/api/m/ultimate-seo/mcp')
    const on = await buildLlmsIndex('https://example.com', settings({ mcp: true }))
    expect(on).toContain('https://example.com/api/m/ultimate-seo/mcp')
  })

  it('still lists a content type nobody thought to put in a section', async () => {
    vi.mocked(listDocumentIndex).mockResolvedValue([
      { entity_type: 'something-new', path: 'a', title: 'A', summary: null, byte_size: 1 },
    ])
    expect(await buildLlmsIndex('https://example.com', settings())).toContain('- [A](https://example.com/a.md)')
  })
})

describe('buildLlmsFull', () => {
  it('is null when either switch is off', async () => {
    expect(await buildLlmsFull('https://example.com', settings({ llmsFull: false }))).toBeNull()
    expect(await buildLlmsFull('https://example.com', settings({ llmsTxt: false }))).toBeNull()
  })

  it('never asks for the products', async () => {
    await buildLlmsFull('https://example.com', settings())
    const asked = vi.mocked(listDocumentBodies).mock.calls[0]![0]
    expect(asked).not.toContain('shop-product')
    expect(asked).toContain('core-page')
  })

  it('inlines the bodies after the index', async () => {
    vi.mocked(listDocumentBodies).mockResolvedValue([{ path: 'index', markdown: '# Home\n\nWelcome.' }])
    const out = await buildLlmsFull('https://example.com', settings())
    expect(out).toContain('# Full text')
    expect(out!.indexOf('## Pages')).toBeLessThan(out!.indexOf('Welcome.'))
  })

  it('asks only for the types the owner still wants', async () => {
    await buildLlmsFull('https://example.com', settings({ markdownTypes: ['core-page'] }))
    expect(vi.mocked(listDocumentBodies).mock.calls[0]![0]).toEqual(['core-page'])
  })
})

describe('the business facts block', () => {
  const structured = {
    emitOrganization: true,
    name: 'Deskwell Office Furniture',
    legalName: 'Deskwell Limited',
    identifierName: 'Companies House company number',
    identifierValue: '17332661',
    vatId: 'GB525366781',
    areaServed: ['GB'],
    email: 'hi@example.com',
  }

  it('publishes who the business is above the page lists', async () => {
    withProfile(structured)
    const out = await buildLlmsIndex('https://example.com', settings()) ?? ''
    expect(out).toContain('## About this business')
    expect(out).toContain('- **Companies House company number**: 17332661')
    expect(out.indexOf('## About this business')).toBeLessThan(out.indexOf('## Pages'))
  })

  it('stays out when the owner switches it off', async () => {
    withProfile(structured)
    const out = await buildLlmsIndex('https://example.com', settings({ businessFacts: false })) ?? ''
    expect(out).not.toContain('## About this business')
  })

  it('stays out when the owner is not publishing the organisation record at all', async () => {
    withProfile({ ...structured, emitOrganization: false })
    const out = await buildLlmsIndex('https://example.com', settings()) ?? ''
    expect(out).not.toContain('## About this business')
  })

  it('stays out when the profile has nothing in it', async () => {
    const out = await buildLlmsIndex('https://example.com', settings()) ?? ''
    expect(out).not.toContain('## About this business')
  })

  it('survives the profile read failing', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('no such table'))
    const out = await buildLlmsIndex('https://example.com', settings())
    expect(out).toContain('# Deskwell')
  })
})

describe('an index with nothing built yet', () => {
  beforeEach(() => {
    vi.mocked(listDocumentIndex).mockResolvedValue([])
  })

  it('does not promise Markdown copies that do not exist', async () => {
    const out = await buildLlmsIndex('https://example.com', settings()) ?? ''
    expect(out).not.toContain('.md` on the end')
  })

  it('says so rather than looking like an empty site', async () => {
    const out = await buildLlmsIndex('https://example.com', settings()) ?? ''
    expect(out).toContain('No page index is published yet')
  })

  it('still publishes who the business is', async () => {
    withProfile({ emitOrganization: true, name: 'Deskwell', vatId: 'GB525366781' })
    const out = await buildLlmsIndex('https://example.com', settings()) ?? ''
    expect(out).toContain('- **VAT number**: GB525366781')
  })
})
