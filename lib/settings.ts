import { prisma } from '@/lib/db/prisma'
import {
  DEFAULT_SEARCH_URL_TEMPLATE,
  DEFAULT_STRUCTURED_DATA,
  DEFAULT_TARGETS,
  isOrgType,
  type SeoSettings,
  type SeoStructuredData,
  type SeoTargets,
} from './types'

type SettingsRow = {
  organization: Record<string, unknown> | null
  social: Record<string, unknown> | null
  targets: Record<string, unknown> | null
  structured_data: Record<string, unknown> | null
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
    emitOrganization: bool(raw?.emitOrganization, d.emitOrganization),
    emitWebSite: bool(raw?.emitWebSite, d.emitWebSite),
    emitSearchAction: bool(raw?.emitSearchAction, d.emitSearchAction),
    searchUrlTemplate: str(raw?.searchUrlTemplate) || DEFAULT_SEARCH_URL_TEMPLATE,
  }
}

export async function getSeoSettings(): Promise<SeoSettings> {
  const rows = await prisma.$queryRaw<SettingsRow[]>`
    SELECT "organization", "social", "targets", "structured_data" FROM "seo_settings" WHERE "id" = 'singleton'
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
  }
}

export async function saveSeoSettings(settings: SeoSettings): Promise<void> {
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
