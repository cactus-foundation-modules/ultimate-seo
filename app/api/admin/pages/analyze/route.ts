import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/utils'
import { requireSeoPermission } from '@/modules/ultimate-seo/lib/auth'
import { runAnalysisFor, suggestDescription } from '@/modules/ultimate-seo/lib/run-analysis'

const Body = z.object({
  entityType: z.enum(['core-page', 'gazette-post', 'shop-product', 'directory-entry']),
  entityId: z.string().min(1),
  focusKeyword: z.string().max(120).nullable().optional(),
})

export async function POST(request: NextRequest) {
  const auth = await requireSeoPermission('seo.view')
  if ('error' in auth) return auth.error

  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Invalid input')

  const { entityType, entityId } = parsed.data
  const focusKeyword = parsed.data.focusKeyword?.trim() || null

  const result = await runAnalysisFor(entityType, entityId, focusKeyword)
  if (!result) return errorResponse('Page not found', 404)

  const descriptionSuggestion = await suggestDescription(entityType, entityId)
  return NextResponse.json({ ...result, descriptionSuggestion })
}
