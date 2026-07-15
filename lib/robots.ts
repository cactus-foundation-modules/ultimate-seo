import { listRobotsRules } from './db'

// Scanned by scripts/generate-module-router.mjs and merged into core /robots.txt:
// serves the admin-managed disallow rules from the Sitemap & robots screen.
export async function getPublicRobotsDisallow(): Promise<string[]> {
  const rules = await listRobotsRules()
  return rules.map((r) => (r.path.startsWith('/') ? r.path : `/${r.path}`))
}
