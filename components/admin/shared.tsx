'use client'

import type { CheckStatus } from '@/modules/ultimate-seo/lib/types'

export const API = '/api/m/ultimate-seo/admin'

export function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="badge badge-gray">Not analysed</span>
  const cls = score >= 80 ? 'badge-success' : score >= 50 ? 'badge-warning' : 'badge-danger'
  return <span className={`badge ${cls}`}>{score}/100</span>
}

export function StatusDot({ status }: { status: CheckStatus }) {
  const color = status === 'pass' ? 'var(--color-success)' : status === 'warn' ? 'var(--color-warning)' : 'var(--color-error)'
  return <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, marginTop: 6 }} />
}

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.375rem 0.5rem',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  fontSize: '0.8125rem',
  fontFamily: 'inherit',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
}

export const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8125rem',
  fontWeight: 500,
  color: 'var(--color-text)',
  marginBottom: '0.375rem',
}

export const helpStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--color-text-muted)',
  margin: '0.25rem 0 0',
}

/** Google-result-style preview of a title + description + URL. */
export function SerpPreview({ title, description, url }: { title: string; description: string | null; url: string }) {
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '0.75rem 1rem', background: 'var(--color-bg)' }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</div>
      <div style={{ fontSize: '1.05rem', color: 'var(--color-primary)', lineHeight: 1.3, margin: '0.15rem 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {title.length > 60 ? `${title.slice(0, 60)}…` : title || '(no title)'}
      </div>
      <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
        {description
          ? (description.length > 160 ? `${description.slice(0, 160)}…` : description)
          : <em>No meta description - search engines will improvise, and they are not known for their copywriting.</em>}
      </div>
    </div>
  )
}
