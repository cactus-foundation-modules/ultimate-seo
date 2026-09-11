import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { pruneAiHits } from '@/modules/ultimate-seo/lib/ai/db'
import { rebuildLlmDocuments } from '@/modules/ultimate-seo/lib/ai/materialise'
import { getAiSettings } from '@/modules/ultimate-seo/lib/settings'

// Nightly: rebuild the Markdown twins whose content has moved, then drop AI hit
// counts past their retention. Same Bearer scheme as the audit job - Vercel
// appends the header.
//
// Nightly rather than weekly because core has no "this content changed" event
// for a module to listen to, so a twin's only route back into step with its
// page is this job noticing the timestamp. A week of a product being wrong is
// a week of an assistant quoting last month's price. It is affordable at that
// rate precisely because the rebuild is incremental: on a night when nothing
// has been edited it reads the inventory, compares timestamps and stops.

// No maxDuration here on purpose. A module route file cannot set one - core's
// catch-all at app/api/m/[module]/[...path] sets the single ceiling every module
// route runs under, and an export here is silently ignored. It used to say 300,
// which read as permission to take five minutes and was never anything of the
// sort. See TIME_BUDGET_MS in lib/ai/materialise.ts.

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return errorResponse('CRON_SECRET is not configured', 503)

  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) return errorResponse('Unauthorized', 401)

  try {
    const settings = await getAiSettings()
    const rebuild = await rebuildLlmDocuments()
    const prunedHits = settings.analytics ? await pruneAiHits(settings.analyticsRetentionDays) : 0
    return NextResponse.json({ ok: true, ...rebuild, prunedHits })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'the AI content rebuild failed', 500)
  }
}
