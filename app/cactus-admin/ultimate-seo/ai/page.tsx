import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { resolveSiteUrl } from '@/lib/seo/site-url'
import SeoNav from '@/modules/ultimate-seo/components/admin/SeoNav'
import AiClient from '@/modules/ultimate-seo/components/admin/AiClient'

export const metadata = { title: 'AI & agents — Admin' }

export default async function SeoAiPage() {
  const user = await getSessionFromCookie()
  if (!user) return null
  if (!await hasPermission(user, 'seo.view')) {
    return <div className="alert alert-danger">You do not have permission to view the SEO settings.</div>
  }
  const canManage = await hasPermission(user, 'seo.manage')

  return (
    <div>
      <SeoNav canManage={canManage} />
      <AiClient canManage={canManage} siteUrl={resolveSiteUrl() ?? ''} />
    </div>
  )
}
