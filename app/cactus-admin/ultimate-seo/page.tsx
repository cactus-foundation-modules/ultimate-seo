import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import SeoNav from '@/modules/ultimate-seo/components/admin/SeoNav'
import DashboardClient from '@/modules/ultimate-seo/components/admin/DashboardClient'
import { headers } from 'next/headers'

export const metadata = { title: 'SEO Dashboard — Admin' }

export default async function SeoDashboardPage() {
  const user = await getSessionFromCookie()
  if (!user) return null
  if (!await hasPermission(user, 'seo.view')) {
    return <div className="alert alert-danger">You do not have permission to view SEO data.</div>
  }
  const canManage = await hasPermission(user, 'seo.manage')
  const adminPath = (await headers()).get('x-cactus-admin-path') ?? ''
  return (
    <div>
      <SeoNav canManage={canManage} />
      <DashboardClient adminPath={adminPath} />
    </div>
  )
}
