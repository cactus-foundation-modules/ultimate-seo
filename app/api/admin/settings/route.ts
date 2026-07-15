import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { errorResponse } from '@/lib/utils'
import { requireSeoPermission } from '@/modules/ultimate-seo/lib/auth'
import { getSeoSettings, saveSeoSettings } from '@/modules/ultimate-seo/lib/settings'

export async function GET() {
  const auth = await requireSeoPermission('seo.manage')
  if ('error' in auth) return auth.error

  const [settings, config] = await Promise.all([
    getSeoSettings(),
    prisma.siteConfig.findUnique({ where: { id: 'singleton' }, select: { hideFromCrawlers: true, status: true } }),
  ])
  return NextResponse.json({
    ...settings,
    hideFromCrawlers: config?.hideFromCrawlers ?? true,
    siteStatus: config?.status ?? 'live',
  })
}

const Body = z.object({
  organization: z.object({
    name: z.string().max(200),
    legalName: z.string().max(200),
    logoUrl: z.string().max(500),
    sameAs: z.array(z.string().max(500)).max(20),
  }),
  social: z.object({ twitterHandle: z.string().max(60) }),
  targets: z.object({
    titleMin: z.number().int().min(1).max(200),
    titleMax: z.number().int().min(1).max(200),
    descMin: z.number().int().min(1).max(500),
    descMax: z.number().int().min(1).max(500),
    densityMin: z.number().min(0).max(100),
    densityMax: z.number().min(0).max(100),
    auditMaxPages: z.number().int().min(1).max(500),
  }),
  hideFromCrawlers: z.boolean(),
})

export async function PUT(request: NextRequest) {
  const auth = await requireSeoPermission('seo.manage')
  if ('error' in auth) return auth.error

  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Invalid input')

  const { hideFromCrawlers, ...settings } = parsed.data
  await saveSeoSettings(settings)
  // The search-visibility switch lives on the core SiteConfig singleton - this
  // module takes over managing it, but the value stays where core robots.ts reads it.
  await prisma.siteConfig.update({ where: { id: 'singleton' }, data: { hideFromCrawlers } })

  return NextResponse.json({ ok: true })
}
