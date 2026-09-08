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

  // Caught and reported rather than thrown. An uncaught error here is masked by the
  // framework into a bare "Internal Server Error", so core's cron dispatcher records
  // "HTTP 500" and the owner is told a job failed with no hint as to why.
  try {
    if (await hasRunningAudit()) return NextResponse.json({ ok: true, skipped: 'audit already running' })

    const result = await runSiteAudit('cron')
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'the site audit failed', 500)
  }
}
