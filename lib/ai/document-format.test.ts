import { describe, expect, it } from 'vitest'
import { bulletList, link, oneLine, renderDocument, table } from './document-format'

describe('table', () => {
  it('is empty with no rows, so a section can be dropped rather than left as a header', () => {
    expect(table(['A', 'B'], [])).toBe('')
  })

  it('escapes a pipe and flattens a newline inside a cell', () => {
    expect(table(['A'], [['x | y'], ['one\ntwo']])).toBe('| A |\n| --- |\n| x \\| y |\n| one two |')
  })

  it('keeps an empty cell as a cell', () => {
    expect(table(['A', 'B'], [['x', '']])).toBe('| A | B |\n| --- | --- |\n| x |   |')
  })
})

describe('oneLine', () => {
  it('is null for nothing', () => {
    expect(oneLine(null)).toBeNull()
    expect(oneLine('   ')).toBeNull()
  })

  it('strips markup and punctuation down to a sentence', () => {
    expect(oneLine('<p>A **firm** chair</p>')).toBe('A firm chair')
  })

  it('cuts at a word, not mid-word', () => {
    const out = oneLine('one two three four five six seven eight nine ten', 20)
    expect(out).toBe('one two three four…')
  })

  it('leaves a short line alone', () => {
    expect(oneLine('Short enough', 200)).toBe('Short enough')
  })
})

describe('link and bulletList', () => {
  it('strips brackets out of a label so the link cannot break', () => {
    expect(link('A [good] chair', '/x')).toBe('[A good chair](/x)')
  })

  it('drops empty bullets', () => {
    expect(bulletList(['one', '', 'two'])).toBe('- one\n- two')
  })
})

describe('renderDocument', () => {
  const header = {
    title: 'Task chair',
    summary: 'A firm one.',
    url: 'https://example.com/task-chair',
    kind: 'Product',
    updatedAt: new Date('2026-09-09T12:00:00Z'),
    facts: [{ label: 'Price', value: '£249.00' }, { label: 'SKU', value: '  ' }],
  }

  it('opens with the title, the summary and the facts', () => {
    const out = renderDocument(header, [])
    expect(out).toBe(
      '# Task chair\n\n> A firm one.\n\n- URL: https://example.com/task-chair\n'
      + '- Type: Product\n- Last updated: 2026-09-09\n- Price: £249.00\n',
    )
  })

  it('drops a fact with no value rather than printing an empty one', () => {
    expect(renderDocument(header, [])).not.toContain('SKU')
  })

  it('drops an empty section rather than leaving a bare heading', () => {
    const out = renderDocument(header, [{ heading: 'Description', body: '   ' }, { heading: 'Spec', body: 'Steel.' }])
    expect(out).not.toContain('## Description')
    expect(out).toContain('## Spec\n\nSteel.')
  })

  it('leaves the summary out when there is none', () => {
    const out = renderDocument({ ...header, summary: null, facts: [] }, [])
    expect(out.split('\n')[1]).toBe('')
    expect(out).not.toContain('> ')
  })

  it('ends with exactly one newline', () => {
    expect(renderDocument(header, [{ heading: 'A', body: 'B' }]).endsWith('B\n')).toBe(true)
  })
})
