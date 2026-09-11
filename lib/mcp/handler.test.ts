import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./tools', async () => {
  const actual = await vi.importActual<typeof import('./tools')>('./tools')
  return {
    ...actual,
    searchSite: vi.fn(),
    getPageMarkdown: vi.fn(),
    listSections: vi.fn(),
    getSiteInfo: vi.fn(),
  }
})

import { handleMcpRequest } from './handler'
import { getPageMarkdown, getSiteInfo, listSections, searchSite } from './tools'

const ctx = { siteName: 'Deskwell', siteUrl: 'https://example.com', maxResults: 25 }

beforeEach(() => {
  vi.mocked(searchSite).mockReset()
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
    expect(names).toEqual(['search_site', 'get_page', 'list_sections', 'get_site_info'])
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
      ctx,
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
      { path: 'shop/products/task-chair', title: 'Task chair', summary: 'A firm one.', kind: 'Product' },
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
      .toBe('Nothing on this site matches that.')
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
