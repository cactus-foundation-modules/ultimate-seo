'use client'

import { usePathname } from 'next/navigation'
import { useAdminPath } from '@/components/admin/AdminPathContext'
import { TabStrip } from '@/components/admin/TabStrip'

// One sidebar link for SEO, with its four surfaces as tabs on the page.
// The dashboard sits at the module root, so it matches exactly rather than by
// prefix - a prefix match there would light up on every other tab too.
const TABS = [
  { label: 'Dashboard', segment: '', manageOnly: false },
  { label: 'Pages', segment: 'pages', manageOnly: false },
  { label: 'Site audit', segment: 'audit', manageOnly: false },
  { label: 'Sitemap & robots', segment: 'indexing', manageOnly: true },
]

export default function SeoNav({ canManage }: { canManage: boolean }) {
  const pathname = usePathname()
  const adminPath = useAdminPath()
  const base = `/${adminPath}/m/ultimate-seo`

  const tabs = TABS.filter((t) => !t.manageOnly || canManage)

  return (
    <TabStrip
      style={{ marginBottom: '1.5rem' }}
      items={tabs.map((tab) => {
        const href = tab.segment ? `${base}/${tab.segment}` : base
        const active = tab.segment ? !!pathname?.startsWith(href) : pathname === base || pathname === `${base}/`
        return { key: tab.segment || 'dashboard', label: tab.label, href, active }
      })}
    />
  )
}
