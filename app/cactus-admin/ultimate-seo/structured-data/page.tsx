import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import SeoNav from '@/modules/ultimate-seo/components/admin/SeoNav'
import StructuredDataClient from '@/modules/ultimate-seo/components/admin/StructuredDataClient'

export const metadata = { title: 'Structured Data — Admin' }

export default async function SeoStructuredDataPage() {
  const user = await getSessionFromCookie()
  if (!user) return null
  if (!await hasPermission(user, 'seo.manage')) {
    return <div className="alert alert-danger">You do not have permission to manage structured data.</div>
  }
  return (
    <div>
      {/* Reaching this page at all means seo.manage, so the gated tabs are always shown. */}
      <SeoNav canManage />
      <StructuredDataClient />
    </div>
  )
}
