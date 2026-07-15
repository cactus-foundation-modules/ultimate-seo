'use client'

// "SEO" tab on the core admin settings page (settingsTabs manifest entry).
// Takes over the search-visibility switch (stored on core SiteConfig, where
// robots.txt reads it) and holds the module's own global defaults.

import { useEffect, useState } from 'react'
import { helpStyle, inputStyle, labelStyle } from './shared'

const API = '/api/m/ultimate-seo/admin'

type Settings = {
  organization: { name: string; legalName: string; logoUrl: string; sameAs: string[] }
  social: { twitterHandle: string }
  targets: { titleMin: number; titleMax: number; descMin: number; descMax: number; densityMin: number; densityMax: number; auditMaxPages: number }
  hideFromCrawlers: boolean
  siteStatus: string
}

export function UltimateSeoSettingsTab() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [sameAsText, setSameAsText] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${API}/settings`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load settings')
        const data = await res.json() as Settings
        setSettings(data)
        setSameAsText(data.organization.sameAs.join('\n'))
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load settings'))
  }, [])

  async function save() {
    if (!settings) return
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const body = {
        organization: {
          ...settings.organization,
          sameAs: sameAsText.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 20),
        },
        social: settings.social,
        targets: settings.targets,
        hideFromCrawlers: settings.hideFromCrawlers,
      }
      const res = await fetch(`${API}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to save')
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (error && !settings) return <div className="alert alert-danger">{error}</div>
  if (!settings) return <p style={{ color: 'var(--color-text-muted)' }}>Loading SEO settings…</p>

  const set = (patch: Partial<Settings>) => setSettings({ ...settings, ...patch })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 640 }}>
      <section>
        <h3 style={{ fontSize: '0.9375rem', margin: '0 0 0.25rem' }}>Search engine visibility</h3>
        <p style={{ ...helpStyle, marginBottom: '0.5rem' }}>
          The master switch. While hidden, robots.txt tells every crawler to go away.
        </p>
        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.8125rem', color: 'var(--color-text)' }}>
          <input
            type="checkbox"
            checked={!settings.hideFromCrawlers}
            onChange={(e) => set({ hideFromCrawlers: !e.target.checked })}
          />
          Let search engines index this site
        </label>
        {settings.hideFromCrawlers && (
          <p style={{ ...helpStyle, color: 'var(--color-warning)' }}>
            Currently hidden - all the SEO polish in the world will not help until this is on.
          </p>
        )}
        {settings.siteStatus !== 'live' && (
          <p style={{ ...helpStyle, color: 'var(--color-warning)' }}>
            Site status is “{settings.siteStatus}”, which also blocks crawlers regardless of this switch.
          </p>
        )}
      </section>

      <section>
        <h3 style={{ fontSize: '0.9375rem', margin: '0 0 0.25rem' }}>Organisation details</h3>
        <p style={{ ...helpStyle, marginBottom: '0.5rem' }}>
          Used by the “Structured data” page-builder block to tell search engines who is behind the site.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label style={labelStyle} htmlFor="seo-org-name">Name</label>
            <input id="seo-org-name" value={settings.organization.name} onChange={(e) => set({ organization: { ...settings.organization, name: e.target.value } })} style={inputStyle} maxLength={200} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="seo-org-legal">Legal name (optional)</label>
            <input id="seo-org-legal" value={settings.organization.legalName} onChange={(e) => set({ organization: { ...settings.organization, legalName: e.target.value } })} style={inputStyle} maxLength={200} />
          </div>
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <label style={labelStyle} htmlFor="seo-org-logo">Logo URL</label>
          <input id="seo-org-logo" value={settings.organization.logoUrl} onChange={(e) => set({ organization: { ...settings.organization, logoUrl: e.target.value } })} style={inputStyle} maxLength={500} placeholder="https://…" />
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <label style={labelStyle} htmlFor="seo-org-sameas">Official profiles (one URL per line)</label>
          <textarea id="seo-org-sameas" value={sameAsText} onChange={(e) => setSameAsText(e.target.value)} style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} placeholder={'https://www.facebook.com/…\nhttps://www.instagram.com/…'} />
          <p style={helpStyle}>Social pages, company registries - anywhere that proves you are you.</p>
        </div>
        <div style={{ marginTop: '0.75rem', maxWidth: 280 }}>
          <label style={labelStyle} htmlFor="seo-twitter">X / Twitter handle</label>
          <input id="seo-twitter" value={settings.social.twitterHandle} onChange={(e) => set({ social: { twitterHandle: e.target.value } })} style={inputStyle} maxLength={60} placeholder="@yoursite" />
        </div>
      </section>

      <section>
        <h3 style={{ fontSize: '0.9375rem', margin: '0 0 0.25rem' }}>Analyser targets</h3>
        <p style={{ ...helpStyle, marginBottom: '0.5rem' }}>
          The defaults follow current good practice; change them only if you enjoy arguing with an algorithm.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
          {([
            ['titleMin', 'Title min'], ['titleMax', 'Title max'],
            ['descMin', 'Description min'], ['descMax', 'Description max'],
            ['auditMaxPages', 'Audit page limit'],
          ] as const).map(([key, label]) => (
            <div key={key}>
              <label style={labelStyle} htmlFor={`seo-target-${key}`}>{label}</label>
              <input
                id={`seo-target-${key}`}
                type="number"
                value={settings.targets[key]}
                onChange={(e) => set({ targets: { ...settings.targets, [key]: parseInt(e.target.value, 10) || 0 } })}
                style={inputStyle}
                min={1}
              />
            </div>
          ))}
        </div>
      </section>

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save SEO settings'}</button>
        {saved && <span style={{ fontSize: '0.8125rem', color: 'var(--color-success)' }}>Saved</span>}
        {error && settings && <span style={{ fontSize: '0.8125rem', color: 'var(--color-error)' }}>{error}</span>}
      </div>
    </div>
  )
}
