'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { API, ScoreBadge } from './shared'

type Overview = {
  totals: {
    pages: number
    published: number
    analyzed: number
    avgScore: number | null
    missingDescriptions: number
    missingOgImages: number
    missingKeywords: number
    duplicateTitles: number
  }
  hideFromCrawlers: boolean
  siteStatus: string
  latestRuns: Array<{ id: string; status: string; started_at: string; pages_crawled: number; pages_total: number; summary: { errors: number; warnings: number; notices: number } | null }>
  quickWins: Array<{ entityType: string; entityId: string; title: string; url: string; score: number | null }>
}

function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'good' ? 'var(--color-success)' : tone === 'warn' ? 'var(--color-warning)' : tone === 'bad' ? 'var(--color-error)' : 'var(--color-text)'
  return (
    <div className="card" style={{ padding: '1rem', minWidth: 0 }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 600, color }}>{value}</div>
      <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>{label}</div>
    </div>
  )
}

export default function DashboardClient({ adminPath }: { adminPath: string }) {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${API}/overview`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load')
        setData(await res.json())
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
  }, [])

  if (error) return <div className="alert alert-danger">{error}</div>
  if (!data) return <p style={{ color: 'var(--color-text-secondary)' }}>Sizing up the site…</p>

  const t = data.totals
  const base = `/${adminPath}`

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">SEO Dashboard</h1>
        <Link href={`${base}/m/ultimate-seo/pages`} className="btn btn-primary btn-sm">Review pages</Link>
      </div>

      {data.hideFromCrawlers && (
        <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
          <strong>The whole site is currently hidden from search engines.</strong> Every other number on this page is
          academic until that changes - flip the switch in Settings → SEO when you are ready to be found.
        </div>
      )}
      {data.siteStatus !== 'live' && (
        <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
          The site status is <strong>{data.siteStatus}</strong>, which also blocks search engines.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <StatCard label="Average SEO score" value={t.avgScore === null ? '—' : `${t.avgScore}/100`} tone={t.avgScore === null ? undefined : t.avgScore >= 80 ? 'good' : t.avgScore >= 50 ? 'warn' : 'bad'} />
        <StatCard label="Pages tracked" value={t.pages} />
        <StatCard label="Published" value={t.published} />
        <StatCard label="Analysed" value={`${t.analyzed}/${t.pages}`} tone={t.analyzed === t.pages && t.pages > 0 ? 'good' : undefined} />
        <StatCard label="Missing descriptions" value={t.missingDescriptions} tone={t.missingDescriptions > 0 ? 'warn' : 'good'} />
        <StatCard label="Missing social images" value={t.missingOgImages} tone={t.missingOgImages > 0 ? 'warn' : 'good'} />
        <StatCard label="No focus keyword" value={t.missingKeywords} tone={t.missingKeywords > 0 ? 'warn' : 'good'} />
        <StatCard label="Duplicate titles" value={t.duplicateTitles} tone={t.duplicateTitles > 0 ? 'bad' : 'good'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
        <div className="card" style={{ padding: '1rem' }}>
          <h2 className="card-title" style={{ marginBottom: '0.75rem' }}>Quick wins</h2>
          {data.quickWins.length === 0 ? (
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
              Nothing analysed yet. Head to the Pages screen and run the analyser - it is quite keen.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {data.quickWins.map((w) => (
                <li key={`${w.entityType}:${w.entityId}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                  <Link href={`${base}/m/ultimate-seo/pages?focus=${encodeURIComponent(`${w.entityType}:${w.entityId}`)}`} style={{ fontSize: '0.8125rem', color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {w.title || w.url}
                  </Link>
                  <ScoreBadge score={w.score} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card" style={{ padding: '1rem' }}>
          <h2 className="card-title" style={{ marginBottom: '0.75rem' }}>Recent site audits</h2>
          {data.latestRuns.length === 0 ? (
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
              No crawls yet. The Site audit screen will happily go and knock on every page for you.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {data.latestRuns.map((run) => (
                <li key={run.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.8125rem' }}>
                  <span style={{ color: 'var(--color-text-secondary)' }}>{new Date(run.started_at).toLocaleString()}</span>
                  <span>
                    {run.pages_crawled}/{run.pages_total} pages
                    {run.summary ? ` · ${run.summary.errors} errors, ${run.summary.warnings} warnings` : ''}
                    {run.status !== 'complete' ? ` (${run.status})` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: '0.75rem' }}>
            <Link href={`${base}/m/ultimate-seo/audit`} className="btn btn-secondary btn-sm">Open site audit</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
