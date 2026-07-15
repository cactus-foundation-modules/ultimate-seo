import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireSeoPermission } from '@/modules/ultimate-seo/lib/auth'
import { listAuditRuns } from '@/modules/ultimate-seo/lib/db'
import { getInventory } from '@/modules/ultimate-seo/lib/inventory'

export async function GET() {
  const auth = await requireSeoPermission('seo.view')
  if ('error' in auth) return auth.error

  const [inventory, runs, config] = await Promise.all([
    getInventory(),
    listAuditRuns(5),
    prisma.siteConfig.findUnique({ where: { id: 'singleton' }, select: { hideFromCrawlers: true, status: true } }),
  ])

  const published = inventory.filter((i) => i.status === 'published')
  const analyzed = inventory.filter((i) => i.score !== null)
  const avgScore = analyzed.length
    ? Math.round(analyzed.reduce((sum, i) => sum + (i.score ?? 0), 0) / analyzed.length)
    : null

  const missingDescriptions = published.filter((i) => !i.metaDescription).length
  const missingOgImages = published.filter((i) => !i.hasOgImage).length
  const missingKeywords = published.filter((i) => !i.focusKeyword).length

  const titleCounts = new Map<string, number>()
  for (const item of published) {
    const key = item.title.trim().toLowerCase()
    if (key) titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1)
  }
  const duplicateTitles = [...titleCounts.values()].filter((n) => n > 1).length

  // Quick wins: worst analysed pages plus the never-analysed ones.
  const quickWins = [...analyzed]
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .slice(0, 5)
    .map((i) => ({ entityType: i.entityType, entityId: i.entityId, title: i.title, url: i.url, score: i.score }))

  return NextResponse.json({
    totals: {
      pages: inventory.length,
      published: published.length,
      analyzed: analyzed.length,
      avgScore,
      missingDescriptions,
      missingOgImages,
      missingKeywords,
      duplicateTitles,
    },
    hideFromCrawlers: config?.hideFromCrawlers ?? true,
    siteStatus: config?.status ?? 'live',
    latestRuns: runs,
    quickWins,
  })
}
