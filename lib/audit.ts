// Live site crawl: fetches the site's own published pages over HTTP and checks
// what search engines actually receive - which catches problems no amount of
// database analysis can (missing tags after render, slow responses, 500s).
//
// Serverless-aware: bounded page count (settings.targets.auditMaxPages),
// bounded wall clock (TIME_BUDGET_MS), small fetch concurrency. If time runs
// out the run is recorded as 'partial' rather than crashing the invocation.

import { JSDOM } from 'jsdom'
import { createAuditRun, finishAuditRun, insertAuditIssues } from './db'
import { getSeoSettings } from './settings'
import { getInventory } from './inventory'
import { listSitemapEntries } from './db'

// The whole run, not just the crawl loop - see runSiteAudit, where the clock starts
// before the sitemap is collected rather than after it.
//
// Sized to fit inside a slice of core's cron dispatcher rather than inside the 60s
// route ceiling. The dispatcher gives a job whatever is left of its own 60s tick and
// still has to write the run down afterwards, so a budget set to the full ceiling
// meant every scheduled audit was cut off mid-crawl and recorded as a failure - which
// is exactly what happened to the weekly one, week after week. A manual audit from
// the admin screen gets the same budget and reports 'partial' if the site is larger
// than one pass; the crawl is deliberately bounded either way.
// 38_000 was still too generous, and the weekly job went on failing: the budget
// gated the START of a fetch, not its end, so a worker could pick up a page at
// 37.9s, wait the full FETCH_TIMEOUT_MS on it, and only then write the run down -
// 48 seconds of crawl on top of however long collecting the URLs took. The
// dispatcher had hung up long before that. The loop below now refuses to start a
// page it cannot also finish, which makes this figure the real ceiling it claims
// to be.
const TIME_BUDGET_MS = 30_000
const FETCH_TIMEOUT_MS = 10_000
const CONCURRENCY = 4

type Issue = { url: string; severity: 'error' | 'warning' | 'notice'; checkKey: string; message: string; detail?: Record<string, unknown> }

function resolveSiteUrl(): string | null {
  const url = process.env.SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
  return url ? url.replace(/\/$/, '') : null
}

async function collectUrls(siteUrl: string, maxPages: number): Promise<string[]> {
  const urls = new Set<string>([`${siteUrl}/`])

  // Primary source: the site's own sitemap - it already includes every module's
  // public URLs via their sitemap hooks, so the crawl covers the whole site.
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(`${siteUrl}/sitemap.xml`, { signal: controller.signal, headers: { 'user-agent': 'CactusUltimateSeoAudit/1.0' } })
    clearTimeout(timer)
    if (res.ok) {
      const xml = await res.text()
      for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        const loc = match[1]?.trim()
        if (loc && loc.startsWith(siteUrl)) urls.add(loc)
      }
    }
  } catch {
    // Sitemap unreachable - fall back to inventory below.
  }

  // Fallback / top-up: published inventory items and custom sitemap entries.
  if (urls.size < 2) {
    try {
      const inventory = await getInventory()
      for (const item of inventory) {
        if (item.status === 'published') urls.add(`${siteUrl}${item.url}`)
      }
      const custom = await listSitemapEntries()
      for (const entry of custom) urls.add(`${siteUrl}${entry.path.startsWith('/') ? entry.path : `/${entry.path}`}`)
    } catch {
      // Inventory sources unavailable; audit whatever we have.
    }
  }

  return [...urls].slice(0, maxPages)
}

function checkPage(url: string, html: string, status: number, ms: number): Issue[] {
  const issues: Issue[] = []

  if (status >= 400) {
    issues.push({ url, severity: 'error', checkKey: 'http-status', message: `Page returned HTTP ${status}.` })
    return issues
  }
  if (ms > 3000) {
    issues.push({ url, severity: 'warning', checkKey: 'response-time', message: `Page took ${(ms / 1000).toFixed(1)}s to respond.`, detail: { ms } })
  }

  let doc: Document
  try {
    doc = new JSDOM(html).window.document
  } catch {
    issues.push({ url, severity: 'error', checkKey: 'parse', message: 'Page HTML could not be parsed.' })
    return issues
  }

  const title = doc.querySelector('title')?.textContent?.trim() ?? ''
  if (!title) issues.push({ url, severity: 'error', checkKey: 'title', message: 'Page has no <title>.' })
  else if (title.length > 70) issues.push({ url, severity: 'warning', checkKey: 'title', message: `Title is ${title.length} characters - will truncate in results.`, detail: { title } })

  const desc = doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? ''
  if (!desc) issues.push({ url, severity: 'warning', checkKey: 'meta-description', message: 'No meta description in the rendered page.' })

  const robotsMeta = doc.querySelector('meta[name="robots"]')?.getAttribute('content')?.toLowerCase() ?? ''
  if (robotsMeta.includes('noindex')) {
    issues.push({ url, severity: 'warning', checkKey: 'noindex', message: 'Page carries a noindex directive - it will not appear in search results.', detail: { robotsMeta } })
  }

  const h1s = doc.querySelectorAll('h1')
  if (h1s.length === 0) issues.push({ url, severity: 'warning', checkKey: 'h1', message: 'No H1 heading on the rendered page.' })
  else if (h1s.length > 1) issues.push({ url, severity: 'notice', checkKey: 'h1', message: `${h1s.length} H1 headings - one is the convention.` })

  const images = [...doc.querySelectorAll('img')]
  const missingAlt = images.filter((img) => !(img.getAttribute('alt') ?? '').trim()).length
  if (missingAlt > 0) {
    issues.push({ url, severity: 'notice', checkKey: 'img-alt', message: `${missingAlt} of ${images.length} images missing alt text.` })
  }

  const ogTitle = doc.querySelector('meta[property="og:title"]')
  const ogImage = doc.querySelector('meta[property="og:image"]')
  if (!ogTitle && !ogImage) {
    issues.push({ url, severity: 'notice', checkKey: 'open-graph', message: 'No Open Graph tags - shared links will look bare on social platforms.' })
  }

  const canonical = doc.querySelector('link[rel="canonical"]')
  if (!canonical) {
    issues.push({ url, severity: 'notice', checkKey: 'canonical', message: 'No canonical link tag.' })
  }

  // A page reachable on both hosts, or advertising a canonical belonging to a
  // different page entirely, is worse off than one with no canonical at all -
  // it hands its own credit to somewhere else. Only checked when there is one.
  const canonicalHref = canonical?.getAttribute('href')?.trim()
  if (canonicalHref) {
    try {
      const resolved = new URL(canonicalHref, url)
      if (resolved.origin !== new URL(url).origin) {
        issues.push({ url, severity: 'warning', checkKey: 'canonical-host', message: 'The canonical tag points at a different site.', detail: { canonical: resolved.toString() } })
      }
    } catch {
      issues.push({ url, severity: 'warning', checkKey: 'canonical-host', message: 'The canonical tag is not a usable address.', detail: { canonical: canonicalHref } })
    }
  }

  // Structured data: the difference between a plain blue link and a result with
  // a logo, a rating or a price attached to it.
  const jsonLdBlocks = [...doc.querySelectorAll('script[type="application/ld+json"]')]
  if (jsonLdBlocks.length === 0) {
    issues.push({ url, severity: 'notice', checkKey: 'structured-data', message: 'No structured data on the page - search results will be plain.' })
  } else {
    // Present but unparseable is the worse case of the two: it looks fine in the
    // page source and is thrown away in silence by everything that reads it.
    const broken = jsonLdBlocks.filter((block) => {
      try {
        JSON.parse(block.textContent ?? '')
        return false
      } catch {
        return true
      }
    }).length
    if (broken > 0) {
      issues.push({ url, severity: 'error', checkKey: 'structured-data', message: `${broken} of ${jsonLdBlocks.length} structured data blocks could not be read - search engines will ignore them.` })
    }
  }

  if (!doc.querySelector('meta[name="viewport"]')) {
    issues.push({ url, severity: 'warning', checkKey: 'viewport', message: 'No viewport tag - phones will render the page zoomed out, and most visitors are on phones.' })
  }

  if (!doc.documentElement?.getAttribute('lang')?.trim()) {
    issues.push({ url, severity: 'notice', checkKey: 'html-lang', message: 'The page does not declare what language it is in.' })
  }

  const text = doc.body?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  const words = text ? text.split(' ').length : 0
  if (words < 100) {
    issues.push({ url, severity: 'notice', checkKey: 'thin-content', message: `Rendered page has only ~${words} words of visible text.` })
  }

  return issues
}

async function fetchPage(url: string): Promise<{ status: number; html: string; ms: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const start = Date.now()
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'user-agent': 'CactusUltimateSeoAudit/1.0' } })
    const html = await res.text()
    return { status: res.status, html, ms: Date.now() - start }
  } finally {
    clearTimeout(timer)
  }
}

export async function runSiteAudit(trigger: 'manual' | 'cron'): Promise<{ runId: string; status: string }> {
  // Started here, not after the sitemap collection below. collectUrls fetches the
  // site's sitemap over HTTP and can take several seconds on a large catalogue; a
  // clock that only starts afterwards hands the crawl loop a budget the invocation
  // does not have left, and the caller kills it before it can record anything.
  const started = Date.now()

  const siteUrl = resolveSiteUrl()
  if (!siteUrl) throw new Error('SITE_URL is not configured, so the crawler has nowhere to point itself.')

  const settings = await getSeoSettings()
  const urls = await collectUrls(siteUrl, settings.targets.auditMaxPages)
  const runId = await createAuditRun(trigger, urls.length)

  let crawled = 0
  let totalMs = 0
  const counts = { errors: 0, warnings: 0, notices: 0 }
  const queue = [...urls]

  try {
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      // The budget has to cover the SLOWEST possible outcome of the page about to
      // be fetched, not the moment it is picked up. A page started with three
      // seconds left can still take ten.
      while (queue.length > 0 && Date.now() - started + FETCH_TIMEOUT_MS < TIME_BUDGET_MS) {
        const url = queue.shift()
        if (!url) break
        let issues: Issue[]
        try {
          const { status, html, ms } = await fetchPage(url)
          totalMs += ms
          issues = checkPage(url, html, status, ms)
        } catch {
          issues = [{ url, severity: 'error', checkKey: 'fetch', message: 'Page could not be fetched (timeout or network error).' }]
        }
        crawled++
        for (const issue of issues) {
          if (issue.severity === 'error') counts.errors++
          else if (issue.severity === 'warning') counts.warnings++
          else counts.notices++
        }
        if (issues.length > 0) await insertAuditIssues(runId, issues)
      }
    })
    await Promise.all(workers)

    const status = crawled < urls.length ? 'partial' : 'complete'
    await finishAuditRun({
      id: runId,
      status,
      pagesCrawled: crawled,
      summary: { ...counts, avgResponseMs: crawled ? Math.round(totalMs / crawled) : 0 },
    })
    return { runId, status }
  } catch (err) {
    await finishAuditRun({
      id: runId,
      status: 'failed',
      pagesCrawled: crawled,
      summary: { ...counts, avgResponseMs: crawled ? Math.round(totalMs / crawled) : 0 },
    })
    throw err
  }
}
