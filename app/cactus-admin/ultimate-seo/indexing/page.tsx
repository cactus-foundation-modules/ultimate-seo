import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import SeoNav from '@/modules/ultimate-seo/components/admin/SeoNav'
import IndexingClient from '@/modules/ultimate-seo/components/admin/IndexingClient'

export const metadata = { title: 'Sitemap & Robots — Admin' }

export default async function SeoIndexingPage() {
  const user = await getSessionFromCookie()
  if (!user) return null
  if (!await hasPermission(user, 'seo.manage')) {
    return <div className="alert alert-danger">You do not have permission to manage sitemap and robots rules.</div>
  }
  return (
    <div>
      {/* Reaching this page at all means seo.manage, so the gated tab is always shown. */}
      <SeoNav canManage />
      <IndexingClient />
    </div>
  )
}
