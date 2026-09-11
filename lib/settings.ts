import { prisma } from '@/lib/db/prisma'
import { AI_CRAWLER_KEYS } from './ai/crawlers'
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_SEARCH_URL_TEMPLATE,
  DEFAULT_STRUCTURED_DATA,
  DEFAULT_TARGETS,
  ENTITY_TYPES,
  isOrgType,
  isReturnFees,
  isReturnMethod,
  isReturnPolicyCategory,
  type ContentSignal,
  type CrawlerStance,
  type EntityType,
  type SeoAiSettings,
  type SeoSettings,
  type SeoStructuredData,
  type SeoTargets,
} from './types'

type SettingsRow = {
  organization: Record<string, unknown> | null
  social: Record<string, unknown> | null
  targets: Record<string, unknown> | null
  structured_data: Record<string, unknown> | null
  ai: Record<string, unknown> | null
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function strList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((s): s is string => typeof s === 'string').map((s) => s.trim()).filter(Boolean).slice(0, max)
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null
}

/**
 * Money, which unlike every other number on this screen is allowed to be zero
 * and is not allowed to be rounded to the pound. A free return is a real answer
 * and £4.99 is a real fee.
 */
function moneyOrNull(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null
  return Math.round(v * 100) / 100
}

export function normaliseTargets(raw: Record<string, unknown> | null): SeoTargets {
  const d = DEFAULT_TARGETS
  return {
    titleMin: num(raw?.titleMin, d.titleMin),
    titleMax: num(raw?.titleMax, d.titleMax),
    descMin: num(raw?.descMin, d.descMin),
    descMax: num(raw?.descMax, d.descMax),
    densityMin: num(raw?.densityMin, d.densityMin),
    densityMax: num(raw?.densityMax, d.densityMax),
    auditMaxPages: Math.min(500, Math.max(1, num(raw?.auditMaxPages, d.auditMaxPages))),
  }
}

/**
 * Accepts either shape of the type field: the list, or a single `orgType`
 * string. Nothing released ever wrote the string form - it existed only while
 * this screen was being built - but reading an unrecognised shape back as an
 * empty list would silently blank the `@type` on a live site, and the cheapest
 * place to be forgiving about a JSONB column is on the way out of it.
 */
function orgTypes(raw: Record<string, unknown> | null): SeoStructuredData['orgTypes'] {
  const source = Array.isArray(raw?.orgTypes)
    ? raw.orgTypes
    : typeof raw?.orgType === 'string'
      ? [raw.orgType]
      : []
  const types = [...new Set(source.filter(isOrgType))]
  return types.length ? types : [...DEFAULT_STRUCTURED_DATA.orgTypes]
}

/**
 * Every field defaulted individually rather than by spreading the stored blob
 * over the defaults: the column is JSONB, so its contents are whatever shape
 * was written the day it was written. A settings row saved before a field
 * existed has to come back as the default for that field, not as undefined
 * dressed up in the type of a string.
 */
export function normaliseStructuredData(raw: Record<string, unknown> | null): SeoStructuredData {
  const d = DEFAULT_STRUCTURED_DATA
  return {
    orgTypes: orgTypes(raw),
    name: str(raw?.name),
    alternateName: str(raw?.alternateName),
    legalName: str(raw?.legalName),
    description: str(raw?.description),
    url: str(raw?.url),
    logoUrl: str(raw?.logoUrl),
    logoWidth: numOrNull(raw?.logoWidth),
    logoHeight: numOrNull(raw?.logoHeight),
    logoCaption: str(raw?.logoCaption),
    imageUrl: str(raw?.imageUrl),
    telephone: str(raw?.telephone),
    email: str(raw?.email),
    streetAddress: str(raw?.streetAddress),
    addressLocality: str(raw?.addressLocality),
    addressRegion: str(raw?.addressRegion),
    postalCode: str(raw?.postalCode),
    addressCountry: str(raw?.addressCountry),
    vatId: str(raw?.vatId),
    taxId: str(raw?.taxId),
    duns: str(raw?.duns),
    iso6523Code: str(raw?.iso6523Code),
    identifierName: str(raw?.identifierName),
    identifierValue: str(raw?.identifierValue),
    foundingDate: str(raw?.foundingDate),
    priceRange: str(raw?.priceRange),
    openingHours: strList(raw?.openingHours, 14),
    areaServed: strList(raw?.areaServed, 30),
    sameAs: strList(raw?.sameAs, 30),
    contactType: str(raw?.contactType),
    contactEmail: str(raw?.contactEmail),
    contactTelephone: str(raw?.contactTelephone),
    contactAreaServed: strList(raw?.contactAreaServed, 30),
    contactAvailableLanguage: strList(raw?.contactAvailableLanguage, 20),
    returnPolicyCategory: isReturnPolicyCategory(raw?.returnPolicyCategory) ? raw.returnPolicyCategory : '',
    returnDays: numOrNull(raw?.returnDays),
    returnMethod: isReturnMethod(raw?.returnMethod) ? raw.returnMethod : '',
    returnFees: isReturnFees(raw?.returnFees) ? raw.returnFees : '',
    returnFeeAmount: moneyOrNull(raw?.returnFeeAmount),
    returnFeeCurrency: str(raw?.returnFeeCurrency).trim().toUpperCase().slice(0, 3),
    returnPolicyCountry: str(raw?.returnPolicyCountry),
    returnPolicyUrl: str(raw?.returnPolicyUrl),
    emitOrganization: bool(raw?.emitOrganization, d.emitOrganization),
    emitWebSite: bool(raw?.emitWebSite, d.emitWebSite),
    emitSearchAction: bool(raw?.emitSearchAction, d.emitSearchAction),
    searchUrlTemplate: str(raw?.searchUrlTemplate) || DEFAULT_SEARCH_URL_TEMPLATE,
  }
}

export async function getSeoSettings(): Promise<SeoSettings> {
  const rows = await prisma.$queryRaw<SettingsRow[]>`
    SELECT "organization", "social", "targets", "structured_data", "ai" FROM "seo_settings" WHERE "id" = 'singleton'
  `
  const row = rows[0]
  const org = row?.organization ?? null
  const sameAs = Array.isArray(org?.sameAs) ? org.sameAs.filter((s): s is string => typeof s === 'string') : []
  return {
    organization: {
      name: str(org?.name),
      legalName: str(org?.legalName),
      logoUrl: str(org?.logoUrl),
      sameAs,
    },
    social: { twitterHandle: str(row?.social?.twitterHandle) },
    targets: normaliseTargets(row?.targets ?? null),
    structuredData: normaliseStructuredData(row?.structured_data ?? null),
    ai: normaliseAiSettings(row?.ai ?? null),
  }
}

/**
 * Writes every column this form owns - and deliberately NOT "ai".
 *
 * The structured-data column is in here because it once was not, and the
 * general settings form quietly blanked it every time it saved. Rather than add
 * a second thing every caller has to remember to carry through, the AI settings
 * get their own writer below and this statement never names their column: a
 * column nobody writes cannot be a column somebody accidentally clears.
 */
export async function saveSeoSettings(settings: Omit<SeoSettings, 'ai'>): Promise<void> {
  const organization = JSON.stringify(settings.organization)
  const social = JSON.stringify(settings.social)
  const targets = JSON.stringify(normaliseTargets(settings.targets as unknown as Record<string, unknown>))
  const structuredData = JSON.stringify(
    normaliseStructuredData(settings.structuredData as unknown as Record<string, unknown>)
  )
  await prisma.$executeRaw`
    INSERT INTO "seo_settings" ("id", "organization", "social", "targets", "structured_data", "updated_at")
    VALUES ('singleton', ${organization}::jsonb, ${social}::jsonb, ${targets}::jsonb, ${structuredData}::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO UPDATE SET
      "organization" = EXCLUDED."organization",
      "social" = EXCLUDED."social",
      "targets" = EXCLUDED."targets",
      "structured_data" = EXCLUDED."structured_data",
      "updated_at" = CURRENT_TIMESTAMP
  `
}


// ---------------------------------------------------------------------------
// The AI half
// ---------------------------------------------------------------------------

function signal(v: unknown, fallback: ContentSignal): ContentSignal {
  return v === 'yes' || v === 'no' || v === 'unset' ? v : fallback
}

function entityTypes(v: unknown): EntityType[] {
  if (!Array.isArray(v)) return [...ENTITY_TYPES]
  const allowed = new Set<string>(ENTITY_TYPES)
  const picked = v.filter((t): t is EntityType => typeof t === 'string' && allowed.has(t))
  // An empty list is a real answer - "no Markdown twins at all" - and is left as
  // one. Only a column that has never been written falls back to everything.
  return [...new Set(picked)]
}

function crawlerPolicy(v: unknown): Record<string, CrawlerStance> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, CrawlerStance> = {}
  for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
    // A key that is not a crawler this build knows about is dropped rather than
    // kept: it would otherwise become a User-agent line naming nothing, and a
    // robots.txt full of those is how an owner stops trusting the file.
    if (!AI_CRAWLER_KEYS.has(key)) continue
    if (value === 'allow' || value === 'block') out[key] = value
  }
  return out
}

/**
 * Every field defaulted individually rather than spread over the defaults, for
 * the same reason normaliseStructuredData does it: the column is JSONB, so its
 * contents are whatever shape was written the day it was written.
 */
export function normaliseAiSettings(raw: Record<string, unknown> | null): SeoAiSettings {
  const d = DEFAULT_AI_SETTINGS
  const signals = (raw?.contentSignals ?? null) as Record<string, unknown> | null
  return {
    siteSummary: str(raw?.siteSummary).slice(0, 2000),
    llmsTxt: bool(raw?.llmsTxt, d.llmsTxt),
    llmsFull: bool(raw?.llmsFull, d.llmsFull),
    businessFacts: bool(raw?.businessFacts, d.businessFacts),
    markdown: bool(raw?.markdown, d.markdown),
    markdownTypes: raw && 'markdownTypes' in raw ? entityTypes(raw.markdownTypes) : [...d.markdownTypes],
    abstracts: bool(raw?.abstracts, d.abstracts),
    pageStructuredData: bool(raw?.pageStructuredData, d.pageStructuredData),
    pageMarkdownLink: bool(raw?.pageMarkdownLink, d.pageMarkdownLink),
    analytics: bool(raw?.analytics, d.analytics),
    analyticsRetentionDays: Math.min(730, Math.max(7, num(raw?.analyticsRetentionDays, d.analyticsRetentionDays))),
    publishSupplier: bool(raw?.publishSupplier, d.publishSupplier),
    mcp: bool(raw?.mcp, d.mcp),
    mcpMaxResults: Math.min(100, Math.max(1, num(raw?.mcpMaxResults, d.mcpMaxResults))),
    crawlerPolicy: crawlerPolicy(raw?.crawlerPolicy),
    contentSignals: {
      search: signal(signals?.search, d.contentSignals.search),
      aiInput: signal(signals?.aiInput, d.contentSignals.aiInput),
      aiTrain: signal(signals?.aiTrain, d.contentSignals.aiTrain),
    },
  }
}

/** Reads the AI settings alone, for the public paths that need nothing else. */
export async function getAiSettings(): Promise<SeoAiSettings> {
  try {
    const rows = await prisma.$queryRaw<Array<{ ai: Record<string, unknown> | null }>>`
      SELECT "ai" FROM "seo_settings" WHERE "id" = 'singleton'
    `
    return normaliseAiSettings(rows[0]?.ai ?? null)
  } catch {
    // No settings row yet, or the column not migrated in: the defaults are a
    // perfectly good answer and are what a fresh install would have read anyway.
    return { ...DEFAULT_AI_SETTINGS, markdownTypes: [...DEFAULT_AI_SETTINGS.markdownTypes] }
  }
}

/** Writes the "ai" column and nothing else. See saveSeoSettings for why. */
export async function saveAiSettings(ai: SeoAiSettings): Promise<void> {
  const json = JSON.stringify(normaliseAiSettings(ai as unknown as Record<string, unknown>))
  await prisma.$executeRaw`
    INSERT INTO "seo_settings" ("id", "ai", "updated_at")
    VALUES ('singleton', ${json}::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO UPDATE SET
      "ai" = EXCLUDED."ai",
      "updated_at" = CURRENT_TIMESTAMP
  `
}
