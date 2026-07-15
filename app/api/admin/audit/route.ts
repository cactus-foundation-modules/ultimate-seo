import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { runSiteAudit } from '@/modules/ultimate-seo/lib/audit'
import { requireSeoPermission } from '@/modules/ultimate-seo/lib/auth'
import { hasRunningAudit, listAuditRuns } from '@/modules/ultimate-seo/lib/db'

export async function GET() {
  const auth = await requireSeoPermission('seo.view')
  if ('error' in auth) return auth.error
  return NextResponse.json({ runs: await listAuditRuns() })
}

export async function POST() {
  const auth = await requireSeoPermission('seo.manage')
  if ('error' in auth) return auth.error

  if (await hasRunningAudit()) return errorResponse('An audit is already running - give it a minute.', 409)

  try {
    const result = await runSiteAudit('manual')
    return NextResponse.json(result)
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Audit failed', 500)
  }
}
