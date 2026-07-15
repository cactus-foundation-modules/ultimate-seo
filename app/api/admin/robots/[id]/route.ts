import { NextResponse } from 'next/server'
import { requireSeoPermission } from '@/modules/ultimate-seo/lib/auth'
import { deleteRobotsRule, listRobotsRules } from '@/modules/ultimate-seo/lib/db'

export async function DELETE(_request: Request, { params }: { params: Promise<Record<string, string>> }) {
  const auth = await requireSeoPermission('seo.manage')
  if ('error' in auth) return auth.error

  const { id } = await params
  if (id) await deleteRobotsRule(id)
  return NextResponse.json({ rules: await listRobotsRules() })
}
