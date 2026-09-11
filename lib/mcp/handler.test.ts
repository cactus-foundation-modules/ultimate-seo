import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./tools', async () => {
  const actual = await vi.importActual<typeof import('./tools')>('./tools')
  return {
    ...actual,
    searchSite: vi.fn(),
    findProducts: vi.fn(),
    getPageMarkdown: vi.fn(),
    listSections: vi.fn(),
    getSiteInfo: vi.fn(),
  }
})

import { handleMcpRequest } from './handler'
import { findProducts, getPageMarkdown, getSiteInfo, listSections, searchSite } from './tools'

const ctx = { siteName: 'Deskwell', siteUrl: 'https://example.com', siteSummary: 'Office furniture for UK businesses.', maxResults: 25 }

beforeEach(() => {
  vi.mocked(searchSite).mockReset()
  vi.mocked(findProducts).mockReset()
  vi.mocked(getPageMarkdown).mockReset()
  vi.mocked(listSections).mockReset()
  vi.mocked(getSiteInfo).mockReset()
})

describe('handleMcpRequest', () => {
  it('answers initialize with the version the client asked for', async () => {
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      ctx,
    )
    expect((res!.result as { protocolVersion: string }).protocolVersion).toBe('2024-11-05')
  })

  it('falls back to its own version when the client names none', async () => {
    const res = await handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' }, ctx)
    expect((res!.result as { protocolVersion: string }).protocolVersion).toBe('2025-06-18')
  })

  it('gives no answer to the initialized notification', async () => {
    expect(await handleMcpRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx)).toBeNull()
  })

  it('lists its tools', async () => {
    const res = await handleMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx)
    const names = (res!.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name)
    expect(names).toEqual(['search_site', 'get_page', 'list_sections', 'find_products', 'get_site_info'])
  })

  it('points a new client at get_site_info first', async () => {
    const res = await handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' }, ctx)
    expect((res!.result as { instructions: string }).instructions).toContain('get_site_info')
  })

  it('answers get_site_info with the business details', async () => {
    vi.mocked(getSiteInfo).mockResolvedValue('Name: Deskwell\nVAT number: GB525366781')
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'get_site_info' } },
      ctx,
    )
    const text = (res!.result as { content: Array<{ text: string }> }).content[0]!.text
    expect(text).toContain('GB525366781')
  })

  it('says the details are missing rather than inventing any', async () => {
    vi.mocked(getSiteInfo).mockResolvedValue(null)
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'get_site_info' } },
      { ...ctx, siteSummary: '' },
    )
    const text = (res!.result as { content: Array<{ text: string }> }).content[0]!.text
    expect(text).toContain('has not published its business details')
  })

  it('does not tell a caller the site is empty when only the copies are', async () => {
    vi.mocked(listSections).mockResolvedValue([])
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'list_sections' } },
      ctx,
    )
    const text = (res!.result as { content: Array<{ text: string }> }).content[0]!.text
    expect(text).toContain('https://example.com')
    expect(text).not.toContain('publishes nothing')
  })

  it('searches and formats the hits with both addresses', async () => {
    vi.mocked(searchSite).mockResolvedValue([
      { path: 'shop/products/task-chair', title: 'Task chair', summary: 'A firm one.', kind: 'Product', facets: null },
    ])
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_site', arguments: { query: 'chair' } } },
      ctx,
    )
    const text = (res!.result as { content: Array<{ text: string }> }).content[0]!.text
    expect(text).toContain('https://example.com/shop/products/task-chair')
    expect(text).toContain('Markdown: https://example.com/shop/products/task-chair.md')
    expect(text).toContain('A firm one.')
  })

  it('caps the number of results at the owner’s limit', async () => {
    vi.mocked(searchSite).mockResolvedValue([])
    await handleMcpRequest(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'search_site', arguments: { query: 'x', limit: 500 } } },
      { ...ctx, maxResults: 25 },
    )
    expect(vi.mocked(searchSite)).toHaveBeenCalledWith('x', null, 25)
  })

  it('ignores a content type it does not recognise rather than querying for it', async () => {
    vi.mocked(searchSite).mockResolvedValue([])
    await handleMcpRequest(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'search_site', arguments: { query: 'x', type: 'nonsense' } } },
      ctx,
    )
    expect(vi.mocked(searchSite)).toHaveBeenCalledWith('x', null, 10)
  })

  it('says so plainly when a page is not there', async () => {
    vi.mocked(getPageMarkdown).mockResolvedValue(null)
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_page', arguments: { path: 'nope' } } },
      ctx,
    )
    expect((res!.result as { isError?: boolean }).isError).toBe(true)
  })

  it('hands back a page with its addresses made absolute', async () => {
    vi.mocked(getPageMarkdown).mockResolvedValue('# Desk\n\n- URL: /office-desks\n\nSee [chairs](/office-seating).')
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 61, method: 'tools/call', params: { name: 'get_page', arguments: { path: 'office-desks' } } },
      ctx,
    )
    const text = (res!.result as { content: Array<{ text: string }> }).content[0]!.text
    expect(text).toContain('- URL: https://example.com/office-desks')
    expect(text).toContain('[chairs](https://example.com/office-seating)')
  })

  it('says what the site sells before saying who runs it', async () => {
    vi.mocked(getSiteInfo).mockResolvedValue('Name: Deskwell')
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 62, method: 'tools/call', params: { name: 'get_site_info' } },
      ctx,
    )
    const text = (res!.result as { content: Array<{ text: string }> }).content[0]!.text
    expect(text).toBe('What this site is: Office furniture for UK businesses.\n\nName: Deskwell')
  })

  it('still answers get_site_info when the profile is empty but a summary is not', async () => {
    vi.mocked(getSiteInfo).mockResolvedValue(null)
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 63, method: 'tools/call', params: { name: 'get_site_info' } },
      ctx,
    )
    const text = (res!.result as { content: Array<{ text: string }> }).content[0]!.text
    expect(text).toContain('Office furniture for UK businesses.')
  })

  it('carries the summary into the handshake instructions', async () => {
    const res = await handleMcpRequest({ jsonrpc: '2.0', id: 64, method: 'initialize' }, ctx)
    expect((res!.result as { instructions: string }).instructions).toContain('Office furniture for UK businesses.')
  })

  it('points a search that found nothing at the tools that would', async () => {
    vi.mocked(searchSite).mockResolvedValue([])
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 65, method: 'tools/call', params: { name: 'search_site', arguments: { query: 'zzzz' } } },
      ctx,
    )
    const text = (res!.result as { content: Array<{ text: string }> }).content[0]!.text
    expect(text).toContain('list_sections')
    expect(text).toContain('get_site_info')
  })

  it('refuses a tool it does not have', async () => {
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'delete_everything' } },
      ctx,
    )
    expect(res!.error?.code).toBe(-32601)
  })

  it('refuses a method it does not have', async () => {
    const res = await handleMcpRequest({ jsonrpc: '2.0', id: 8, method: 'resources/subscribe' }, ctx)
    expect(res!.error?.code).toBe(-32601)
  })

  it('answers the two list methods clients ask for uninvited', async () => {
    expect((await handleMcpRequest({ jsonrpc: '2.0', id: 9, method: 'resources/list' }, ctx))!.result)
      .toEqual({ resources: [] })
    expect((await handleMcpRequest({ jsonrpc: '2.0', id: 10, method: 'prompts/list' }, ctx))!.result)
      .toEqual({ prompts: [] })
  })

  it('says nothing matched rather than returning an empty string', async () => {
    vi.mocked(searchSite).mockResolvedValue([])
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'search_site', arguments: { query: 'zzz' } } },
      ctx,
    )
    expect((res!.result as { content: Array<{ text: string }> }).content[0]!.text)
      .toMatch(/^Nothing on this site matches that\./)
  })

  it('lists sections with their counts', async () => {
    vi.mocked(listSections).mockResolvedValue([{ kind: 'Product', count: 20345 }])
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'list_sections' } },
      ctx,
    )
    expect((res!.result as { content: Array<{ text: string }> }).content[0]!.text).toBe('- Product: 20345')
  })
})

describe('find_products', () => {
  const chair = {
    path: 'task-chair',
    title: 'Task chair',
    summary: 'A firm one.',
    kind: 'Product',
    facets: {
      kind: 'product' as const,
      currency: 'GBP',
      priceMin: 199,
      priceMax: 249,
      priceSuffix: 'ex VAT',
      availability: 'in-stock' as const,
      sku: 'TC-1',
      groups: ['office chairs', 'office-chairs'],
    },
  }

  const call = (args: Record<string, unknown>) => handleMcpRequest(
    { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'find_products', arguments: args } },
    ctx,
  )

  const textOf = (res: Awaited<ReturnType<typeof handleMcpRequest>>) =>
    (res!.result as { content: Array<{ text: string }> }).content[0]!.text

  it('is offered in the tool list', async () => {
    const res = await handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, ctx)
    const names = (res!.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name)
    expect(names).toContain('find_products')
  })

  it('passes the filters through, normalised', async () => {
    vi.mocked(findProducts).mockResolvedValue([chair])
    await call({ query: ' mesh ', category: 'Office Chairs', max_price: 250, availability: 'in-stock', sort: 'price-low-to-high' })
    expect(findProducts).toHaveBeenCalledWith(
      { query: 'mesh', category: 'Office Chairs', minPrice: null, maxPrice: 250, availability: 'in-stock', sort: 'price-low-to-high' },
      10,
    )
  })

  // A budget arriving as a string and being read as "no budget" is the failure
  // that hands somebody a list of things they cannot afford.
  it('reads a price sent as a string', async () => {
    vi.mocked(findProducts).mockResolvedValue([chair])
    await call({ max_price: '250' })
    expect(vi.mocked(findProducts).mock.calls[0]![0].maxPrice).toBe(250)
  })

  it('drops a sort and an availability it does not recognise', async () => {
    vi.mocked(findProducts).mockResolvedValue([chair])
    await call({ sort: 'cheapest', availability: 'maybe' })
    const filter = vi.mocked(findProducts).mock.calls[0]![0]
    expect(filter.sort).toBe('relevance')
    expect(filter.availability).toBeNull()
  })

  it('puts the price, the tax wording and the stock on every line', async () => {
    vi.mocked(findProducts).mockResolvedValue([chair])
    const text = textOf(await call({ query: 'chair' }))
    expect(text).toContain('GBP 199.00 to GBP 249.00 ex VAT')
    expect(text).toContain('In stock')
    expect(text).toContain('https://example.com/task-chair')
    expect(text).toContain('https://example.com/task-chair.md')
  })

  it('says which way to loosen the question when nothing matches', async () => {
    vi.mocked(findProducts).mockResolvedValue([])
    const text = textOf(await call({ max_price: 5 }))
    expect(text).toContain('wider price range')
  })

  it('carries the same figures into an ordinary search hit', async () => {
    vi.mocked(searchSite).mockResolvedValue([chair])
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'search_site', arguments: { query: 'chair' } } },
      ctx,
    )
    expect(textOf(res)).toContain('GBP 199.00 to GBP 249.00 ex VAT')
  })
})
