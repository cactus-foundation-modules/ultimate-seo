'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AiCrawler } from '@/modules/ultimate-seo/lib/ai/crawlers'
import { ENTITY_TYPES, type ContentSignal, type EntityType, type SeoAiSettings } from '@/modules/ultimate-seo/lib/types'
import { API, helpStyle, inputStyle, labelStyle } from './shared'

const TYPE_LABELS: Record<EntityType, string> = {
  'core-page': 'Pages',
  'gazette-post': 'Blog posts',
  'shop-product': 'Products',
  'shop-category': 'Product categories',
  'shop-collection': 'Product collections',
  'filter-collection': 'Filter pages',
  'directory-entry': 'Directory entries',
}

const PURPOSE_SECTIONS: Array<{ purpose: AiCrawler['purpose']; title: string; blurb: string }> = [
  {
    purpose: 'search',
    title: 'The ones that send you customers',
    blurb: 'These read your pages so an assistant can recommend you and link to you. Blocking them is how a business disappears from answers people are already asking.',
  },
  {
    purpose: 'agent',
    title: 'The ones fetching a page for somebody right now',
    blurb: 'Somebody asked their assistant about you and it went to look. Block one of these and the person is told your site would not answer.',
  },
  {
    purpose: 'train',
    title: 'The ones that take and give nothing back',
    blurb: 'These collect your pages to train a model. You get no link, no visit and no credit. Plenty of owners block the lot; it costs you nothing in search.',
  },
]

type Stats = { count: number; bytes: number; builtAt: string | null }
type Rebuild = { built: number; skipped: number; removed: number; clashes: string[]; tookMs: number; incomplete: boolean }
type Analytics = {
  days: number
  totalCrawls: number
  totalReferrals: number
  byAgent: Array<{ agent: string; kind: 'crawler' | 'referral'; hits: number; lastSeen: string }>
  byPath: Array<{ path: string; hits: number }>
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '1.25rem', marginBottom: '1.5rem', background: 'var(--color-surface)' }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', color: 'var(--color-text)' }}>{title}</h2>
      {children}
    </section>
  )
}

/**
 * A warning that a switch costs money, and which line of the bill it lands on.
 *
 * Named categories on purpose. "This may increase your usage" tells an owner
 * nothing they can check; "Fluid Active CPU" is a line they can go and look at.
 */
function CostWarning({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: '0.75rem',
      color: 'var(--color-text-secondary)',
      background: 'var(--color-warning-bg, var(--color-bg))',
      border: '1px solid var(--color-border)',
      borderRadius: 6,
      padding: '0.5rem 0.75rem',
      margin: '0.5rem 0 0',
    }}>
      <strong style={{ color: 'var(--color-text)' }}>Costs money: </strong>{children}
    </p>
  )
}

function Toggle({ label, help, checked, disabled, onChange }: {
  label: string
  help?: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div style={{ marginBottom: '0.875rem', opacity: disabled ? 0.5 : 1 }}>
      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', cursor: disabled ? 'not-allowed' : 'pointer' }}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)' }}>{label}</span>
          {help && <span style={{ display: 'block', ...helpStyle, margin: '0.15rem 0 0' }}>{help}</span>}
        </span>
      </label>
    </div>
  )
}

const SIGNAL_LABELS: Array<{ value: ContentSignal; label: string }> = [
  { value: 'unset', label: 'Say nothing' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]

function SignalRow({ label, help, value, onChange }: {
  label: string
  help: string
  value: ContentSignal
  onChange: (v: ContentSignal) => void
}) {
  return (
    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>{label}</div>
        <p style={helpStyle}>{help}</p>
      </div>
      <select value={value} onChange={(e) => onChange(e.target.value as ContentSignal)} style={{ ...inputStyle, width: 150 }}>
        {SIGNAL_LABELS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function AiClient({ canManage, siteUrl }: { canManage: boolean; siteUrl: string }) {
  const [settings, setSettings] = useState<SeoAiSettings | null>(null)
  const [crawlers, setCrawlers] = useState<AiCrawler[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [rebuilt, setRebuilt] = useState<Rebuild | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/ai`)
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not load the AI settings')
      const data = await res.json() as { settings: SeoAiSettings; stats: Stats; crawlers: AiCrawler[] }
      setSettings(data.settings)
      setStats(data.stats)
      setCrawlers(data.crawlers)
      if (data.settings.analytics) {
        const hits = await fetch(`${API}/ai/analytics?days=30`)
        if (hits.ok) setAnalytics(await hits.json())
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the AI settings')
    } finally {
      setLoading(false)
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to async helper; all setState calls are after awaits
  useEffect(() => { load() }, [load])

  const update = useCallback((patch: Partial<SeoAiSettings>) => {
    setSaved(false)
    setSettings((current) => (current ? { ...current, ...patch } : current))
  }, [])

  async function save() {
    if (!settings) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`${API}/ai`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not save')
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function rebuild(force = false) {
    setRebuilding(true)
    setError('')
    setRebuilt(null)
    try {
      const res = await fetch(`${API}/ai/rebuild${force ? '?force=1' : ''}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'The rebuild failed')
      setRebuilt(data)
      const refreshed = await fetch(`${API}/ai`)
      if (refreshed.ok) setStats((await refreshed.json()).stats)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The rebuild failed')
    } finally {
      setRebuilding(false)
    }
  }

  const byPurpose = useMemo(() => {
    const map = new Map<AiCrawler['purpose'], AiCrawler[]>()
    for (const crawler of crawlers) {
      const list = map.get(crawler.purpose)
      if (list) list.push(crawler)
      else map.set(crawler.purpose, [crawler])
    }
    return map
  }, [crawlers])

  if (loading) return <p style={{ color: 'var(--color-text-secondary)' }}>Loading…</p>
  if (!settings) return <div className="alert alert-danger">{error || 'Could not load the AI settings.'}</div>

  const setStance = (key: string, stance: 'allow' | 'block' | 'default') => {
    const next = { ...settings.crawlerPolicy }
    if (stance === 'default') delete next[key]
    else next[key] = stance
    update({ crawlerPolicy: next })
  }

  const blockAll = (purpose: AiCrawler['purpose']) => {
    const next = { ...settings.crawlerPolicy }
    for (const crawler of byPurpose.get(purpose) ?? []) next[crawler.key] = 'block'
    update({ crawlerPolicy: next })
  }

  return (
    <div>
      <p style={{ ...helpStyle, fontSize: '0.8125rem', marginBottom: '1.5rem', maxWidth: '46rem' }}>
        People increasingly find shops by asking an assistant rather than by searching. This page is
        about being findable that way: a plain-text copy of the site that a model can actually read,
        a say in which of them may read it, and a count of who has been.
      </p>

      {error && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{error}</div>}

      <Card title="What you publish for AI readers">
        <Toggle
          label="Publish an index at /llms.txt"
          help="A single Markdown page listing everything on the site, which is the file assistants look for first."
          checked={settings.llmsTxt}
          onChange={(v) => update({ llmsTxt: v })}
        />
        <Toggle
          label="Publish the whole lot at /llms-full.txt"
          help="The same index with the shorter pages written out in full. Products are left out - a catalogue this size would make a file nobody could fetch."
          checked={settings.llmsFull}
          disabled={!settings.llmsTxt}
          onChange={(v) => update({ llmsFull: v })}
        />
        <Toggle
          label="Say who you are at the top of the index"
          help="Your registered name, company number, VAT number, address, the countries you sell to and how to reach you - taken straight from Structured data, and only while the organisation details there are being published. It is what an assistant checks before it will name you to anybody."
          checked={settings.businessFacts}
          disabled={!settings.llmsTxt}
          onChange={(v) => update({ businessFacts: v })}
        />
        <Toggle
          label="Give every page a Markdown twin"
          help="The same page at the same address with .md on the end, in plain text with no menus, buttons or scripts around it."
          checked={settings.markdown}
          onChange={(v) => update({ markdown: v })}
        />

        <div style={{ margin: '1rem 0' }}>
          <span style={labelStyle}>Which content gets a twin</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            {ENTITY_TYPES.map((type) => (
              <label key={type} style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.8125rem', color: 'var(--color-text)' }}>
                <input
                  type="checkbox"
                  checked={settings.markdownTypes.includes(type)}
                  onChange={(e) => update({
                    markdownTypes: e.target.checked
                      ? [...settings.markdownTypes, type]
                      : settings.markdownTypes.filter((t) => t !== type),
                  })}
                />
                {TYPE_LABELS[type]}
              </label>
            ))}
          </div>
          <p style={helpStyle}>Anything unticked is dropped from the index and its twin removed at the next rebuild.</p>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={labelStyle} htmlFor="seo-ai-summary">What this site is, in a sentence or two</label>
          <textarea
            id="seo-ai-summary"
            value={settings.siteSummary}
            onChange={(e) => update({ siteSummary: e.target.value })}
            rows={3}
            maxLength={2000}
            style={{ ...inputStyle, resize: 'vertical' }}
            placeholder="Office furniture for businesses across the UK, delivered and installed."
          />
          <p style={helpStyle}>Goes at the top of the index. Left blank, your site description is used instead.</p>
        </div>

        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1rem' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" onClick={() => rebuild(false)} disabled={rebuilding || !canManage}>
              {rebuilding ? 'Rebuilding…' : 'Rebuild what has changed'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => rebuild(true)} disabled={rebuilding || !canManage}>
              Rebuild everything
            </button>
            <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
              {stats && stats.count > 0
                ? `${stats.count.toLocaleString('en-GB')} pages ready, ${formatBytes(stats.bytes)} in total${stats.builtAt ? `, last built ${new Date(stats.builtAt).toLocaleDateString('en-GB')}` : ''}.`
                : 'Nothing built yet.'}
            </span>
          </div>
          {stats && stats.count === 0 && (
            // Loud, because everything on this page is downstream of it and the
            // symptoms all look like something else: an index with no pages in it,
            // .md addresses that answer 404, an agent endpoint that says the site
            // publishes nothing, and no breadcrumbs on any page.
            <div className="alert alert-warning" style={{ marginTop: '0.75rem' }}>
              Nothing has been built yet, so the index, the Markdown copies and the agent endpoint have
              nothing to show. Press <strong>Rebuild everything</strong> once - after that the nightly
              job keeps up on its own.
            </div>
          )}
          {rebuilt && (
            <p style={{ ...helpStyle, marginTop: '0.5rem' }}>
              Built {rebuilt.built.toLocaleString('en-GB')} pages in {(rebuilt.tookMs / 1000).toFixed(1)}s
              {rebuilt.skipped > 0 ? `, left ${rebuilt.skipped.toLocaleString('en-GB')} already up to date alone` : ''}
              {rebuilt.removed > 0 ? `, removed ${rebuilt.removed}` : ''}
              {rebuilt.clashes.length > 0 ? `. ${rebuilt.clashes.length} pages share an address with another and were skipped: ${rebuilt.clashes.slice(0, 3).join(', ')}` : '.'}
              {rebuilt.incomplete && ' There was more than would fit in one go - run it again to finish, or leave it to the nightly job.'}
            </p>
          )}
          <p style={{ ...helpStyle, marginTop: '0.5rem' }}>
            Twins are built overnight and whenever you edit a summary, so serving one costs a single
            lookup. The rebuild is the expensive part, and it happens while nobody is looking.
          </p>
          {settings.llmsTxt && (
            <p style={{ ...helpStyle, marginTop: '0.5rem' }}>
              <a href={`${siteUrl}/llms.txt`} target="_blank" rel="noreferrer">View /llms.txt</a>
              {settings.llmsFull && <> · <a href={`${siteUrl}/llms-full.txt`} target="_blank" rel="noreferrer">/llms-full.txt</a></>}
            </p>
          )}
        </div>
      </Card>

      <Card title="What each page says about itself">
        <p style={{ ...helpStyle, marginBottom: '1rem' }}>
          The two switches below share one lookup, so having both costs no more than having either.
        </p>
        <Toggle
          label="Publish structured data on every page"
          help="Breadcrumbs on products, categories and posts; blog details on a post; a listing on a category or collection; contact details on a directory entry. It is what puts the trail under your name in a search result and what an assistant reads to work out what a page is."
          checked={settings.pageStructuredData}
          onChange={(v) => update({ pageStructuredData: v })}
        />
        <Toggle
          label="Tell each page’s reader where its Markdown copy is"
          help="A line in the page’s head pointing at the same address with .md on the end, so a reader finds it without having to guess. Needs the Markdown twins above."
          checked={settings.pageMarkdownLink}
          disabled={!settings.markdown}
          onChange={(v) => update({ pageMarkdownLink: v })}
        />
        <CostWarning>
          one small database read on every public page, which shows on your Vercel bill as
          <strong> Fluid Active CPU</strong>. Cached pages do not pay it twice, and a page nobody
          has built a copy of does not pay it at all. Everything above this card is served from a
          table and costs your visitors nothing.
        </CostWarning>
        <p style={{ ...helpStyle, marginTop: '0.75rem' }}>
          Your shop already publishes the product details on a product page, so this does not repeat
          them - two different prices for one item is the fastest way to upset a shopping feed.
        </p>
      </Card>

      <Card title="Which AI crawlers may read the site">
        <p style={{ ...helpStyle, marginBottom: '1rem' }}>
          Left alone, every one of these is allowed - which is what your site does today. Nothing here
          changes until you change it.
        </p>
        {PURPOSE_SECTIONS.map((section) => {
          const list = byPurpose.get(section.purpose) ?? []
          if (list.length === 0) return null
          return (
            <div key={section.purpose} style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
                <h3 style={{ margin: '0 0 0.25rem', fontSize: '0.875rem', color: 'var(--color-text)' }}>{section.title}</h3>
                {canManage && section.purpose === 'train' && (
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => blockAll('train')}>Block the lot</button>
                )}
              </div>
              <p style={{ ...helpStyle, marginBottom: '0.75rem' }}>{section.blurb}</p>
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%', fontSize: '0.8125rem' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Crawler</th>
                      <th style={{ textAlign: 'left' }}>What it does</th>
                      <th style={{ textAlign: 'left', width: 190 }}>Allowed?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((crawler) => (
                      <tr key={crawler.key}>
                        <td>
                          <div style={{ color: 'var(--color-text)' }}>{crawler.label}</div>
                          <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.75rem' }}>{crawler.vendor}</div>
                        </td>
                        <td style={{ color: 'var(--color-text-secondary)' }}>{crawler.note}</td>
                        <td>
                          <select
                            value={settings.crawlerPolicy[crawler.key] ?? 'default'}
                            disabled={!canManage}
                            onChange={(e) => setStance(crawler.key, e.target.value as 'allow' | 'block' | 'default')}
                            style={{ ...inputStyle, width: 175 }}
                          >
                            <option value="default">Allowed (not mentioned)</option>
                            <option value="allow">Allowed (said so)</option>
                            <option value="block">Blocked</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}

        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1rem' }}>
          <h3 style={{ margin: '0 0 0.25rem', fontSize: '0.875rem', color: 'var(--color-text)' }}>What they may do with what they read</h3>
          <p style={{ ...helpStyle, marginBottom: '0.75rem' }}>
            A statement of intent rather than a lock on the door: it says what you permit, in a form a
            growing number of companies have agreed to honour. Saying nothing is not the same as
            saying no, so each one is left unanswered until you answer it.
          </p>
          <SignalRow
            label="Show us in search results and answers"
            help="Including a link back to you. This is the one that brings people."
            value={settings.contentSignals.search}
            onChange={(v) => update({ contentSignals: { ...settings.contentSignals, search: v } })}
          />
          <SignalRow
            label="Use our pages to answer a question being asked right now"
            help="Quoted in an answer, usually with a citation. Also brings people."
            value={settings.contentSignals.aiInput}
            onChange={(v) => update({ contentSignals: { ...settings.contentSignals, aiInput: v } })}
          />
          <SignalRow
            label="Use our pages to train a model"
            help="Absorbed into a model. You get nothing back from this one."
            value={settings.contentSignals.aiTrain}
            onChange={(v) => update({ contentSignals: { ...settings.contentSignals, aiTrain: v } })}
          />
        </div>
      </Card>

      <Card title="Who has been reading">
        <Toggle
          label="Count AI crawler visits and visitors sent by assistants"
          help="Answers the question everybody asks next: is any of this working?"
          checked={settings.analytics}
          onChange={(v) => update({ analytics: v })}
        />
        <CostWarning>
          one database write per AI visit, which shows on your Vercel bill as <strong>Fluid Active CPU</strong>.
          An ordinary visitor costs nothing extra - the check that decides is two string comparisons and
          never touches the database.
        </CostWarning>

        {settings.analytics && (
          <div style={{ marginTop: '1rem' }}>
            <label style={labelStyle} htmlFor="seo-ai-retention">Keep the counts for</label>
            <select
              id="seo-ai-retention"
              value={settings.analyticsRetentionDays}
              onChange={(e) => update({ analyticsRetentionDays: Number(e.target.value) })}
              style={{ ...inputStyle, width: 200 }}
            >
              {[30, 90, 180, 365, 730].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
          </div>
        )}

        {analytics && (
          <div style={{ marginTop: '1.25rem' }}>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>
              Last {analytics.days} days: <strong>{analytics.totalCrawls.toLocaleString('en-GB')}</strong> crawler
              visits and <strong>{analytics.totalReferrals.toLocaleString('en-GB')}</strong> people arriving from an assistant.
            </p>
            {analytics.byAgent.length > 0 && (
              <table className="table" style={{ width: '100%', fontSize: '0.8125rem', marginTop: '0.75rem' }}>
                <thead><tr><th style={{ textAlign: 'left' }}>Who</th><th style={{ textAlign: 'left' }}>What</th><th style={{ textAlign: 'right' }}>Visits</th></tr></thead>
                <tbody>
                  {analytics.byAgent.slice(0, 15).map((row) => (
                    <tr key={`${row.kind}:${row.agent}`}>
                      <td style={{ color: 'var(--color-text)' }}>{row.agent}</td>
                      <td style={{ color: 'var(--color-text-secondary)' }}>{row.kind === 'crawler' ? 'Crawled pages' : 'Sent us people'}</td>
                      <td style={{ textAlign: 'right' }}>{row.hits.toLocaleString('en-GB')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </Card>

      <Card title="Let agents query the site directly">
        <Toggle
          label="Turn on the agent endpoint"
          help="An assistant can search your catalogue and read any page, in one call instead of crawling. Read-only: there is no tool here that changes anything."
          checked={settings.mcp}
          onChange={(v) => update({ mcp: v })}
        />
        <CostWarning>
          every agent request is a function call - <strong>Invocations</strong> and <strong>Fluid Active CPU</strong> on
          your Vercel bill. An agent can make a great many of them in a short space of time, and unlike a
          person it does not get bored.
        </CostWarning>

        {settings.mcp && (
          <div style={{ marginTop: '1rem' }}>
            <label style={labelStyle} htmlFor="seo-mcp-limit">Most results one search may return</label>
            <input
              id="seo-mcp-limit"
              type="number"
              min={1}
              max={100}
              value={settings.mcpMaxResults}
              onChange={(e) => update({ mcpMaxResults: Number(e.target.value) })}
              style={{ ...inputStyle, width: 120 }}
            />
            <p style={{ ...helpStyle, marginTop: '0.75rem' }}>
              The address to hand out: <code>{siteUrl}/api/m/ultimate-seo/mcp</code>
            </p>
          </div>
        )}
      </Card>

      <Card title="Summaries written for AI readers">
        <Toggle
          label="Let me write a one-line summary for each page"
          help="It goes at the top of that page's twin and into the index, and is the line a model quotes when it only has room for one. Adds a box to the Pages screen; costs nothing."
          checked={settings.abstracts}
          onChange={(v) => update({ abstracts: v })}
        />
      </Card>

      {canManage && (
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', position: 'sticky', bottom: 0, padding: '1rem 0', background: 'var(--color-bg)' }}>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && <span style={{ fontSize: '0.8125rem', color: 'var(--color-success)' }}>Saved.</span>}
        </div>
      )}
    </div>
  )
}
