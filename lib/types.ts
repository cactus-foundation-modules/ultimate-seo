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
  ai: SeoAiSettings
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

// ---------------------------------------------------------------------------
// The AI half: what the site publishes for language models, and what it lets
// them do. See lib/ai/ for the crawler table and the builders.
// ---------------------------------------------------------------------------

/** yes / no / say nothing. Unset is not the same as no: it leaves the line out. */
export type ContentSignal = 'yes' | 'no' | 'unset'

export type SeoContentSignals = {
  /** May this page be shown in search results and cited in answers. */
  search: ContentSignal
  /** May its text be fed to a model answering a question right now. */
  aiInput: ContentSignal
  /** May its text be used to train a model. */
  aiTrain: ContentSignal
}

export type CrawlerStance = 'allow' | 'block'

export type SeoAiSettings = {
  /**
   * The paragraph at the top of llms.txt: what this site is, in the owner's own
   * words. Blank falls back to the site's own description.
   */
  siteSummary: string
  /** Publish /llms.txt. */
  llmsTxt: boolean
  /** Publish /llms-full.txt as well - the index with the short documents inlined. */
  llmsFull: boolean
  /**
   * Publish the business's own identity at the top of llms.txt, and answer it
   * over the agent endpoint: legal name, registration number, VAT, address,
   * where it trades, how to reach it.
   *
   * Read straight off the structured-data profile, so it says exactly what the
   * JSON-LD on every page already says. An assistant deciding whether to put a
   * supplier in front of somebody is deciding whether that supplier is
   * identifiable, and this is the file it reads to find out.
   */
  businessFacts: boolean
  /** Publish the Markdown twin of each page at its own address with .md on the end. */
  markdown: boolean
  /** Which content types get a twin. Everything, unless an owner narrows it. */
  markdownTypes: EntityType[]
  /** Offer the per-entity abstract field on the Pages screen. */
  abstracts: boolean
  /**
   * Publish each page's own structured data - breadcrumbs, blog posts,
   * collection pages, directory listings. Costs one lookup per page render.
   */
  pageStructuredData: boolean
  /**
   * Tell each page's reader where its Markdown twin is, with a
   * `<link rel="alternate" type="text/markdown">`. Shares the same lookup as
   * the line above, so having both costs no more than having one.
   */
  pageMarkdownLink: boolean
  /** Count AI crawler visits and AI-assistant referrals. Costs money; see the screen. */
  analytics: boolean
  /** Days of counts to keep. The weekly job drops anything older. */
  analyticsRetentionDays: number
  /** Serve the read-only agent endpoint. Costs money; see the screen. */
  mcp: boolean
  /** Most rows one agent search may return. */
  mcpMaxResults: number
  /** Per-crawler stance, keyed by AI_CRAWLERS key. Missing = allowed. */
  crawlerPolicy: Record<string, CrawlerStance>
  contentSignals: SeoContentSignals
}

export const DEFAULT_AI_SETTINGS: SeoAiSettings = {
  siteSummary: '',
  // The two discovery files and the Markdown twins are the feature, and they are
  // served from a table this module builds on its own schedule - a fetch of one
  // is a single indexed read, so they are on from the start. The three below
  // them are not: each one costs real money on every page view or every agent
  // request, so each is a decision an owner makes deliberately.
  llmsTxt: true,
  llmsFull: true,
  // On with the rest of the index it belongs to. It publishes nothing the owner
  // has not already typed into the structured-data profile, and nothing the
  // JSON-LD on every public page is not already saying out loud; it simply says
  // it somewhere a reader that does not parse HTML can find it.
  businessFacts: true,
  markdown: true,
  markdownTypes: [...ENTITY_TYPES],
  abstracts: true,
  // Both off: unlike the twins, which are served from a table and cost the site
  // nothing until somebody fetches one, these two put a database read on the
  // render of every public page. Worth having, and worth being asked for.
  pageStructuredData: false,
  pageMarkdownLink: false,
  analytics: false,
  analyticsRetentionDays: 90,
  mcp: false,
  mcpMaxResults: 25,
  // Empty, not "everything blocked": robots.txt says nothing about these
  // crawlers today, and an update that quietly started blocking them would
  // change what a live site publishes without anybody asking for it.
  crawlerPolicy: {},
  contentSignals: { search: 'unset', aiInput: 'unset', aiTrain: 'unset' },
}

/** One materialised Markdown twin. */
export type LlmDocumentRow = {
  id: string
  entity_type: string
  entity_id: string
  path: string
  title: string
  summary: string | null
  markdown: string
  byte_size: number
  source_updated_at: Date | null
  built_at: Date
}

export type AiHitRow = {
  day: Date
  kind: 'crawler' | 'referral'
  agent: string
  path: string
  hits: number
  last_seen: Date
}
