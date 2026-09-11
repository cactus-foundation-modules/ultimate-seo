import { describe, expect, it } from 'vitest'
import {
  EMPTY_FAQ_SET,
  MAX_FAQS_PUBLISHED,
  faqSection,
  normaliseFaqItems,
  normaliseFaqSet,
  resolveFaqs,
  type AiFaqItem,
} from './faqs'

const q = (question: string, answer = 'Yes.'): AiFaqItem => ({ question, answer })

describe('normaliseFaqSet', () => {
  it('reads a stored set', () => {
    expect(normaliseFaqSet({ items: [{ question: ' Will it fit? ', answer: ' Yes. ' }], inherit: false }))
      .toEqual({ items: [q('Will it fit?')], inherit: false })
  })

  it('treats a missing inherit flag as inheriting, because the flag arrived later', () => {
    expect(normaliseFaqSet({ items: [] }).inherit).toBe(true)
  })

  it('drops half-written rows rather than publishing a blank heading', () => {
    const set = normaliseFaqSet({ items: [
      { question: 'Answered?', answer: 'Yes.' },
      { question: 'Unanswered?', answer: '   ' },
      { question: '', answer: 'Orphan.' },
    ] })
    expect(set.items).toEqual([q('Answered?')])
  })

  it('reads anything unreadable as no questions rather than throwing', () => {
    for (const value of [null, undefined, 'nonsense', 42, [], { items: 'no' }]) {
      expect(normaliseFaqSet(value)).toEqual(EMPTY_FAQ_SET)
    }
  })

  it('reads a bare list for the shop-wide set', () => {
    expect(normaliseFaqItems([{ question: 'A?', answer: 'B' }])).toEqual([{ question: 'A?', answer: 'B' }])
    expect(normaliseFaqItems({ items: [] })).toEqual([])
  })
})

describe('resolveFaqs', () => {
  const levels = (over: Partial<Parameters<typeof resolveFaqs>[0]> = {}) => resolveFaqs({
    own: EMPTY_FAQ_SET,
    ancestors: [],
    shopWide: [],
    ...over,
  })

  it('prints nearest first', () => {
    const out = levels({
      own: { items: [q('Own?')], inherit: true },
      ancestors: [{ items: [q('Category?')], inherit: true }],
      shopWide: [q('Shop?')],
    })
    expect(out.map((i) => i.question)).toEqual(['Own?', 'Category?', 'Shop?'])
  })

  it('lets the nearest level overrule the same question further out', () => {
    const out = levels({
      own: { items: [{ question: 'How long is delivery?', answer: 'Two days.' }], inherit: true },
      shopWide: [{ question: '  how long is DELIVERY  ', answer: 'A week.' }],
    })
    expect(out).toEqual([{ question: 'How long is delivery?', answer: 'Two days.' }])
  })

  it('stops dead at a level that refuses to inherit', () => {
    expect(levels({
      own: { items: [q('Only?')], inherit: false },
      ancestors: [{ items: [q('Category?')], inherit: true }],
      shopWide: [q('Shop?')],
    }).map((i) => i.question)).toEqual(['Only?'])

    expect(levels({
      ancestors: [
        { items: [q('Near?')], inherit: false },
        { items: [q('Far?')], inherit: true },
      ],
      shopWide: [q('Shop?')],
    }).map((i) => i.question)).toEqual(['Near?'])
  })
})

describe('faqSection', () => {
  it('is null when there is nothing to publish', () => {
    expect(faqSection([])).toBeNull()
  })

  it('gives each question its own heading so a chunker keeps it with its answer', () => {
    const section = faqSection([q('Will it fit?', 'It is 60cm wide.')])
    expect(section?.heading).toBe('Questions and answers')
    expect(section?.body).toBe('#### Will it fit?\n\nIt is 60cm wide.')
  })

  it('caps a runaway set and says how many are left', () => {
    const many = Array.from({ length: MAX_FAQS_PUBLISHED + 4 }, (_, i) => q(`Question ${i}?`))
    const body = faqSection(many)?.body ?? ''
    expect(body.match(/^#### /gm)).toHaveLength(MAX_FAQS_PUBLISHED)
    expect(body).toContain('4 further questions are answered on the page itself.')
  })
})
