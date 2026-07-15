'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { InventoryItem, SeoCheck } from '@/modules/ultimate-seo/lib/types'
import { API, ScoreBadge, SerpPreview, StatusDot, helpStyle, inputStyle, labelStyle } from './shared'

const TYPE_LABELS: Record<string, string> = {
  'core-page': 'Page',
  'gazette-post': 'Gazette post',
  'shop-product': 'Product',
  'directory-entry': 'Directory entry',
}

const EDIT_LABELS: Record<string, string> = {
  'gazette-post': 'Edit in Gazette',
  'shop-product': 'Edit in Shop',
  'directory-entry': 'Edit in Directory',
}

type AnalyzeResponse = { score: number; checks: SeoCheck[]; descriptionSuggestion: string | null }

export default function PagesClient({ adminPath, canManage }: { adminPath: string; canManage: boolean }) {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/pages`)
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load pages')
      const data = await res.json() as { items: InventoryItem[] }
      setItems(data.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pages')
    } finally {
      setLoading(false)
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to async helper; all setState calls are after awaits
  useEffect(() => { load() }, [load])

  useEffect(() => {
    // Deep-link (?focus=type:id) comes from the dashboard's quick-wins list;
    // read post-mount to avoid a Suspense requirement on useSearchParams.
    const focus = new URLSearchParams(window.location.search).get('focus')
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL is only readable post-mount; setting during render would mismatch hydration
    if (focus) setSelectedKey(focus)
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((i) => {
      if (typeFilter !== 'all' && i.entityType !== typeFilter) return false
      if (q && !i.title.toLowerCase().includes(q) && !i.slug.toLowerCase().includes(q)) return false
      return true
    })
  }, [items, typeFilter, search])

  const availableTypes = useMemo(() => [...new Set(items.map((i) => i.entityType))], [items])
  const selected = items.find((i) => `${i.entityType}:${i.entityId}` === selectedKey) ?? null

  if (loading) return <p style={{ color: 'var(--color-text-muted)' }}>Rounding up every page on the site…</p>
  if (error) return <div className="alert alert-danger">{error}</div>

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">SEO Pages</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="search"
            placeholder="Search title or slug…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, width: 220 }}
            aria-label="Search pages"
          />
          {availableTypes.length > 1 && (
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ ...inputStyle, width: 'auto' }} aria-label="Filter by content type">
              <option value="all">All content</option>
              {availableTypes.map((t) => <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>)}
            </select>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? 'minmax(0, 1fr) minmax(320px, 420px)' : '1fr', gap: '1rem', alignItems: 'start' }}>
        <div className="table-wrapper">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--color-text-muted)' }}>
                <th style={{ padding: '0.5rem' }}>Title</th>
                <th style={{ padding: '0.5rem' }}>Type</th>
                <th style={{ padding: '0.5rem' }}>Status</th>
                <th style={{ padding: '0.5rem' }}>Description</th>
                <th style={{ padding: '0.5rem' }}>Score</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const key = `${item.entityType}:${item.entityId}`
                return (
                  <tr
                    key={key}
                    onClick={() => setSelectedKey(key)}
                    style={{ cursor: 'pointer', borderTop: '1px solid var(--color-border)', background: key === selectedKey ? 'var(--color-bg-subtle)' : undefined }}
                  >
                    <td style={{ padding: '0.5rem', maxWidth: 280 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{item.title || '(untitled)'}</div>
                      <div style={{ color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.url}</div>
                    </td>
                    <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>{TYPE_LABELS[item.entityType] ?? item.entityType}</td>
                    <td style={{ padding: '0.5rem' }}>
                      <span className={`badge ${item.status === 'published' ? 'badge-success' : 'badge-gray'}`}>{item.status}</span>
                    </td>
                    <td style={{ padding: '0.5rem' }}>
                      {item.metaDescription
                        ? <span className="badge badge-success">set</span>
                        : <span className="badge badge-warning">missing</span>}
                    </td>
                    <td style={{ padding: '0.5rem' }}><ScoreBadge score={item.score} /></td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={5} style={{ padding: '1rem', color: 'var(--color-text-muted)' }}>Nothing matches that filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {selected && (
          <DetailPanel
            key={selectedKey}
            item={selected}
            adminPath={adminPath}
            canManage={canManage}
            onClose={() => setSelectedKey(null)}
            onChanged={load}
          />
        )}
      </div>
    </div>
  )
}

function DetailPanel({ item, adminPath, canManage, onClose, onChanged }: {
  item: InventoryItem
  adminPath: string
  canManage: boolean
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [focusKeyword, setFocusKeyword] = useState(item.focusKeyword ?? '')
  const [checks, setChecks] = useState<SeoCheck[] | null>(item.checks)
  const [score, setScore] = useState<number | null>(item.score)
  const [descriptionSuggestion, setDescriptionSuggestion] = useState<string | null>(null)
  const [title, setTitle] = useState(item.title)
  const [description, setDescription] = useState(item.metaDescription ?? '')
  const [busy, setBusy] = useState(false)
  const [saveState, setSaveState] = useState('')
  const [error, setError] = useState('')

  const isCore = item.entityType === 'core-page'
  const base = `/${adminPath}`

  async function analyse() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${API}/pages/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType: item.entityType, entityId: item.entityId, focusKeyword: focusKeyword || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Analysis failed')
      const result = data as AnalyzeResponse
      setChecks(result.checks)
      setScore(result.score)
      setDescriptionSuggestion(result.descriptionSuggestion)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed')
    } finally {
      setBusy(false)
    }
  }

  async function apply(fields: { title?: string; metaDescription?: string | null }) {
    setBusy(true)
    setError('')
    setSaveState('')
    try {
      const res = await fetch(`${API}/pages/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityId: item.entityId, ...fields }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not apply the change')
      if (data.analysis) {
        setChecks(data.analysis.checks)
        setScore(data.analysis.score)
      }
      setSaveState('Saved')
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply the change')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ padding: '1rem', position: 'sticky', top: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h2 className="card-title" style={{ margin: 0 }}>Page detail</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <ScoreBadge score={score} />
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close detail panel">✕</button>
        </div>
      </div>

      <div style={{ marginBottom: '0.75rem' }}>
        <SerpPreview title={isCore ? title : item.title} description={isCore ? (description || null) : item.metaDescription} url={item.url} />
      </div>

      {isCore && canManage ? (
        <>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={labelStyle} htmlFor="seo-title-input">Title</label>
            <input id="seo-title-input" value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} maxLength={200} />
            <p style={helpStyle}>{title.length} characters - 30 to 60 is the sweet spot.</p>
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={labelStyle} htmlFor="seo-desc-input">Meta description</label>
            <textarea id="seo-desc-input" value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} maxLength={300} />
            <p style={helpStyle}>{description.length} characters - 50 to 160 reads best in results.</p>
          </div>
          {descriptionSuggestion && descriptionSuggestion !== description && (
            <div className="alert alert-info" style={{ marginBottom: '0.75rem', fontSize: '0.8125rem' }}>
              <strong>Suggested description (from the page copy):</strong>
              <p style={{ margin: '0.25rem 0 0.5rem' }}>{descriptionSuggestion}</p>
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setDescription(descriptionSuggestion)}>Use suggestion</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={busy || (title === item.title && (description || null) === item.metaDescription)}
              onClick={() => apply({ title, metaDescription: description || null })}
            >
              Save changes
            </button>
            <Link href={`${base}/pages/${item.entityId}`} className="btn btn-secondary btn-sm">Open in editor</Link>
            {saveState && <span style={{ fontSize: '0.8125rem', color: 'var(--color-success)' }}>{saveState}</span>}
          </div>
        </>
      ) : (
        <div style={{ marginBottom: '1rem' }}>
          <p style={helpStyle}>
            This content belongs to another part of the site, so edits happen in its own editor - the analysis below still applies.
          </p>
          {item.editPath && (
            <Link href={`${base}${item.editPath}`} className="btn btn-secondary btn-sm" style={{ marginTop: '0.5rem' }}>
              {EDIT_LABELS[item.entityType] ?? 'Open editor'}
            </Link>
          )}
        </div>
      )}

      <div style={{ marginBottom: '0.75rem' }}>
        <label style={labelStyle} htmlFor="seo-keyword-input">Focus keyword</label>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input id="seo-keyword-input" value={focusKeyword} onChange={(e) => setFocusKeyword(e.target.value)} style={inputStyle} placeholder="e.g. handmade oak furniture" maxLength={120} />
          <button className="btn btn-primary btn-sm" onClick={analyse} disabled={busy}>{busy ? 'Working…' : 'Analyse'}</button>
        </div>
        <p style={helpStyle}>The search phrase this page should win. The analyser scores against it.</p>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: '0.75rem' }}>{error}</div>}

      {checks && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {checks.map((check) => (
            <li key={check.key} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.8125rem' }}>
              <StatusDot status={check.status} />
              <div>
                <div>{check.message}</div>
                {check.suggestion && <div style={{ color: 'var(--color-text-muted)' }}>{check.suggestion}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!checks && (
        <p style={helpStyle}>Not analysed yet - set a focus keyword (or not) and hit Analyse.</p>
      )}
    </div>
  )
}
