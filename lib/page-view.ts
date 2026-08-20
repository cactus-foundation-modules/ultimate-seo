// The pure half of the SEO Pages screen: what a row is worth, how the table is
// filtered and sorted, and what leaves as a spreadsheet. No React, no DOM, no
// database - so the screen's actual decisions are unit-testable rather than only
// clickable.
import type { CheckStatus, InventoryItem, SeoCheck } from './types'

export type ScoreBand = 'good' | 'fair' | 'poor' | 'none'

export type SortKey = 'title' | 'type' | 'status' | 'description' | 'keyword' | 'issues' | 'score' | 'analysed' | 'updated'
export type SortDir = 'asc' | 'desc'

/** Everything the table shows that isn't stored: worked out once per row. */
export type PageRow = InventoryItem & {
  key: string
  band: ScoreBand
  failures: number
  warnings: number
  /** The content has been edited since it was last scored, so the score is a memory. */
  stale: boolean
  /** Check keys currently failing or warning - what the issue filter matches on. */
  issueKeys: string[]
}

export type Filters = {
  search: string
  type: string
  status: string
  band: string
  /** A check key, or one of the synthetic keys below. '' = no issue filter. */
  issue: string
}

export const NO_FILTERS: Filters = { search: '', type: 'all', status: 'all', band: 'all', issue: '' }

// Synthetic issue keys: not checks the analyser emits, but the two states an
// owner most wants to pick out of a list of several hundred pages.
export const ISSUE_UNANALYSED = '_unanalysed'
export const ISSUE_STALE = '_stale'

const ISSUE_LABELS: Record<string, string> = {
  [ISSUE_UNANALYSED]: 'Never analysed',
  [ISSUE_STALE]: 'Score out of date',
  'title-present': 'No title',
  'title-length': 'Title length',
  'title-unique': 'Duplicate title',
  'desc-present': 'No meta description',
  'desc-length': 'Description length',
  'desc-unique': 'Duplicate description',
  'slug-format': 'Untidy slug',
  'og-image': 'No social image',
  'h1-count': 'Heading structure',
  'content-length': 'Thin content',
  'image-alts': 'Missing alt text',
  'internal-links': 'No internal links',
  'keyword-set': 'No focus keyword',
  'keyword-title': 'Keyword not in title',
  'keyword-desc': 'Keyword not in description',
  'keyword-slug': 'Keyword not in slug',
  'keyword-density': 'Keyword density',
  readability: 'Readability',
}

export function issueLabel(key: string): string {
  return ISSUE_LABELS[key] ?? key
}

export function scoreBand(score: number | null): ScoreBand {
  if (score === null) return 'none'
  if (score >= 80) return 'good'
  if (score >= 50) return 'fair'
  return 'poor'
}

function countBy(checks: SeoCheck[] | null, status: CheckStatus): number {
  return checks ? checks.filter((c) => c.status === status).length : 0
}

export function toRow(item: InventoryItem): PageRow {
  const failures = countBy(item.checks, 'fail')
  const warnings = countBy(item.checks, 'warn')
  // Analysed before the content was last touched: the score describes a page
  // that no longer exists. Only decidable where we know both dates - a Directory
  // entry records no updatedAt, so it is never called stale rather than being
  // guessed at.
  const stale = !!item.analyzedAt && !!item.updatedAt && new Date(item.analyzedAt) < new Date(item.updatedAt)
  const issueKeys = (item.checks ?? [])
    .filter((c) => c.status !== 'pass')
    .map((c) => c.key)
  if (item.score === null) issueKeys.push(ISSUE_UNANALYSED)
  if (stale) issueKeys.push(ISSUE_STALE)
  return {
    ...item,
    key: `${item.entityType}:${item.entityId}`,
    band: scoreBand(item.score),
    failures,
    warnings,
    stale,
    issueKeys,
  }
}

/** Every issue present in the data, commonest first, for the issue picker. */
export function issueOptions(rows: PageRow[]): Array<{ key: string; label: string; count: number }> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const key of row.issueKeys) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: issueLabel(key), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export function filterRows(rows: PageRow[], filters: Filters): PageRow[] {
  const q = filters.search.trim().toLowerCase()
  return rows.filter((row) => {
    if (filters.type !== 'all' && row.entityType !== filters.type) return false
    if (filters.status === 'published' && row.status !== 'published') return false
    if (filters.status === 'unpublished' && row.status === 'published') return false
    if (filters.band !== 'all' && row.band !== filters.band) return false
    if (filters.issue && !row.issueKeys.includes(filters.issue)) return false
    if (q) {
      const haystack = `${row.title} ${row.slug} ${row.url} ${row.focusKeyword ?? ''} ${row.metaDescription ?? ''}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })
}

// Score, keyword and dates are all genuinely absent on some rows, and absent is
// not "worst". They sort to the bottom whichever way the arrow points, so
// flipping the direction reorders what IS known instead of dragging a wall of
// blanks to the top.
function compare(a: PageRow, b: PageRow, key: SortKey): number {
  switch (key) {
    case 'title': return a.title.localeCompare(b.title)
    case 'type': return a.entityType.localeCompare(b.entityType) || a.title.localeCompare(b.title)
    case 'status': return a.status.localeCompare(b.status) || a.title.localeCompare(b.title)
    // Ascending means "missing first": that is the order somebody sorting by
    // this column came for, and the arrow still flips it.
    case 'description': return Number(!!a.metaDescription) - Number(!!b.metaDescription) || a.title.localeCompare(b.title)
    case 'keyword': return (a.focusKeyword ?? '').localeCompare(b.focusKeyword ?? '') || a.title.localeCompare(b.title)
    case 'issues': return (a.failures * 100 + a.warnings) - (b.failures * 100 + b.warnings) || a.title.localeCompare(b.title)
    case 'score': return (a.score ?? 0) - (b.score ?? 0) || a.title.localeCompare(b.title)
    case 'analysed': return Date.parse(a.analyzedAt ?? '') - Date.parse(b.analyzedAt ?? '')
    case 'updated': return Date.parse(a.updatedAt ?? '') - Date.parse(b.updatedAt ?? '')
  }
}

function missingFor(row: PageRow, key: SortKey): boolean {
  if (key === 'score') return row.score === null
  if (key === 'keyword') return !row.focusKeyword
  if (key === 'analysed') return !row.analyzedAt
  if (key === 'updated') return !row.updatedAt
  return false
}

/** Which way round a column is most useful the FIRST time it is clicked. */
export const INITIAL_DIR: Record<SortKey, SortDir> = {
  title: 'asc',
  type: 'asc',
  status: 'asc',
  description: 'asc',
  keyword: 'asc',
  // Most problems first, worst score first, longest-unlooked-at first: nobody
  // opens this screen to admire the pages that are already fine.
  issues: 'desc',
  score: 'asc',
  analysed: 'asc',
  updated: 'desc',
}

export function sortRows(rows: PageRow[], key: SortKey, dir: SortDir): PageRow[] {
  const sorted = [...rows].sort((a, b) => {
    const aMissing = missingFor(a, key)
    const bMissing = missingFor(b, key)
    if (aMissing !== bMissing) return aMissing ? 1 : -1
    if (aMissing && bMissing) return a.title.localeCompare(b.title)
    const result = compare(a, b, key)
    return dir === 'asc' ? result : -result
  })
  return sorted
}

export type Summary = {
  total: number
  analysed: number
  averageScore: number | null
  good: number
  fair: number
  poor: number
  unanalysed: number
  missingDescription: number
  missingKeyword: number
  stale: number
}

export function summarise(rows: PageRow[]): Summary {
  const scores = rows.filter((r) => r.score !== null).map((r) => r.score as number)
  return {
    total: rows.length,
    analysed: scores.length,
    averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    good: rows.filter((r) => r.band === 'good').length,
    fair: rows.filter((r) => r.band === 'fair').length,
    poor: rows.filter((r) => r.band === 'poor').length,
    unanalysed: rows.filter((r) => r.band === 'none').length,
    missingDescription: rows.filter((r) => !r.metaDescription).length,
    missingKeyword: rows.filter((r) => !r.focusKeyword).length,
    stale: rows.filter((r) => r.stale).length,
  }
}

const CSV_HEADERS = ['Type', 'Title', 'URL', 'Status', 'Meta description', 'Focus keyword', 'Score', 'Failures', 'Warnings', 'Last analysed', 'Content updated']

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value)
  // A leading =, +, - or @ is read as a formula by every spreadsheet worth the
  // name, so a title starting with one is quoted AND prefixed.
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${guarded.replace(/"/g, '""')}"`
}

/** The current view as a spreadsheet, in the order it is on screen. */
export function toCsv(rows: PageRow[], typeLabel: (t: string) => string): string {
  const lines = [CSV_HEADERS.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push([
      typeLabel(row.entityType),
      row.title,
      row.url,
      row.status,
      row.metaDescription ?? '',
      row.focusKeyword ?? '',
      row.score,
      row.failures,
      row.warnings,
      row.analyzedAt ?? '',
      row.updatedAt ?? '',
    ].map(csvCell).join(','))
  }
  return lines.join('\r\n')
}
