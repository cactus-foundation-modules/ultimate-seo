import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/utils'
import { requireSeoPermission } from '@/modules/ultimate-seo/lib/auth'
import { analyzeBatch } from '@/modules/ultimate-seo/lib/bulk-analysis'
import { ENTITY_TYPES } from '@/modules/ultimate-seo/lib/types'

// One chunk of a site-wide sweep. The client walks the inventory and posts
// batches, so a catalogue of any size stays well inside the 60s module-route
// ceiling and the progress bar has something honest to report.
const Body = z.object({
  items: z.array(z.object({
    entityType: z.enum(ENTITY_TYPES),
    entityId: z.string().min(1),
  })).min(1).max(100),
})

export async function POST(request: NextRequest) {
  const auth = await requireSeoPermission('seo.view')
  if ('error' in auth) return auth.error

  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Invalid input')

  const { analysed, missing } = await analyzeBatch(parsed.data.items)
  return NextResponse.json({ analysed, missing })
}
