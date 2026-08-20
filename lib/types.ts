export type CheckStatus = 'pass' | 'warn' | 'fail'

export type SeoCheck = {
  key: string
  status: CheckStatus
  message: string
  /** Human suggestion; when the fix is applyable it is described here too. */
  suggestion?: string
}

export type AnalysisResult = {
  score: number
  checks: SeoCheck[]
}

// Every content type the Pages screen can list, in the order the type filter
// offers them. Exported as a list rather than only a union because the same set
// is needed at runtime by both API route schemas - and a union that only
// existed at compile time is exactly how the shop's own category, collection
// and filter-collection pages went years without being listed here at all.
export const ENTITY_TYPES = [
  'core-page',
  'gazette-post',
  'shop-product',
  'shop-category',
  'shop-collection',
  'filter-collection',
  'directory-entry',
] as const

export type EntityType = (typeof ENTITY_TYPES)[number]

/** One row in the unified content inventory. */
export type InventoryItem = {
  entityType: EntityType
  entityId: string
  title: string
  slug: string
  url: string
  status: string
  metaDescription: string | null
  hasOgImage: boolean
  /** Core pages can be edited from inside this module; module content deep-links out. */
  editable: boolean
  /** Admin-relative edit path for non-editable items, e.g. /m/gazette/posts/123 */
  editPath: string | null
  updatedAt: string | null
  // Joined from seo_page_meta
  focusKeyword: string | null
  score: number | null
  checks: SeoCheck[] | null
  analyzedAt: string | null
}

export type SeoTargets = {
  titleMin: number
  titleMax: number
  descMin: number
  descMax: number
  densityMin: number
  densityMax: number
  auditMaxPages: number
}

export const DEFAULT_TARGETS: SeoTargets = {
  titleMin: 30,
  titleMax: 60,
  descMin: 50,
  descMax: 160,
  densityMin: 0.5,
  densityMax: 2.5,
  auditMaxPages: 50,
}

export type SeoOrganization = {
  name: string
  legalName: string
  logoUrl: string
  sameAs: string[]
}

export type SeoSocial = {
  twitterHandle: string
}

export type SeoSettings = {
  organization: SeoOrganization
  social: SeoSocial
  targets: SeoTargets
}

export type PageMetaRow = {
  id: string
  entity_type: string
  entity_id: string
  focus_keyword: string | null
  notes: string | null
  score: number | null
  checks: SeoCheck[] | null
  analyzed_at: Date | null
}

export type AuditRun = {
  id: string
  trigger: string
  status: 'running' | 'complete' | 'partial' | 'failed'
  started_at: Date
  finished_at: Date | null
  pages_total: number
  pages_crawled: number
  summary: { errors: number; warnings: number; notices: number; avgResponseMs: number } | null
}

export type AuditIssue = {
  id: string
  run_id: string
  url: string
  severity: 'error' | 'warning' | 'notice'
  check_key: string
  message: string
  detail: Record<string, unknown> | null
}

export type RobotsRule = { id: string; path: string; note: string | null; created_at: Date }

export type SitemapEntry = {
  id: string
  path: string
  priority: number | null
  change_freq: string | null
  note: string | null
  created_at: Date
}
