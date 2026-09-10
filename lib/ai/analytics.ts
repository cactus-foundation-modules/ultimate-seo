// Counting AI crawler visits and AI-assistant referrals.
//
// The order of the checks in observeAiRequest is the whole cost story. An
// ordinary human visit is matched against two in-memory lists and costs nothing
// else: no settings read, no database write, nothing on the response path. Only
// a request that is already known to be an AI crawler or an AI referral goes on
// to read the settings and count itself, and even that happens after the
// response has been sent.

import { after } from 'next/server'
import { headers } from 'next/headers'
import { getAiSettings } from '../settings'
import { identifyAiCrawler, identifyAiReferrer } from './crawlers'
import { recordAiHit } from './db'

/** Paths never worth counting: they are not pages anybody found us through. */
function countable(path: string): boolean {
  if (!path.startsWith('/')) return false
  return !/^\/(api|_next|cactus-admin|setup|cactus-status)\b/.test(path)
}

// A path with a query string on it splits one page into a hundred rows.
function normalisePath(path: string): string {
  const clean = path.split('?')[0] ?? '/'
  return clean.length > 1 ? clean.replace(/\/+$/, '') : clean
}

/**
 * Counts this request if an AI crawler or an AI assistant is behind it.
 *
 * Safe to call on any request. Never throws, never blocks the response, and
 * does nothing at all unless the owner has switched analytics on.
 */
export async function observeAiRequest(explicitPath?: string): Promise<void> {
  let agent: { kind: 'crawler' | 'referral'; key: string } | null = null
  let path: string

  try {
    const h = await headers()
    const crawler = identifyAiCrawler(h.get('user-agent'))
    agent = crawler
      ? { kind: 'crawler', key: crawler }
      : (() => {
        const referrer = identifyAiReferrer(h.get('referer'))
        return referrer ? { kind: 'referral' as const, key: referrer } : null
      })()
    // Nothing to count. This is every ordinary visit, and it has cost two
    // string comparisons.
    if (!agent) return
    path = normalisePath(explicitPath ?? h.get('x-cactus-path') ?? '/')
  } catch {
    // Called outside a request - a script, a test. Nothing to observe.
    return
  }

  if (!countable(path)) return

  const observed = agent
  const observedPath = path

  // after() runs once the response has gone out, so the visitor waits for
  // nothing. A crawler that gets its page slightly late is a crawler that
  // crawls less of the site.
  after(async () => {
    try {
      const settings = await getAiSettings()
      if (!settings.analytics) return
      await recordAiHit(observed.kind, observed.key, observedPath)
    } catch (err) {
      // Analytics failing must never be visible on the site.
      console.error('[ultimate-seo] AI hit not recorded:', err)
    }
  })
}

export type AiHitSummary = {
  totalCrawls: number
  totalReferrals: number
  byAgent: Array<{ agent: string; kind: 'crawler' | 'referral'; hits: number; lastSeen: Date }>
  byPath: Array<{ path: string; hits: number }>
  byDay: Array<{ day: string; crawls: number; referrals: number }>
}

/** The three cuts the screen shows, worked out in one pass. */
export function summariseAiHits(rows: Array<{ day: Date; kind: 'crawler' | 'referral'; agent: string; path: string; hits: number; last_seen: Date }>): AiHitSummary {
  const byAgent = new Map<string, { agent: string; kind: 'crawler' | 'referral'; hits: number; lastSeen: Date }>()
  const byPath = new Map<string, number>()
  const byDay = new Map<string, { crawls: number; referrals: number }>()
  let totalCrawls = 0
  let totalReferrals = 0

  for (const row of rows) {
    const hits = Number(row.hits) || 0
    if (row.kind === 'crawler') totalCrawls += hits
    else totalReferrals += hits

    const agentKey = `${row.kind}:${row.agent}`
    const agent = byAgent.get(agentKey)
    if (agent) {
      agent.hits += hits
      if (row.last_seen > agent.lastSeen) agent.lastSeen = row.last_seen
    } else {
      byAgent.set(agentKey, { agent: row.agent, kind: row.kind, hits, lastSeen: row.last_seen })
    }

    byPath.set(row.path, (byPath.get(row.path) ?? 0) + hits)

    const day = row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10)
    const dayRow = byDay.get(day) ?? { crawls: 0, referrals: 0 }
    if (row.kind === 'crawler') dayRow.crawls += hits
    else dayRow.referrals += hits
    byDay.set(day, dayRow)
  }

  return {
    totalCrawls,
    totalReferrals,
    byAgent: [...byAgent.values()].sort((a, b) => b.hits - a.hits),
    byPath: [...byPath.entries()].map(([path, hits]) => ({ path, hits })).sort((a, b) => b.hits - a.hits).slice(0, 50),
    byDay: [...byDay.entries()].map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
  }
}
