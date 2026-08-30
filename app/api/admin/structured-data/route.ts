import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { errorResponse } from '@/lib/utils'
import { resolveSiteUrl } from '@/lib/seo/site-url'
import { requireSeoPermission } from '@/modules/ultimate-seo/lib/auth'
import { getSeoSettings, normaliseStructuredData, saveSeoSettings } from '@/modules/ultimate-seo/lib/settings'
import { buildSiteJsonLd } from '@/modules/ultimate-seo/lib/structured-data'
import { ORG_TYPES, type SeoStructuredData } from '@/modules/ultimate-seo/lib/types'

// The preview is built by the same buildSiteJsonLd the live pages use, from the
// values in the request rather than from the saved row, so what the owner reads
// before pressing Save is what the site will publish after it.
async function previewPayload(structuredData: SeoStructuredData) {
  const [settings, config] = await Promise.all([
    getSeoSettings(),
    prisma.siteConfig.findUnique({ where: { id: 'singleton' }, select: { siteName: true } }).catch(() => null),
  ])
  const siteUrl = resolveSiteUrl()
  return {
    siteUrl,
    siteName: config?.siteName ?? '',
    fallbackSameAs: settings.organization.sameAs,
    jsonLd: siteUrl
      ? buildSiteJsonLd(structuredData, {
          siteUrl,
          siteName: config?.siteName ?? '',
          sameAs: settings.organization.sameAs,
        })
      : [],
  }
}

export async function GET() {
  const auth = await requireSeoPermission('seo.manage')
  if ('error' in auth) return auth.error

  const settings = await getSeoSettings()
  const preview = await previewPayload(settings.structuredData)
  return NextResponse.json({ structuredData: settings.structuredData, ...preview })
}

const Line = z.string().max(500)

const Body = z.object({
  // At least one type, because an empty `@type` is not markup. The normaliser
  // would substitute Organization anyway; refusing here means the owner is told
  // rather than quietly given something they did not ask for.
  orgTypes: z.array(z.enum(ORG_TYPES)).min(1).max(ORG_TYPES.length),
  name: z.string().max(200),
  alternateName: z.string().max(200),
  legalName: z.string().max(200),
  description: z.string().max(1000),
  url: z.string().max(500),
  logoUrl: z.string().max(500),
  logoWidth: z.number().int().min(1).max(20000).nullable(),
  logoHeight: z.number().int().min(1).max(20000).nullable(),
  logoCaption: z.string().max(200),
  imageUrl: z.string().max(500),
  telephone: z.string().max(60),
  email: z.string().max(200),
  streetAddress: z.string().max(200),
  addressLocality: z.string().max(120),
  addressRegion: z.string().max(120),
  postalCode: z.string().max(30),
  addressCountry: z.string().max(60),
  vatId: z.string().max(60),
  taxId: z.string().max(60),
  duns: z.string().max(60),
  iso6523Code: z.string().max(80),
  identifierName: z.string().max(200),
  identifierValue: z.string().max(200),
  foundingDate: z.string().max(20),
  priceRange: z.string().max(20),
  openingHours: z.array(Line).max(14),
  areaServed: z.array(Line).max(30),
  sameAs: z.array(Line).max(30),
  contactType: z.string().max(60),
  contactEmail: z.string().max(200),
  contactTelephone: z.string().max(60),
  contactAreaServed: z.array(Line).max(30),
  contactAvailableLanguage: z.array(Line).max(20),
  emitOrganization: z.boolean(),
  emitWebSite: z.boolean(),
  emitSearchAction: z.boolean(),
  searchUrlTemplate: z.string().max(300),
})

export async function PUT(request: NextRequest) {
  const auth = await requireSeoPermission('seo.manage')
  if ('error' in auth) return auth.error

  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Invalid input')

  const structuredData = normaliseStructuredData(parsed.data)
  // Read-modify-write of the whole singleton: saveSeoSettings writes every
  // column, so handing it only this block would blank the analyser targets and
  // the organisation record the page-builder block pre-fills from.
  const current = await getSeoSettings()
  await saveSeoSettings({ ...current, structuredData })

  const preview = await previewPayload(structuredData)
  return NextResponse.json({ ok: true, structuredData, ...preview })
}
