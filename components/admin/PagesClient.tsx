'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { InventoryItem, SeoCheck } from '@/modules/ultimate-seo/lib/types'
import {
  INITIAL_DIR,
  ISSUE_STALE,
  ISSUE_UNANALYSED,
  NO_FILTERS,
  filterRows,
  issueOptions,
  sortRows,
  summarise,
  toCsv,
  toRow,
  type Filters,
  type PageRow,
  type SortDir,
  type SortKey,
} from '@/modules/ultimate-seo/lib/page-view'
import { API, ScoreBadge, SerpPreview, StatusDot, helpStyle, inputStyle, labelStyle } from './shared'

const TYPE_LABELS: Record<string, string> = {
  'core-page': 'Page',
  'gazette-post': 'Gazette post',
  'shop-product': 'Product',
  'shop-category': 'Product category',
  'shop-collection': 'Product collection',
  'filter-collection': 'Filter page',
  'directory-entry': 'Directory entry',
}

const EDIT_LABELS: Record<string, string> = {
  'gazette-post': 'Edit in Gazette',
  'shop-product': 'Edit in Shop',
  'shop-category': 'Edit in Shop',
  'shop-collection': 'Edit in Shop',
  'filter-collection': 'Edit in Shop',
  'directory-entry': 'Edit in Directory',
}

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

type AnalyzeResponse = { score: number; checks: SeoCheck[]; descriptionSuggestion: string | null }

type BulkKey = { entityType: string; entityId: string }
type BulkResponse = { analysed: Array<BulkKey & { score: number }>; missing: BulkKey[] }

// Pages per request. Small enough that a request never approaches the module
// route's 60s ceiling however big the catalogue gets, big enough that a few
// hundred pages do not turn into a few hundred round trips.
const BULK_CHUNK = 25

const PAGE_SIZES = [25, 50, 100, 0] as const
const VIEW_STORAGE_KEY = 'cactus-seo-pages-view'

type View = { filters: Filters; sortKey: SortKey; sortDir: SortDir; pageSize: number }

// Worst first, because that is what the screen is for. Everything unscored
// sorts to the bottom whichever way the arrow points (see sortRows), and the
// "Not analysed" tile above the table is the one click that brings it back up.
const DEFAULT_VIEW: View = { filters: NO_FILTERS, sortKey: 'score', sortDir: 'asc', pageSize: 50 }

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: 'title', label: 'Page' },
  { key: 'type', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'description', label: 'Description' },
  { key: 'keyword', label: 'Focus keyword' },
  { key: 'issues', label: 'Issues' },
  { key: 'score', label: 'Score' },
  { key: 'analysed', label: 'Analysed' },
]

function relativeDate(iso: string | null): string {
  if (!iso) return '-'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return '-'
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  if (days < 365) return `${Math.round(days / 30)} months ago`
  return `${Math.round(days / 365)} years ago`
}

export default function PagesClient({ adminPath, canManage }: { adminPath: string; canManage: boolean }) {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState<Filters>(DEFAULT_VIEW.filters)
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_VIEW.sortKey)
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_VIEW.sortDir)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_VIEW.pageSize)
  const [page, setPage] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkDone, setBulkDone] = useState(0)
  const [bulkTotal, setBulkTotal] = useState(0)
  const [bulkSummary, setBulkSummary] = useState('')
  const [bulkError, setBulkError] = useState('')
  const bulkAbort = useRef<AbortController | null>(null)

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

  /* eslint-disable react-hooks/set-state-in-effect -- neither the URL nor
     localStorage exists while this renders on the server, so the saved view and
     the deep link can only be applied once mounted. */
  useEffect(() => {
    // Deep-link (?focus=type:id) comes from the dashboard's quick-wins list;
    // read post-mount to avoid a Suspense requirement on useSearchParams. The
    // saved view is restored in the same pass, for the same reason: neither the
    // URL nor localStorage exists while the server renders this.
    const focus = new URLSearchParams(window.location.search).get('focus')
    if (focus) setSelectedKey(focus)
    try {
      const raw = window.localStorage.getItem(VIEW_STORAGE_KEY)
      if (!raw) return
      const saved = JSON.parse(raw) as Partial<View>
      if (saved.filters) setFilters({ ...NO_FILTERS, ...saved.filters })
      if (saved.sortKey) setSortKey(saved.sortKey)
      if (saved.sortDir) setSortDir(saved.sortDir)
      if (typeof saved.pageSize === 'number') setPageSize(saved.pageSize)
    } catch {
      // A corrupt or unreadable saved view is not worth a broken screen.
    }
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  const rememberView = useCallback((next: Partial<View>) => {
    try {
      const current: View = { filters, sortKey, sortDir, pageSize }
      window.localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify({ ...current, ...next }))
    } catch {
      // Private browsing, quota, whatever - the view just won't be remembered.
    }
  }, [filters, sortKey, sortDir, pageSize])

  const setFilter = useCallback((patch: Partial<Filters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    rememberView({ filters: next })
    setPage(0)
  }, [filters, rememberView])

  const rows = useMemo(() => items.map(toRow), [items])
  const filtered = useMemo(() => filterRows(rows, filters), [rows, filters])
  const sorted = useMemo(() => sortRows(filtered, sortKey, sortDir), [filtered, sortKey, sortDir])
  const summary = useMemo(() => summarise(rows), [rows])
  const issues = useMemo(() => issueOptions(rows), [rows])
  const availableTypes = useMemo(() => [...new Set(rows.map((r) => r.entityType))], [rows])
  const availableStatuses = useMemo(() => [...new Set(rows.map((r) => r.status))], [rows])

  const pageCount = pageSize > 0 ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1
  const safePage = Math.min(page, pageCount - 1)
  const visible = pageSize > 0 ? sorted.slice(safePage * pageSize, safePage * pageSize + pageSize) : sorted

  const selected = rows.find((r) => r.key === selectedKey) ?? null
  const filtersActive = (Object.keys(NO_FILTERS) as Array<keyof Filters>).some((k) => filters[k] !== NO_FILTERS[k])
  const bulkPct = bulkTotal ? Math.round((bulkDone / bulkTotal) * 100) : 0
  const selectionCount = selectedIds.size

  function toggleSort(key: SortKey) {
    // Clicking a new column starts it the way round that column is useful;
    // clicking the one already sorted turns it over.
    const nextDir: SortDir = sortKey === key ? (sortDir === 'asc' ? 'desc' : 'asc') : INITIAL_DIR[key]
    setSortKey(key)
    setSortDir(nextDir)
    setPage(0)
    rememberView({ sortKey: key, sortDir: nextDir })
  }

  function toggleRow(key: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function togglePageSelection() {
    const allOnPage = visible.every((r) => selectedIds.has(r.key))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const row of visible) {
        if (allOnPage) next.delete(row.key)
        else next.add(row.key)
      }
      return next
    })
  }

  function exportCsv() {
    // Byte-order mark first, or Excel opens a UK price list as mojibake.
    const blob = new Blob(['\ufeff', toCsv(sorted, typeLabel)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `seo-pages-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  // Walks whatever it is handed, a chunk per request, so the progress bar is
  // real rather than a spinner with good intentions.
  async function analyse(targets: PageRow[]) {
    if (targets.length === 0 || bulkRunning) return
    const keys = targets.map((r) => ({ entityType: r.entityType, entityId: r.entityId }))

    const controller = new AbortController()
    bulkAbort.current = controller
    setBulkRunning(true)
    setBulkDone(0)
    setBulkTotal(keys.length)
    setBulkSummary('')
    setBulkError('')

    const scores: number[] = []
    let missing = 0
    try {
      for (let start = 0; start < keys.length; start += BULK_CHUNK) {
        const chunk = keys.slice(start, start + BULK_CHUNK)
        const res = await fetch(`${API}/pages/analyze-bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: chunk }),
          signal: controller.signal,
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Bulk analysis failed')
        const result = data as BulkResponse
        for (const row of result.analysed) scores.push(row.score)
        missing += result.missing.length
        setBulkDone(Math.min(start + BULK_CHUNK, keys.length))
      }
      const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0
      setBulkSummary(
        `${scores.length} page${scores.length === 1 ? '' : 's'} analysed - average score ${avg}/100.`
        + (missing ? ` ${missing} disappeared mid-run and were skipped.` : ''),
      )
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setBulkSummary(`Stopped early - ${scores.length} page${scores.length === 1 ? '' : 's'} analysed before you pulled the plug.`)
      } else {
        setBulkError(err instanceof Error ? err.message : 'Bulk analysis failed')
      }
    } finally {
      bulkAbort.current = null
      setBulkRunning(false)
      await load()
    }
  }

  if (loading) return <p style={{ color: 'var(--color-text-secondary)' }}>Rounding up every page on the site…</p>
  if (error) return <div className="alert alert-danger">{error}</div>

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">SEO Pages</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="search"
            placeholder="Search title, address, keyword…"
            value={filters.search}
            onChange={(e) => setFilter({ search: e.target.value })}
            style={{ ...inputStyle, width: 240 }}
            aria-label="Search pages"
          />
          <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={sorted.length === 0} style={{ whiteSpace: 'nowrap' }}>
            Export {sorted.length}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => analyse(sorted)}
            disabled={bulkRunning || sorted.length === 0}
            style={{ whiteSpace: 'nowrap' }}
          >
            {bulkRunning ? 'Analysing…' : `Analyse ${filtersActive ? 'these' : 'all'} ${sorted.length}`}
          </button>
        </div>
      </div>

      <SummaryTiles
        summary={summary}
        filters={filters}
        onPick={(patch) => setFilter({ ...NO_FILTERS, search: filters.search, ...patch })}
      />

      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {availableTypes.length > 1 && (
          <Picker label="Content" value={filters.type} onChange={(v) => setFilter({ type: v })}>
            <option value="all">All content</option>
            {availableTypes.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
          </Picker>
        )}
        {availableStatuses.length > 1 && (
          <Picker label="Status" value={filters.status} onChange={(v) => setFilter({ status: v })}>
            <option value="all">Any status</option>
            <option value="published">Published</option>
            <option value="unpublished">Not published</option>
          </Picker>
        )}
        <Picker label="Score" value={filters.band} onChange={(v) => setFilter({ band: v })}>
          <option value="all">Any score</option>
          <option value="good">Good (80+)</option>
          <option value="fair">Needs work (50-79)</option>
          <option value="poor">Poor (under 50)</option>
          <option value="none">Not analysed</option>
        </Picker>
        <Picker label="Issue" value={filters.issue} onChange={(v) => setFilter({ issue: v })}>
          <option value="">Any issue</option>
          {issues.map((i) => <option key={i.key} value={i.key}>{i.label} ({i.count})</option>)}
        </Picker>
        <span style={{ marginLeft: 'auto', fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
          {sorted.length} of {rows.length} shown
        </span>
        {filtersActive && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setFilters(NO_FILTERS); setPage(0); rememberView({ filters: NO_FILTERS }) }}>
            Clear filters
          </button>
        )}
      </div>

      {selectionCount > 0 && (
        <div className="card" style={{ padding: '0.6rem 1rem', marginBottom: '1rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '0.8125rem' }}>{selectionCount} selected</strong>
          <button
            className="btn btn-primary btn-sm"
            disabled={bulkRunning}
            onClick={() => analyse(sorted.filter((r) => selectedIds.has(r.key)))}
          >
            Analyse selected
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelectedIds(new Set())}>Clear selection</button>
          {selectionCount < sorted.length && (
            <button className="btn btn-ghost btn-sm" onClick={() => setSelectedIds(new Set(sorted.map((r) => r.key)))}>
              Select all {sorted.length} matching
            </button>
          )}
        </div>
      )}

      {bulkRunning && (
        <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8125rem' }}>Analysing {bulkDone} of {bulkTotal}…</span>
            <button className="btn btn-secondary btn-sm" onClick={() => bulkAbort.current?.abort()}>Stop</button>
          </div>
          <div
            role="progressbar"
            aria-label="Bulk analysis progress"
            aria-valuenow={bulkPct}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{ height: 6, borderRadius: 999, background: 'var(--color-bg-subtle)', overflow: 'hidden' }}
          >
            <div style={{ width: `${bulkPct}%`, height: '100%', background: 'var(--color-primary)', transition: 'width 120ms linear' }} />
          </div>
        </div>
      )}

      {bulkError && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{bulkError}</div>}
      {bulkSummary && !bulkRunning && <div className="alert alert-success" style={{ marginBottom: '1rem' }}>{bulkSummary}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: selected ? 'minmax(0, 1fr) minmax(320px, 420px)' : '1fr', gap: '1rem', alignItems: 'start' }}>
        <div>
          <div className="table-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--color-text-secondary)' }}>
                  <th style={{ padding: '0.5rem', width: 32 }}>
                    <input
                      type="checkbox"
                      aria-label="Select every page on this page of results"
                      checked={visible.length > 0 && visible.every((r) => selectedIds.has(r.key))}
                      onChange={togglePageSelection}
                    />
                  </th>
                  {COLUMNS.map((col) => {
                    const active = sortKey === col.key
                    return (
                      <th
                        key={col.key}
                        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                        style={{ padding: 0, whiteSpace: 'nowrap' }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '0.25rem', width: '100%',
                            padding: '0.5rem', background: 'none', border: 'none', font: 'inherit', cursor: 'pointer',
                            color: active ? 'var(--color-text)' : 'var(--color-text-secondary)',
                            fontWeight: active ? 600 : 400,
                          }}
                        >
                          {col.label}
                          <span aria-hidden style={{ opacity: active ? 1 : 0.25 }}>{active && sortDir === 'desc' ? '▾' : '▴'}</span>
                        </button>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr
                    key={item.key}
                    onClick={() => setSelectedKey(item.key)}
                    style={{ cursor: 'pointer', borderTop: '1px solid var(--color-border)', background: item.key === selectedKey ? 'var(--color-bg-subtle)' : undefined }}
                  >
                    <td style={{ padding: '0.5rem' }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.title || item.url}`}
                        checked={selectedIds.has(item.key)}
                        onChange={() => toggleRow(item.key)}
                      />
                    </td>
                    <td style={{ padding: '0.5rem', maxWidth: 300 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{item.title || '(untitled)'}</div>
                      <div style={{ color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ color: 'inherit' }}
                        >
                          {item.url}
                        </a>
                      </div>
                    </td>
                    <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>{typeLabel(item.entityType)}</td>
                    <td style={{ padding: '0.5rem' }}>
                      <span className={`badge ${item.status === 'published' ? 'badge-success' : 'badge-gray'}`}>{item.status}</span>
                    </td>
                    <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>
                      {item.metaDescription
                        ? <span className="badge badge-success">{item.metaDescription.length} chars</span>
                        : <span className="badge badge-warning">missing</span>}
                    </td>
                    <td style={{ padding: '0.5rem', maxWidth: 160 }}>
                      {item.focusKeyword
                        ? <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.focusKeyword}</span>
                        : <span style={{ color: 'var(--color-text-secondary)' }}>-</span>}
                    </td>
                    <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>
                      {item.score === null
                        ? <span style={{ color: 'var(--color-text-secondary)' }}>-</span>
                        : (
                          <span style={{ display: 'inline-flex', gap: '0.35rem' }}>
                            {item.failures > 0 && <span className="badge badge-danger">{item.failures} ✕</span>}
                            {item.warnings > 0 && <span className="badge badge-warning">{item.warnings} !</span>}
                            {item.failures === 0 && item.warnings === 0 && <span className="badge badge-success">clean</span>}
                          </span>
                        )}
                    </td>
                    <td style={{ padding: '0.5rem' }}><ScoreBadge score={item.score} /></td>
                    <td style={{ padding: '0.5rem', whiteSpace: 'nowrap', color: 'var(--color-text-secondary)' }}>
                      {relativeDate(item.analyzedAt)}
                      {item.stale && <span className="badge badge-warning" style={{ marginLeft: '0.35rem' }}>out of date</span>}
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr><td colSpan={COLUMNS.length + 1} style={{ padding: '1rem', color: 'var(--color-text-secondary)' }}>Nothing matches that filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.75rem', fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
            <span>
              {sorted.length === 0
                ? 'Nothing to show'
                : pageSize > 0
                  ? `Showing ${safePage * pageSize + 1}-${Math.min((safePage + 1) * pageSize, sorted.length)} of ${sorted.length}`
                  : `Showing all ${sorted.length}`}
            </span>
            {pageCount > 1 && (
              <span style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                <button className="btn btn-secondary btn-sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Previous</button>
                <span>Page {safePage + 1} of {pageCount}</span>
                <button className="btn btn-secondary btn-sm" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>Next</button>
              </span>
            )}
            <label style={{ marginLeft: 'auto', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
              Per page
              <select
                value={pageSize}
                onChange={(e) => { const n = Number(e.target.value); setPageSize(n); setPage(0); rememberView({ pageSize: n }) }}
                style={{ ...inputStyle, width: 'auto' }}
              >
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n === 0 ? 'All' : n}</option>)}
              </select>
            </label>
          </div>
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

function Picker({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
        {children}
      </select>
    </label>
  )
}

// The figures an owner opens this screen to see, each one a filter: reading
// "43 have no meta description" and then having to go and build that filter by
// hand is the sort of thing that keeps a screen basic.
function SummaryTiles({ summary, filters, onPick }: {
  summary: ReturnType<typeof summarise>
  filters: Filters
  onPick: (patch: Partial<Filters>) => void
}) {
  const tiles: Array<{ label: string; value: string; patch: Partial<Filters>; active: boolean; tone?: string }> = [
    { label: 'Pages', value: String(summary.total), patch: {}, active: false },
    { label: 'Average score', value: summary.averageScore === null ? '-' : `${summary.averageScore}/100`, patch: {}, active: false },
    { label: 'Good', value: String(summary.good), patch: { band: 'good' }, active: filters.band === 'good', tone: 'var(--color-success)' },
    { label: 'Needs work', value: String(summary.fair), patch: { band: 'fair' }, active: filters.band === 'fair', tone: 'var(--color-warning)' },
    { label: 'Poor', value: String(summary.poor), patch: { band: 'poor' }, active: filters.band === 'poor', tone: 'var(--color-error)' },
    { label: 'Not analysed', value: String(summary.unanalysed), patch: { issue: ISSUE_UNANALYSED }, active: filters.issue === ISSUE_UNANALYSED },
    { label: 'No description', value: String(summary.missingDescription), patch: { issue: 'desc-present' }, active: filters.issue === 'desc-present' },
    { label: 'Score out of date', value: String(summary.stale), patch: { issue: ISSUE_STALE }, active: filters.issue === ISSUE_STALE },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
      {tiles.map((tile) => {
        const clickable = Object.keys(tile.patch).length > 0
        const body = (
          <>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>{tile.label}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 600, color: tile.tone ?? 'var(--color-text)' }}>{tile.value}</div>
          </>
        )
        const style: React.CSSProperties = {
          textAlign: 'left', padding: '0.6rem 0.75rem', borderRadius: 8,
          border: `1px solid ${tile.active ? 'var(--color-primary)' : 'var(--color-border)'}`,
          background: tile.active ? 'var(--color-bg-subtle)' : 'var(--color-surface)',
          font: 'inherit', cursor: clickable ? 'pointer' : 'default', width: '100%',
        }
        return clickable
          ? <button key={tile.label} type="button" onClick={() => onPick(tile.patch)} style={style} aria-pressed={tile.active}>{body}</button>
          : <div key={tile.label} style={style}>{body}</div>
      })}
    </div>
  )
}

function DetailPanel({ item, adminPath, canManage, onClose, onChanged }: {
  item: PageRow
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
    <div className="card" style={{ padding: '1rem', position: 'sticky', top: '1rem', maxHeight: 'calc(100vh - 2rem)', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h2 className="card-title" style={{ margin: 0 }}>Page detail</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <ScoreBadge score={score} />
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close detail panel">✕</button>
        </div>
      </div>

      {item.stale && (
        <div className="alert alert-info" style={{ marginBottom: '0.75rem', fontSize: '0.8125rem' }}>
          This page has been edited since it was last analysed, so the score below describes an older version of it.
        </div>
      )}

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
                {check.suggestion && <div style={{ color: 'var(--color-text-secondary)' }}>{check.suggestion}</div>}
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
