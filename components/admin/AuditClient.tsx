'use client'

import { useCallback, useEffect, useState } from 'react'
import { API } from './shared'

type Run = {
  id: string
  trigger: string
  status: 'running' | 'complete' | 'partial' | 'failed'
  started_at: string
  finished_at: string | null
  pages_total: number
  pages_crawled: number
  summary: { errors: number; warnings: number; notices: number; avgResponseMs: number } | null
}

type Issue = {
  id: string
  url: string
  severity: 'error' | 'warning' | 'notice'
  check_key: string
  message: string
}

const SEVERITY_BADGE: Record<Issue['severity'], string> = {
  error: 'badge-danger',
  warning: 'badge-warning',
  notice: 'badge-info',
}

export default function AuditClient({ canManage }: { canManage: boolean }) {
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [openRun, setOpenRun] = useState<string | null>(null)
  const [issues, setIssues] = useState<Record<string, Issue[]>>({})

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/audit`)
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load audits')
      const data = await res.json() as { runs: Run[] }
      setRuns(data.runs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audits')
    } finally {
      setLoading(false)
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to async helper; all setState calls are after awaits
  useEffect(() => { load() }, [load])

  async function startAudit() {
    setStarting(true)
    setError('')
    try {
      const res = await fetch(`${API}/audit`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Audit failed to start')
      await load()
      if (data.runId) await openIssues(data.runId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audit failed to start')
    } finally {
      setStarting(false)
    }
  }

  async function openIssues(runId: string) {
    setOpenRun((current) => (current === runId ? null : runId))
    if (!issues[runId]) {
      const res = await fetch(`${API}/audit/${runId}`)
      if (res.ok) {
        const data = await res.json() as { issues: Issue[] }
        setIssues((prev) => ({ ...prev, [runId]: data.issues }))
      }
    }
  }

  if (loading) return <p style={{ color: 'var(--color-text-muted)' }}>Fetching audit history…</p>

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Site audit</h1>
        {canManage && (
          <button className="btn btn-primary btn-sm" onClick={startAudit} disabled={starting}>
            {starting ? 'Crawling… (this takes a minute)' : 'Run audit now'}
          </button>
        )}
      </div>

      <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
        The audit visits your published pages the same way a search engine does and reports what it finds -
        it also runs itself weekly, so the history below fills up on its own.
      </p>

      {error && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{error}</div>}

      {runs.length === 0 ? (
        <div className="card" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
          No audits yet. Press the button and let the crawler stretch its legs.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {runs.map((run) => {
            const runIssues = issues[run.id]
            return (
            <div key={run.id} className="card" style={{ padding: '0.75rem 1rem' }}>
              <button
                onClick={() => openIssues(run.id)}
                style={{ all: 'unset', cursor: 'pointer', display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', boxSizing: 'border-box' }}
                aria-expanded={openRun === run.id}
              >
                <span style={{ fontSize: '0.8125rem' }}>
                  <strong>{new Date(run.started_at).toLocaleString()}</strong>
                  <span style={{ color: 'var(--color-text-muted)' }}> · {run.trigger === 'cron' ? 'scheduled' : 'manual'} · {run.pages_crawled}/{run.pages_total} pages</span>
                </span>
                <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.8125rem' }}>
                  {run.summary && (
                    <>
                      <span className="badge badge-danger">{run.summary.errors} errors</span>
                      <span className="badge badge-warning">{run.summary.warnings} warnings</span>
                      <span className="badge badge-info">{run.summary.notices} notices</span>
                    </>
                  )}
                  <span className={`badge ${run.status === 'complete' ? 'badge-success' : run.status === 'failed' ? 'badge-danger' : 'badge-gray'}`}>{run.status}</span>
                </span>
              </button>

              {openRun === run.id && (
                <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem' }}>
                  {!runIssues ? (
                    <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Loading issues…</p>
                  ) : runIssues.length === 0 ? (
                    <p style={{ fontSize: '0.8125rem', color: 'var(--color-success)' }}>Not a single issue. Frame this.</p>
                  ) : (
                    <div className="table-wrapper">
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                        <thead>
                          <tr style={{ textAlign: 'left', color: 'var(--color-text-muted)' }}>
                            <th style={{ padding: '0.375rem' }}>Severity</th>
                            <th style={{ padding: '0.375rem' }}>Page</th>
                            <th style={{ padding: '0.375rem' }}>Issue</th>
                          </tr>
                        </thead>
                        <tbody>
                          {runIssues.map((issue) => (
                            <tr key={issue.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                              <td style={{ padding: '0.375rem', whiteSpace: 'nowrap' }}>
                                <span className={`badge ${SEVERITY_BADGE[issue.severity]}`}>{issue.severity}</span>
                              </td>
                              <td style={{ padding: '0.375rem', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                <a href={issue.url} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)' }}>{issue.url}</a>
                              </td>
                              <td style={{ padding: '0.375rem' }}>{issue.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
