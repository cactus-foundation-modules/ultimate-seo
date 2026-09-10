import { listRobotsRules } from './db'

// Scanned by scripts/generate-module-router.mjs and merged into core /robots.txt:
// serves the admin-managed disallow rules from the Sitemap & robots screen.
export async function getPublicRobotsDisallow(): Promise<string[]> {
  const rules = await listRobotsRules()
  return rules.map((r) => (r.path.startsWith('/') ? r.path : `/${r.path}`))
}

// The AI half of robots.txt: which named crawlers may read the site, and what a
// crawler that has read it may then do with what it found. Both exports are
// optional halves of this contract - core calls them only when they exist, so a
// module that has never heard of them is unaffected. See lib/ai/robots-rules.ts.
import type { RobotsGroup } from '@/lib/seo/robots-txt'
import { resolveSiteUrl } from '@/lib/seo/site-url'
import { robotsExtraLines, robotsGroups } from './ai/robots-rules'
import { getAiSettings } from './settings'

export async function getPublicRobotsGroups(): Promise<RobotsGroup[]> {
  return robotsGroups(await getAiSettings())
}

export async function getPublicRobotsExtraLines(): Promise<string[]> {
  return robotsExtraLines(await getAiSettings(), resolveSiteUrl())
}
