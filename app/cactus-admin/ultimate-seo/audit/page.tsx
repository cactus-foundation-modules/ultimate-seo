import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import SeoNav from '@/modules/ultimate-seo/components/admin/SeoNav'
import AuditClient from '@/modules/ultimate-seo/components/admin/AuditClient'

export const metadata = { title: 'SEO Site Audit — Admin' }

export default async function SeoAuditPage() {
  const user = await getSessionFromCookie()
  if (!user) return null
  if (!await hasPermission(user, 'seo.view')) {
    return <div className="alert alert-danger">You do not have permission to view SEO data.</div>
  }
  const canManage = await hasPermission(user, 'seo.manage')
  return (
    <div>
      <SeoNav canManage={canManage} />
      <AuditClient canManage={canManage} />
    </div>
  )
}
