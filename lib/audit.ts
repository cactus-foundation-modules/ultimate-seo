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

const TIME_BUDGET_MS = 45_000
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
  const siteUrl = resolveSiteUrl()
  if (!siteUrl) throw new Error('SITE_URL is not configured, so the crawler has nowhere to point itself.')

  const settings = await getSeoSettings()
  const urls = await collectUrls(siteUrl, settings.targets.auditMaxPages)
  const runId = await createAuditRun(trigger, urls.length)

  const started = Date.now()
  let crawled = 0
  let totalMs = 0
  const counts = { errors: 0, warnings: 0, notices: 0 }
  const queue = [...urls]

  try {
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length > 0 && Date.now() - started < TIME_BUDGET_MS) {
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
