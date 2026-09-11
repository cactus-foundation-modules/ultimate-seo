import { describe, expect, it } from 'vitest'
import { absolutiseMarkdown } from './absolutise'

const SITE = 'https://example.com'

describe('absolutiseMarkdown', () => {
  it('rewrites the header URL line', () => {
    expect(absolutiseMarkdown('- URL: /office-desks', SITE)).toBe('- URL: https://example.com/office-desks')
  })

  it('rewrites the home page to the site root', () => {
    expect(absolutiseMarkdown('- URL: /', SITE)).toBe('- URL: https://example.com/')
  })

  it('rewrites inline links and images', () => {
    const before = 'See [desks](/office-desks) and ![logo](/media/logo.webp).'
    expect(absolutiseMarkdown(before, SITE))
      .toBe('See [desks](https://example.com/office-desks) and ![logo](https://example.com/media/logo.webp).')
  })

  it('rewrites links inside a table row', () => {
    const before = '| [Task chair](/task-chair) | £99.00 |'
    expect(absolutiseMarkdown(before, SITE)).toBe('| [Task chair](https://example.com/task-chair) | £99.00 |')
  })

  it('leaves absolute, anchor and mailto targets alone', () => {
    const before = '[a](https://other.test/x) [b](#section) [c](mailto:hi@example.com)'
    expect(absolutiseMarkdown(before, SITE)).toBe(before)
  })

  it('leaves a protocol-relative target alone rather than repointing it', () => {
    const before = '[cdn](//cdn.example.net/file.pdf)'
    expect(absolutiseMarkdown(before, SITE)).toBe(before)
  })

  it('keeps a link title', () => {
    expect(absolutiseMarkdown('[x](/y "The Y page")', SITE)).toBe('[x](https://example.com/y "The Y page")')
  })

  it('does not double up when the site URL has a trailing slash', () => {
    expect(absolutiseMarkdown('[x](/y)', 'https://example.com/')).toBe('[x](https://example.com/y)')
  })

  it('returns the document untouched when there is no site URL', () => {
    const before = '- URL: /x\n\n[y](/z)'
    expect(absolutiseMarkdown(before, '')).toBe(before)
  })

  it('does not touch a line that merely mentions a path', () => {
    const before = 'The address is /office-desks and nothing links to it.'
    expect(absolutiseMarkdown(before, SITE)).toBe(before)
  })
})
