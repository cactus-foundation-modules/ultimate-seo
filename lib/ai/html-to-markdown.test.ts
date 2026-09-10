import { describe, expect, it } from 'vitest'
import { htmlToMarkdown, looksLikeHtml } from './html-to-markdown'

describe('htmlToMarkdown', () => {
  it('is empty for empty input', () => {
    expect(htmlToMarkdown('')).toBe('')
    expect(htmlToMarkdown('   ')).toBe('')
  })

  it('turns headings and paragraphs into blocks', () => {
    expect(htmlToMarkdown('<h2>Desks</h2><p>Sturdy ones.</p>')).toBe('## Desks\n\nSturdy ones.')
  })

  it('keeps emphasis, links and images inline', () => {
    expect(htmlToMarkdown('<p>A <strong>firm</strong> <em>chair</em> from <a href="/shop">the shop</a>.</p>'))
      .toBe('A **firm** *chair* from [the shop](/shop).')
    expect(htmlToMarkdown('<p><img src="/a.jpg" alt="A desk"></p>')).toBe('![A desk](/a.jpg)')
  })

  it('nests lists', () => {
    const out = htmlToMarkdown('<ul><li>One<ul><li>Deeper</li></ul></li><li>Two</li></ul>')
    expect(out).toBe('- One\n  - Deeper\n- Two')
  })

  it('numbers ordered lists from one', () => {
    expect(htmlToMarkdown('<ol><li>First</li><li>Second</li></ol>')).toBe('1. First\n2. Second')
  })

  it('renders a table with a header row', () => {
    const out = htmlToMarkdown('<table><tr><th>Size</th><th>Price</th></tr><tr><td>1600mm</td><td>£249</td></tr></table>')
    expect(out).toBe('| Size | Price |\n| --- | --- |\n| 1600mm | £249 |')
  })

  it('pads a ragged table row instead of dropping it', () => {
    const out = htmlToMarkdown('<table><tr><th>A</th><th>B</th></tr><tr><td>only</td></tr></table>')
    expect(out).toBe('| A | B |\n| --- | --- |\n| only |   |')
  })

  it('escapes a pipe inside a cell so it cannot end the cell', () => {
    const out = htmlToMarkdown('<table><tr><th>A</th></tr><tr><td>x | y</td></tr></table>')
    expect(out).toContain('| x \\| y |')
  })

  it('quotes and code survive', () => {
    expect(htmlToMarkdown('<blockquote><p>Quite firm.</p></blockquote>')).toBe('> Quite firm.')
    expect(htmlToMarkdown('<pre>npm run dev</pre>')).toBe('```\nnpm run dev\n```')
  })

  it('decodes entities, including the ones a price list needs', () => {
    expect(htmlToMarkdown('<p>&pound;249 &amp; up &ndash; &#8220;firm&#8221;</p>'))
      .toBe('£249 & up – “firm”')
  })

  it('leaves a nonsensical numeric entity alone rather than throwing', () => {
    expect(htmlToMarkdown('<p>&#999999999999;</p>')).toBe('&#999999999999;')
  })

  it('throws away script and style contents entirely', () => {
    expect(htmlToMarkdown('<p>Before</p><script>alert("x")</script><style>p{color:red}</style><p>After</p>'))
      .toBe('Before\n\nAfter')
  })

  it('survives unclosed paragraphs and stray closing tags', () => {
    expect(htmlToMarkdown('<p>One<p>Two</div><p>Three')).toBe('One\n\nTwo\n\nThree')
  })

  it('escapes Markdown punctuation in prose so it renders as written', () => {
    expect(htmlToMarkdown('<p>2 * 3 and _underscores_ stay</p>')).toBe('2 \\* 3 and \\_underscores\\_ stay')
  })

  it('keeps unknown elements as their own text rather than losing them', () => {
    expect(htmlToMarkdown('<p>A <custom-thing>kept</custom-thing> word</p>')).toBe('A kept word')
  })

  it('does not let an unmatched close tag end the document', () => {
    expect(htmlToMarkdown('</div><p>Still here</p>')).toBe('Still here')
  })
})

describe('looksLikeHtml', () => {
  it('spots markup and leaves plain copy alone', () => {
    expect(looksLikeHtml('<p>hi</p>')).toBe(true)
    expect(looksLikeHtml('A perfectly ordinary sentence')).toBe(false)
    expect(looksLikeHtml('5 < 6 and 7 > 6')).toBe(false)
  })
})
