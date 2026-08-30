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

// The schema.org types worth offering a site owner. Organization is the safe
// default; the rest are the ones Google actually treats differently, and a
// LocalBusiness that is not one is worse than no markup at all.
export const ORG_TYPES = [
  'Organization',
  'LocalBusiness',
  'Store',
  'OnlineStore',
  'Corporation',
  'ProfessionalService',
] as const

export type OrgType = (typeof ORG_TYPES)[number]

export function isOrgType(value: unknown): value is OrgType {
  return typeof value === 'string' && (ORG_TYPES as readonly string[]).includes(value)
}

/** The types whose address, phone and opening hours search engines act on. */
export const LOCAL_ORG_TYPES: ReadonlySet<string> = new Set([
  'LocalBusiness',
  'Store',
  'ProfessionalService',
])

/** schema.org's contactType vocabulary, in the order a shop is likely to want them. */
export const CONTACT_TYPES = [
  'customer service',
  'sales',
  'technical support',
  'billing support',
  'bill payment',
  'returns',
  'reservations',
  'credit card support',
  'emergency',
] as const

export type ContactType = (typeof CONTACT_TYPES)[number]

/**
 * The site-wide structured data profile: everything needed to describe the
 * business behind the site once, emitted on every public page.
 *
 * Distinct from `SeoOrganization` above, which is the older four-field record
 * the page-builder block pre-fills its props from. That one stays as it is -
 * widening it would change what the block writes into stored page props.
 */
export type SeoStructuredData = {
  /**
   * One or more schema.org types. More than one is legitimate and often better:
   * an online shop is both an `Organization` and an `OnlineStore`, and saying so
   * is how it qualifies for both sets of result treatments. Emitted as a bare
   * string when there is one, an array when there are several.
   */
  orgTypes: OrgType[]
  name: string
  alternateName: string
  legalName: string
  description: string
  /** Blank means "this site's own address", resolved at emit time. */
  url: string
  logoUrl: string
  /** Pixel dimensions of the logo file. Null when not stated. */
  logoWidth: number | null
  logoHeight: number | null
  logoCaption: string
  imageUrl: string
  telephone: string
  email: string
  streetAddress: string
  addressLocality: string
  addressRegion: string
  postalCode: string
  addressCountry: string
  vatId: string
  taxId: string
  /** D-U-N-S number, digits only. */
  duns: string
  /** ISO 6523 identifier, e.g. "0060:234986302". */
  iso6523Code: string
  /** A named registration number emitted as a PropertyValue, e.g. Companies House. */
  identifierName: string
  identifierValue: string
  foundingDate: string
  priceRange: string
  /** schema.org openingHours strings, e.g. "Mo-Fr 09:00-17:30". */
  openingHours: string[]
  areaServed: string[]
  /** Official profile URLs. Blank falls back to the list on Settings → SEO. */
  sameAs: string[]
  /** Contact point. Emitted only when at least one of these carries a value. */
  contactType: string
  contactEmail: string
  contactTelephone: string
  contactAreaServed: string[]
  contactAvailableLanguage: string[]
  emitOrganization: boolean
  emitWebSite: boolean
  emitSearchAction: boolean
  /** Must contain {search_term_string}; blank falls back to the default below. */
  searchUrlTemplate: string
}

export const DEFAULT_SEARCH_URL_TEMPLATE = '/search?q={search_term_string}'

export const DEFAULT_STRUCTURED_DATA: SeoStructuredData = {
  orgTypes: ['Organization'],
  name: '',
  alternateName: '',
  legalName: '',
  description: '',
  url: '',
  logoUrl: '',
  logoWidth: null,
  logoHeight: null,
  logoCaption: '',
  imageUrl: '',
  telephone: '',
  email: '',
  streetAddress: '',
  addressLocality: '',
  addressRegion: '',
  postalCode: '',
  addressCountry: '',
  vatId: '',
  taxId: '',
  duns: '',
  iso6523Code: '',
  identifierName: '',
  identifierValue: '',
  foundingDate: '',
  priceRange: '',
  openingHours: [],
  areaServed: [],
  sameAs: [],
  contactType: '',
  contactEmail: '',
  contactTelephone: '',
  contactAreaServed: [],
  contactAvailableLanguage: [],
  // Off until the owner has filled the profile in and looked at the preview.
  // Publishing a half-built Organization block on every page of the site the
  // moment the module updates is not a decision this module gets to make.
  emitOrganization: false,
  emitWebSite: false,
  emitSearchAction: false,
  searchUrlTemplate: DEFAULT_SEARCH_URL_TEMPLATE,
}

export type SeoSettings = {
  organization: SeoOrganization
  social: SeoSocial
  targets: SeoTargets
  structuredData: SeoStructuredData
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
