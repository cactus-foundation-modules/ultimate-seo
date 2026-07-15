import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/utils'
import { applyCorePageEdits } from '@/modules/ultimate-seo/lib/apply'
import { requireSeoPermission } from '@/modules/ultimate-seo/lib/auth'
import { runAnalysisFor } from '@/modules/ultimate-seo/lib/run-analysis'
import { getAllPageMeta } from '@/modules/ultimate-seo/lib/db'

const Body = z.object({
  entityId: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  metaDescription: z.string().max(300).nullable().optional(),
})

// One-click fixes are core-page only by design: module content is owned by its
// module and edited there (the Pages screen deep-links out for those).
export async function POST(request: NextRequest) {
  const auth = await requireSeoPermission('seo.manage')
  if ('error' in auth) return auth.error

  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Invalid input')

  const { entityId, title, metaDescription } = parsed.data
  if (title === undefined && metaDescription === undefined) {
    return errorResponse('Nothing to apply')
  }

  const ok = await applyCorePageEdits(entityId, { title, metaDescription })
  if (!ok) return errorResponse('Page not found', 404)

  // Re-analyse so the caller gets the fresh score in one round trip.
  const meta = await getAllPageMeta()
  const existing = meta.find((m) => m.entity_type === 'core-page' && m.entity_id === entityId)
  const result = await runAnalysisFor('core-page', entityId, existing?.focus_keyword ?? null)
  return NextResponse.json({ ok: true, analysis: result })
}
