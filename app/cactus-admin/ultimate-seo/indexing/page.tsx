import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import IndexingClient from '@/modules/ultimate-seo/components/admin/IndexingClient'

export const metadata = { title: 'Sitemap & Robots — Admin' }

export default async function SeoIndexingPage() {
  const user = await getSessionFromCookie()
  if (!user) return null
  if (!await hasPermission(user, 'seo.manage')) {
    return <div className="alert alert-danger">You do not have permission to manage sitemap and robots rules.</div>
  }
  return <IndexingClient />
}
