import { prisma } from '@/lib/db/prisma'
import { DEFAULT_TARGETS, type SeoSettings, type SeoTargets } from './types'

type SettingsRow = {
  organization: Record<string, unknown> | null
  social: Record<string, unknown> | null
  targets: Record<string, unknown> | null
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
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

export async function getSeoSettings(): Promise<SeoSettings> {
  const rows = await prisma.$queryRaw<SettingsRow[]>`
    SELECT "organization", "social", "targets" FROM "seo_settings" WHERE "id" = 'singleton'
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
  }
}

export async function saveSeoSettings(settings: SeoSettings): Promise<void> {
  const organization = JSON.stringify(settings.organization)
  const social = JSON.stringify(settings.social)
  const targets = JSON.stringify(normaliseTargets(settings.targets as unknown as Record<string, unknown>))
  await prisma.$executeRaw`
    INSERT INTO "seo_settings" ("id", "organization", "social", "targets", "updated_at")
    VALUES ('singleton', ${organization}::jsonb, ${social}::jsonb, ${targets}::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO UPDATE SET
      "organization" = EXCLUDED."organization",
      "social" = EXCLUDED."social",
      "targets" = EXCLUDED."targets",
      "updated_at" = CURRENT_TIMESTAMP
  `
}
