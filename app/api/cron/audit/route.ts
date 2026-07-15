import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { runSiteAudit } from '@/modules/ultimate-seo/lib/audit'
import { hasRunningAudit } from '@/modules/ultimate-seo/lib/db'

// Vercel appends `Authorization: Bearer $CRON_SECRET` to its own cron requests
// automatically when CRON_SECRET is set - no separate secret scheme needed.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return errorResponse('CRON_SECRET is not configured', 503)

  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) return errorResponse('Unauthorized', 401)

  if (await hasRunningAudit()) return NextResponse.json({ ok: true, skipped: 'audit already running' })

  const result = await runSiteAudit('cron')
  return NextResponse.json({ ok: true, ...result })
}
