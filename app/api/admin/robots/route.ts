import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/utils'
import { requireSeoPermission } from '@/modules/ultimate-seo/lib/auth'
import { addRobotsRule, listRobotsRules } from '@/modules/ultimate-seo/lib/db'

export async function GET() {
  const auth = await requireSeoPermission('seo.manage')
  if ('error' in auth) return auth.error
  return NextResponse.json({ rules: await listRobotsRules() })
}

const Body = z.object({
  path: z.string().min(1).max(500).regex(/^\//, 'Path must start with /'),
  note: z.string().max(300).nullable().optional(),
})

export async function POST(request: NextRequest) {
  const auth = await requireSeoPermission('seo.manage')
  if ('error' in auth) return auth.error

  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Invalid input')

  await addRobotsRule(parsed.data.path, parsed.data.note ?? null)
  return NextResponse.json({ rules: await listRobotsRules() })
}
