import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/utils'
import { setAbstract } from '@/modules/ultimate-seo/lib/ai/db'
import { rebuildOneDocument } from '@/modules/ultimate-seo/lib/ai/materialise'
import { requireSeoPermission } from '@/modules/ultimate-seo/lib/auth'
import { ENTITY_TYPES } from '@/modules/ultimate-seo/lib/types'

const Body = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string().min(1).max(200),
  // Empty clears it. Capped at roughly two sentences: it exists to be the line
  // a model quotes when it has room for one line.
  abstract: z.string().max(400),
})

export async function PUT(request: NextRequest) {
  const auth = await requireSeoPermission('seo.manage')
  if ('error' in auth) return auth.error

  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Invalid input')

  const { entityType, entityId, abstract } = parsed.data
  await setAbstract(entityType, entityId, abstract.trim() || null)

  // The abstract is the first line of that entity's Markdown twin, so the twin
  // is stale the moment it is saved. One entity's rebuild is a handful of
  // queries - cheap enough to do here rather than leave until the weekly job.
  const rebuilt = await rebuildOneDocument(entityType, entityId).catch(() => false)

  return NextResponse.json({ ok: true, rebuilt })
}
