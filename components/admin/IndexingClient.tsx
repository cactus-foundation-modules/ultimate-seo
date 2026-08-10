'use client'

import { useCallback, useEffect, useState } from 'react'
import { API, helpStyle, inputStyle, labelStyle } from './shared'

type Rule = { id: string; path: string; note: string | null }
type Entry = { id: string; path: string; priority: number | null; change_freq: string | null; note: string | null }

export default function IndexingClient() {
  const [rules, setRules] = useState<Rule[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [rulePath, setRulePath] = useState('')
  const [ruleNote, setRuleNote] = useState('')
  const [entryPath, setEntryPath] = useState('')
  const [entryPriority, setEntryPriority] = useState('')
  const [entryFreq, setEntryFreq] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [robotsRes, sitemapRes] = await Promise.all([fetch(`${API}/robots`), fetch(`${API}/sitemap`)])
      if (!robotsRes.ok || !sitemapRes.ok) throw new Error('Failed to load rules')
      setRules((await robotsRes.json()).rules)
      setEntries((await sitemapRes.json()).entries)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rules')
    } finally {
      setLoading(false)
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to async helper; all setState calls are after awaits
  useEffect(() => { load() }, [load])

  async function addRule() {
    if (!rulePath.trim()) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${API}/robots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: rulePath.trim(), note: ruleNote.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not add rule')
      setRules(data.rules)
      setRulePath('')
      setRuleNote('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add rule')
    } finally {
      setBusy(false)
    }
  }

  async function deleteRule(id: string) {
    setBusy(true)
    try {
      const res = await fetch(`${API}/robots/${id}`, { method: 'DELETE' })
      if (res.ok) setRules((await res.json()).rules)
    } finally {
      setBusy(false)
    }
  }

  async function addEntry() {
    if (!entryPath.trim()) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${API}/sitemap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: entryPath.trim(),
          priority: entryPriority === '' ? null : Number(entryPriority),
          changeFreq: entryFreq || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not add entry')
      setEntries(data.entries)
      setEntryPath('')
      setEntryPriority('')
      setEntryFreq('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add entry')
    } finally {
      setBusy(false)
    }
  }

  async function deleteEntry(id: string) {
    setBusy(true)
    try {
      const res = await fetch(`${API}/sitemap/${id}`, { method: 'DELETE' })
      if (res.ok) setEntries((await res.json()).entries)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p style={{ color: 'var(--color-text-secondary)' }}>Loading indexing rules…</p>

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Sitemap &amp; robots</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <a href="/sitemap.xml" target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">View sitemap.xml</a>
          <a href="/robots.txt" target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">View robots.txt</a>
        </div>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
        <div className="card" style={{ padding: '1rem' }}>
          <h2 className="card-title" style={{ marginBottom: '0.25rem' }}>Blocked paths (robots.txt)</h2>
          <p style={{ ...helpStyle, marginBottom: '0.75rem' }}>
            Paths listed here are added as Disallow rules in robots.txt, on top of the ones Cactus already blocks
            (admin, setup and friends). Takes effect immediately.
          </p>

          {rules.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '0 0 0.75rem', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              {rules.map((rule) => (
                <li key={rule.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center', fontSize: '0.8125rem' }}>
                  <span>
                    <code>{rule.path}</code>
                    {rule.note && <span style={{ color: 'var(--color-text-secondary)' }}> - {rule.note}</span>}
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={() => deleteRule(rule.id)} disabled={busy} aria-label={`Remove ${rule.path}`}>Remove</button>
                </li>
              ))}
            </ul>
          )}

          <label style={labelStyle} htmlFor="robots-path">Path to block</label>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <input id="robots-path" value={rulePath} onChange={(e) => setRulePath(e.target.value)} style={inputStyle} placeholder="/private-stuff" />
            <button className="btn btn-primary btn-sm" onClick={addRule} disabled={busy || !rulePath.trim()}>Add</button>
          </div>
          <input value={ruleNote} onChange={(e) => setRuleNote(e.target.value)} style={inputStyle} placeholder="Note (optional, for future you)" aria-label="Note for this rule" />
        </div>

        <div className="card" style={{ padding: '1rem' }}>
          <h2 className="card-title" style={{ marginBottom: '0.25rem' }}>Extra sitemap entries</h2>
          <p style={{ ...helpStyle, marginBottom: '0.75rem' }}>
            Pages and content are in the sitemap automatically. Add anything else you want search engines to find here.
          </p>

          {entries.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '0 0 0.75rem', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              {entries.map((entry) => (
                <li key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center', fontSize: '0.8125rem' }}>
                  <span>
                    <code>{entry.path}</code>
                    <span style={{ color: 'var(--color-text-secondary)' }}>
                      {entry.priority !== null ? ` · priority ${entry.priority}` : ''}
                      {entry.change_freq ? ` · ${entry.change_freq}` : ''}
                    </span>
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={() => deleteEntry(entry.id)} disabled={busy} aria-label={`Remove ${entry.path}`}>Remove</button>
                </li>
              ))}
            </ul>
          )}

          <label style={labelStyle} htmlFor="sitemap-path">Path to include</label>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <input id="sitemap-path" value={entryPath} onChange={(e) => setEntryPath(e.target.value)} style={inputStyle} placeholder="/special-landing-page" />
            <button className="btn btn-primary btn-sm" onClick={addEntry} disabled={busy || !entryPath.trim()}>Add</button>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select value={entryPriority} onChange={(e) => setEntryPriority(e.target.value)} style={inputStyle} aria-label="Priority">
              <option value="">Priority (default)</option>
              {['1.0', '0.9', '0.8', '0.7', '0.6', '0.5', '0.4', '0.3', '0.2', '0.1'].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={entryFreq} onChange={(e) => setEntryFreq(e.target.value)} style={inputStyle} aria-label="Change frequency">
              <option value="">Change frequency (default)</option>
              {['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'].map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}
