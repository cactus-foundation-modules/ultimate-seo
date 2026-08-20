import { describe, it, expect } from 'vitest'
import {
  ISSUE_STALE,
  ISSUE_UNANALYSED,
  NO_FILTERS,
  filterRows,
  issueOptions,
  scoreBand,
  sortRows,
  summarise,
  toCsv,
  toRow,
} from './page-view'
import type { InventoryItem, SeoCheck } from './types'

function item(over: Partial<InventoryItem> = {}): InventoryItem {
  return {
    entityType: 'core-page',
    entityId: 'id-1',
    title: 'About us',
    slug: 'about-us',
    url: '/about-us',
    status: 'published',
    metaDescription: 'A description of a reasonable length that says what the page is for.',
    hasOgImage: true,
    editable: true,
    editPath: '/pages/id-1',
    updatedAt: '2026-01-01T00:00:00.000Z',
    focusKeyword: 'about us',
    score: 82,
    checks: null,
    analyzedAt: '2026-01-02T00:00:00.000Z',
    ...over,
  }
}

const checks = (...pairs: Array<[string, SeoCheck['status']]>): SeoCheck[] =>
  pairs.map(([key, status]) => ({ key, status, message: key }))

describe('scoreBand', () => {
  it('bands a score the way the badge colours it', () => {
    expect(scoreBand(null)).toBe('none')
    expect(scoreBand(80)).toBe('good')
    expect(scoreBand(79)).toBe('fair')
    expect(scoreBand(50)).toBe('fair')
    expect(scoreBand(49)).toBe('poor')
  })
})

describe('toRow', () => {
  it('counts failures and warnings apart from passes', () => {
    const row = toRow(item({ checks: checks(['desc-present', 'fail'], ['og-image', 'warn'], ['title-length', 'pass']) }))
    expect(row.failures).toBe(1)
    expect(row.warnings).toBe(1)
    expect(row.issueKeys).toEqual(['desc-present', 'og-image'])
  })

  it('calls a score stale when the page was edited after it was taken', () => {
    const row = toRow(item({ analyzedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' }))
    expect(row.stale).toBe(true)
    expect(row.issueKeys).toContain(ISSUE_STALE)
  })

  it('never calls a score stale where one of the two dates is unknown', () => {
    expect(toRow(item({ updatedAt: null })).stale).toBe(false)
    expect(toRow(item({ analyzedAt: null, score: null })).stale).toBe(false)
  })

  it('treats never-analysed as an issue of its own', () => {
    expect(toRow(item({ score: null, checks: null, analyzedAt: null })).issueKeys).toContain(ISSUE_UNANALYSED)
  })
})

describe('filterRows', () => {
  const rows = [
    toRow(item({ entityId: 'a', title: 'About us', score: 90, status: 'published' })),
    toRow(item({ entityId: 'b', title: 'Draft thing', slug: 'draft-thing', url: '/draft-thing', focusKeyword: 'draft', score: 30, status: 'draft', metaDescription: null, checks: checks(['desc-present', 'fail']) })),
    toRow(item({ entityId: 'c', entityType: 'shop-product', title: 'Oak desk', score: null, analyzedAt: null, focusKeyword: null })),
  ]

  it('matches the search against title, address, keyword and description', () => {
    expect(filterRows(rows, { ...NO_FILTERS, search: 'oak' }).map((r) => r.entityId)).toEqual(['c'])
    expect(filterRows(rows, { ...NO_FILTERS, search: 'about us' }).map((r) => r.entityId)).toEqual(['a'])
  })

  it('filters by content type, publication state and score band', () => {
    expect(filterRows(rows, { ...NO_FILTERS, type: 'shop-product' }).map((r) => r.entityId)).toEqual(['c'])
    expect(filterRows(rows, { ...NO_FILTERS, status: 'unpublished' }).map((r) => r.entityId)).toEqual(['b'])
    expect(filterRows(rows, { ...NO_FILTERS, band: 'good' }).map((r) => r.entityId)).toEqual(['a'])
    expect(filterRows(rows, { ...NO_FILTERS, band: 'none' }).map((r) => r.entityId)).toEqual(['c'])
  })

  it('filters by a single named issue', () => {
    expect(filterRows(rows, { ...NO_FILTERS, issue: 'desc-present' }).map((r) => r.entityId)).toEqual(['b'])
    expect(filterRows(rows, { ...NO_FILTERS, issue: ISSUE_UNANALYSED }).map((r) => r.entityId)).toEqual(['c'])
  })
})

describe('sortRows', () => {
  const rows = [
    toRow(item({ entityId: 'a', title: 'Alpha', score: 90 })),
    toRow(item({ entityId: 'b', title: 'Bravo', score: 30 })),
    toRow(item({ entityId: 'c', title: 'Charlie', score: null, analyzedAt: null })),
  ]

  it('sorts by score worst first, with the unscored at the bottom', () => {
    expect(sortRows(rows, 'score', 'asc').map((r) => r.entityId)).toEqual(['b', 'a', 'c'])
  })

  it('keeps the unscored at the bottom when the arrow is turned over', () => {
    expect(sortRows(rows, 'score', 'desc').map((r) => r.entityId)).toEqual(['a', 'b', 'c'])
  })

  it('sorts by title both ways', () => {
    expect(sortRows(rows, 'title', 'asc').map((r) => r.entityId)).toEqual(['a', 'b', 'c'])
    expect(sortRows(rows, 'title', 'desc').map((r) => r.entityId)).toEqual(['c', 'b', 'a'])
  })

  it('puts pages with no description first when sorting by description', () => {
    const withMissing = [...rows, toRow(item({ entityId: 'd', title: 'Delta', metaDescription: null }))]
    expect(sortRows(withMissing, 'description', 'asc')[0]!.entityId).toBe('d')
  })

  it('leaves the input array alone', () => {
    const before = rows.map((r) => r.entityId)
    sortRows(rows, 'title', 'desc')
    expect(rows.map((r) => r.entityId)).toEqual(before)
  })
})

describe('issueOptions', () => {
  it('lists every issue present, commonest first', () => {
    const rows = [
      toRow(item({ entityId: 'a', checks: checks(['desc-present', 'fail'], ['og-image', 'warn']) })),
      toRow(item({ entityId: 'b', checks: checks(['desc-present', 'fail']) })),
    ]
    expect(issueOptions(rows)).toEqual([
      { key: 'desc-present', label: 'No meta description', count: 2 },
      { key: 'og-image', label: 'No social image', count: 1 },
    ])
  })
})

describe('summarise', () => {
  it('averages only the pages that have actually been scored', () => {
    const s = summarise([
      toRow(item({ entityId: 'a', score: 90 })),
      toRow(item({ entityId: 'b', score: 30 })),
      toRow(item({ entityId: 'c', score: null, analyzedAt: null, metaDescription: null, focusKeyword: null })),
    ])
    expect(s.total).toBe(3)
    expect(s.analysed).toBe(2)
    expect(s.averageScore).toBe(60)
    expect(s.good).toBe(1)
    expect(s.poor).toBe(1)
    expect(s.unanalysed).toBe(1)
    expect(s.missingDescription).toBe(1)
    expect(s.missingKeyword).toBe(1)
  })

  it('has no average at all when nothing has been analysed', () => {
    expect(summarise([toRow(item({ score: null, analyzedAt: null }))]).averageScore).toBeNull()
  })
})

describe('toCsv', () => {
  it('quotes the separators and doubles the quotes', () => {
    const csv = toCsv([toRow(item({ title: 'Desks, chairs and "things"' }))], (t) => t)
    expect(csv.split('\r\n')[1]).toContain('"Desks, chairs and ""things"""')
  })

  it('defuses a title a spreadsheet would run as a formula', () => {
    const csv = toCsv([toRow(item({ title: '=SUM(A1:A9)' }))], (t) => t)
    expect(csv.split('\r\n')[1]).toContain(`"'=SUM(A1:A9)"`)
  })
})
