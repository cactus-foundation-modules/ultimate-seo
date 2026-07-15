import type { MetadataRoute } from 'next'
import { listSitemapEntries } from './db'

const VALID_FREQ = new Set(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'])

// Scanned by scripts/generate-module-router.mjs and merged into core /sitemap.xml:
// serves the admin-managed extra entries from the Sitemap & robots screen.
export async function getPublicSitemapEntries(siteUrl: string): Promise<MetadataRoute.Sitemap> {
  const entries = await listSitemapEntries()
  return entries.map((entry) => {
    const path = entry.path.startsWith('/') ? entry.path : `/${entry.path}`
    // NUMERIC comes back from raw SQL as a Decimal object, not a JS number.
    const priority = entry.priority === null ? undefined : Number(entry.priority)
    const changeFrequency = entry.change_freq && VALID_FREQ.has(entry.change_freq)
      ? (entry.change_freq as MetadataRoute.Sitemap[number]['changeFrequency'])
      : undefined
    return {
      url: `${siteUrl}${path}`,
      lastModified: entry.created_at,
      ...(priority !== undefined && Number.isFinite(priority) ? { priority } : {}),
      ...(changeFrequency ? { changeFrequency } : {}),
    }
  })
}
