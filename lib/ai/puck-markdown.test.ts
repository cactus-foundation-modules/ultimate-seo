import { describe, expect, it } from 'vitest'
import { puckToMarkdown } from './puck-markdown'

describe('puckToMarkdown', () => {
  it('is empty for anything unreadable', () => {
    expect(puckToMarkdown(null)).toBe('')
    expect(puckToMarkdown('nonsense')).toBe('')
    expect(puckToMarkdown({})).toBe('')
  })

  it('makes a heading block a heading at its own level', () => {
    const data = { content: [{ type: 'Heading', props: { id: 'a', text: 'Office desks', level: 1 } }] }
    expect(puckToMarkdown(data)).toBe('# Office desks')
  })

  it('defaults an unreadable heading level to two rather than guessing wildly', () => {
    const data = { content: [{ type: 'Heading', props: { id: 'a', text: 'Desks', level: 'huge' } }] }
    expect(puckToMarkdown(data)).toBe('## Desks')
  })

  it('converts rich text through the HTML converter', () => {
    const data = { content: [{ type: 'Text', props: { id: 'a', content: '<p>Sturdy <strong>oak</strong>.</p><ul><li>1600mm</li></ul>' } }] }
    expect(puckToMarkdown(data)).toBe('Sturdy **oak**.\n\n- 1600mm')
  })

  it('skips plumbing props and keeps copy', () => {
    const data = {
      content: [{
        type: 'Card',
        props: { id: 'a', title: 'Task chair', href: '/shop/products/task-chair', backgroundColour: '#fff', paddingTop: '2rem', body: 'Adjustable everything.' },
      }],
    }
    expect(puckToMarkdown(data)).toBe('Task chair\n\nAdjustable everything.')
  })

  it('keeps an image block as an image with its alt text', () => {
    const data = { content: [{ type: 'ImageBlock', props: { id: 'a', src: '/desk.jpg', alt: 'An oak desk' } }] }
    expect(puckToMarkdown(data)).toBe('![An oak desk](/desk.jpg)')
  })

  it('walks arrays of sub-objects, so an FAQ block keeps both halves', () => {
    const data = {
      content: [{
        type: 'SeoFaq',
        props: { id: 'a', items: [{ question: 'Do you deliver?', answer: 'Yes, everywhere.' }] },
      }],
    }
    expect(puckToMarkdown(data)).toBe('Do you deliver?\n\nYes, everywhere.')
  })

  it('renders a block’s drop zone straight after the block', () => {
    const data = {
      content: [
        { type: 'Heading', props: { id: 'h1', text: 'Top', level: 2 } },
        { type: 'Columns', props: { id: 'col' } },
        { type: 'Heading', props: { id: 'h2', text: 'Bottom', level: 2 } },
      ],
      zones: { 'col:left': [{ type: 'Text', props: { id: 't', content: 'Inside the column.' } }] },
    }
    expect(puckToMarkdown(data)).toBe('## Top\n\nInside the column.\n\n## Bottom')
  })

  it('still renders a zone whose parent block has gone', () => {
    const data = {
      content: [{ type: 'Heading', props: { id: 'h1', text: 'Only heading', level: 2 } }],
      zones: { 'deleted-block:main': [{ type: 'Text', props: { id: 't', content: 'Orphaned but still copy.' } }] },
    }
    expect(puckToMarkdown(data)).toBe('## Only heading\n\nOrphaned but still copy.')
  })

  it('drops a paragraph repeated back to back by two prop names', () => {
    const data = { content: [{ type: 'Banner', props: { id: 'a', title: 'Free delivery', label: 'Free delivery' } }] }
    expect(puckToMarkdown(data)).toBe('Free delivery')
  })

  it('drops a block’s settings without dropping copy that reads like one', () => {
    const data = {
      content: [{
        type: 'Section',
        props: { id: 'a', heading: 'Top', shadow: 'none', decoration: 'underline', reveal: 'off', body: 'Cover the desk.' },
      }],
    }
    expect(puckToMarkdown(data)).toBe('Top\n\nCover the desk.')
  })

  it('does not loop forever on a zone that owns itself', () => {
    const data = {
      content: [{ type: 'Columns', props: { id: 'col' } }],
      zones: { 'col:main': [{ type: 'Columns', props: { id: 'col' } }] },
    }
    expect(() => puckToMarkdown(data)).not.toThrow()
  })
})

describe('puckToMarkdown repetition', () => {
  const long = 'A paragraph long enough to be worth reading twice, which is exactly why it should not be printed twice on the same page. '.repeat(2)

  it('drops a long block repeated further down the document', () => {
    const data = {
      content: [
        { type: 'Rich', props: { id: 'a', content: `<p>${long}</p>` } },
        { type: 'Spacer', props: { id: 'b', label: 'Read more' } },
        { type: 'Rich', props: { id: 'c', content: `<p>${long}</p>` } },
      ],
    }
    const out = puckToMarkdown(data)
    expect(out.split(long.trim()).length - 1).toBe(1)
  })

  it('keeps a short heading that legitimately recurs', () => {
    const data = {
      content: [
        { type: 'Heading', props: { id: 'a', text: 'Delivery', level: 2 } },
        { type: 'Text', props: { id: 'b', content: '<p>Two to three days.</p>' } },
        { type: 'Heading', props: { id: 'c', text: 'Delivery', level: 2 } },
      ],
    }
    expect(puckToMarkdown(data).match(/## Delivery/g)).toHaveLength(2)
  })
})
