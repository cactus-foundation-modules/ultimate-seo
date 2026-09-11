// What the AI settings become in robots.txt. Pure, so the file a site would
// publish can be asserted without a database.

import type { RobotsGroup } from '@/lib/seo/robots-txt'
import { AI_CRAWLERS } from './crawlers'
import type { SeoAiSettings } from '../types'

/**
 * The Content-Signal line for the catch-all group.
 *
 * Cloudflare's Content Signals Policy, which is a plain declaration of intent
 * rather than an access rule: it says what a crawler that HAS fetched the page
 * may then do with it. Left out entirely when the owner has said nothing -
 * saying nothing and saying "no" are different answers, and a line that
 * defaulted to one of them would be putting words in their mouth.
 */
export function contentSignalLine(settings: SeoAiSettings): string | null {
  const parts: string[] = []
  const say = (name: string, value: string) => {
    if (value === 'unset') return
    parts.push(`${name}=${value}`)
  }
  say('search', settings.contentSignals.search)
  say('ai-input', settings.contentSignals.aiInput)
  say('ai-train', settings.contentSignals.aiTrain)
  return parts.length ? `Content-Signal: ${parts.join(', ')}` : null
}

/** The lines that go inside the catch-all group, above its rules. */
export function robotsExtraLines(settings: SeoAiSettings, siteUrl: string | null): string[] {
  const lines: string[] = []
  const signal = contentSignalLine(settings)
  if (signal) lines.push(signal)
  if (settings.llmsTxt && siteUrl) {
    // A comment, because there is no directive for this. Every crawler ignores
    // it and every person reading the file to find out what a site offers does
    // not, which is exactly who it is for.
    lines.push(`# Markdown copies of this site: ${siteUrl}/llms.txt`)
  }
  // Named here as well as in llms.txt, for the same reason and to a different
  // reader: an agent that goes straight for robots.txt - which is the one file
  // every crawler fetches first - and never opens the index would otherwise
  // never learn the endpoint exists.
  if (settings.mcp && siteUrl) {
    lines.push(`# Agent endpoint (MCP, read-only, JSON-RPC over POST): ${siteUrl}/api/m/ultimate-seo/mcp`)
  }
  return lines
}

/**
 * One group per stance, not one per crawler.
 *
 * Twenty User-agent lines above a single "Disallow: /" is what robots.txt was
 * designed for, and it reads as one decision instead of twenty.
 */
export function robotsGroups(settings: SeoAiSettings): RobotsGroup[] {
  const blocked: string[] = []
  const allowed: string[] = []

  for (const crawler of AI_CRAWLERS) {
    const stance = settings.crawlerPolicy[crawler.key]
    if (stance === 'block') blocked.push(crawler.token)
    else if (stance === 'allow') allowed.push(crawler.token)
  }

  const groups: RobotsGroup[] = []
  if (blocked.length) {
    groups.push({
      userAgents: blocked,
      disallow: ['/'],
      comment: 'AI crawlers this site does not want',
    })
  }
  // An explicit allow is worth writing down even though it is also the default:
  // it is the difference between "we have not thought about it" and "yes", and
  // core adds the admin area and the API back to the group so that saying yes
  // to a crawler does not say yes to those.
  if (allowed.length) {
    groups.push({
      userAgents: allowed,
      allow: ['/'],
      comment: 'AI crawlers this site is happy to be read by',
    })
  }
  return groups
}
