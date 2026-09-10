import { NextRequest, NextResponse } from 'next/server'
import { listAiHits } from '@/modules/ultimate-seo/lib/ai/db'
import { summariseAiHits } from '@/modules/ultimate-seo/lib/ai/analytics'
import { requireSeoPermission } from '@/modules/ultimate-seo/lib/auth'

export async function GET(request: NextRequest) {
  const auth = await requireSeoPermission('seo.view')
  if ('error' in auth) return auth.error

  const raw = Number(request.nextUrl.searchParams.get('days'))
  const days = Number.isFinite(raw) ? Math.min(365, Math.max(1, Math.floor(raw))) : 30

  try {
    return NextResponse.json({ days, ...summariseAiHits(await listAiHits(days)) })
  } catch {
    // The table not existing yet - a site updated but not yet migrated - reads
    // as "nothing has happened", which is true.
    return NextResponse.json({ days, totalCrawls: 0, totalReferrals: 0, byAgent: [], byPath: [], byDay: [] })
  }
}
