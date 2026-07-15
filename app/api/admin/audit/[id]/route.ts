import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { requireSeoPermission } from '@/modules/ultimate-seo/lib/auth'
import { getAuditIssues, getAuditRun } from '@/modules/ultimate-seo/lib/db'

export async function GET(_request: Request, { params }: { params: Promise<Record<string, string>> }) {
  const auth = await requireSeoPermission('seo.view')
  if ('error' in auth) return auth.error

  const { id } = await params
  if (!id) return errorResponse('Audit run not found', 404)
  const run = await getAuditRun(id)
  if (!run) return errorResponse('Audit run not found', 404)

  const issues = await getAuditIssues(id)
  return NextResponse.json({ run, issues })
}
