import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/utils'
import { requireSeoPermission } from '@/modules/ultimate-seo/lib/auth'
import { addSitemapEntry, listSitemapEntries } from '@/modules/ultimate-seo/lib/db'

async function entriesJson() {
  const entries = await listSitemapEntries()
  // NUMERIC arrives as a Decimal object; normalise for the client.
  return entries.map((e) => ({ ...e, priority: e.priority === null ? null : Number(e.priority) }))
}

export async function GET() {
  const auth = await requireSeoPermission('seo.manage')
  if ('error' in auth) return auth.error
  return NextResponse.json({ entries: await entriesJson() })
}

const Body = z.object({
  path: z.string().min(1).max(500).regex(/^\//, 'Path must start with /'),
  priority: z.number().min(0).max(1).nullable().optional(),
  changeFreq: z.enum(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']).nullable().optional(),
  note: z.string().max(300).nullable().optional(),
})

export async function POST(request: NextRequest) {
  const auth = await requireSeoPermission('seo.manage')
  if ('error' in auth) return auth.error

  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Invalid input')

  await addSitemapEntry({
    path: parsed.data.path,
    priority: parsed.data.priority ?? null,
    changeFreq: parsed.data.changeFreq ?? null,
    note: parsed.data.note ?? null,
  })
  return NextResponse.json({ entries: await entriesJson() })
}
