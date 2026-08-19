import { describe, expect, it } from 'vitest'
import { DuplicateIndex } from '@/modules/ultimate-seo/lib/duplicates'

const entries = [
  { key: 'core-page:a', title: 'Office Chairs', metaDescription: 'Chairs for offices.' },
  { key: 'core-page:b', title: 'office chairs ', metaDescription: 'Desks for offices.' },
  { key: 'shop-product:c', title: 'Standing Desk', metaDescription: null },
  { key: 'shop-product:d', title: 'Filing Cabinet', metaDescription: 'Chairs for offices.' },
]

describe('DuplicateIndex', () => {
  const index = new DuplicateIndex(entries)

  it('spots a title another page shares, ignoring case and padding', () => {
    expect(index.isDuplicateTitle('core-page:a', 'Office Chairs')).toBe(true)
    expect(index.isDuplicateTitle('core-page:b', 'office chairs ')).toBe(true)
  })

  it('does not count a page against itself', () => {
    expect(index.isDuplicateTitle('shop-product:c', 'Standing Desk')).toBe(false)
    expect(index.isDuplicateDescription('core-page:b', 'Desks for offices.')).toBe(false)
  })

  it('spots a shared meta description across content types', () => {
    expect(index.isDuplicateDescription('core-page:a', 'Chairs for offices.')).toBe(true)
    expect(index.isDuplicateDescription('shop-product:d', 'Chairs for offices.')).toBe(true)
  })

  it('treats empty strings as nothing to compare', () => {
    expect(index.isDuplicateTitle('core-page:a', '   ')).toBe(false)
    expect(index.isDuplicateDescription('shop-product:c', null)).toBe(false)
  })

  it('flags a page not in the index whose string is already taken', () => {
    // A page can be analysed while absent from the inventory (hidden product,
    // say). It contributed nothing to the counts, so one match is one rival.
    expect(index.isDuplicateTitle('shop-product:zz', 'Standing Desk')).toBe(true)
  })
})
