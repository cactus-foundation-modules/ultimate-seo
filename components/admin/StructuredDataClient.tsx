'use client'

// The "Structured data" tab: the site-wide organisation profile, the switches
// that publish it, and a preview of the exact JSON-LD every public page will
// carry. The preview comes back from the server built by the same function the
// live pages use, so it cannot drift into being a flattering approximation.

import { useCallback, useEffect, useState } from 'react'
import { API, helpStyle, inputStyle, labelStyle } from './shared'
import {
  CONTACT_TYPES,
  LOCAL_ORG_TYPES,
  ORG_TYPES,
  RETURN_FEES,
  RETURN_METHODS,
  RETURN_POLICY_CATEGORIES,
  type OrgType,
  type ReturnFees,
  type ReturnMethod,
  type ReturnPolicyCategory,
  type SeoStructuredData,
} from '@/modules/ultimate-seo/lib/types'

type Payload = {
  structuredData: SeoStructuredData
  siteUrl: string | null
  siteName: string
  fallbackSameAs: string[]
  jsonLd: Record<string, unknown>[]
}

const ORG_TYPE_LABELS: Record<OrgType, string> = {
  Organization: 'Organisation',
  LocalBusiness: 'Local business',
  Store: 'Shop with premises',
  OnlineStore: 'Online shop',
  Corporation: 'Corporation',
  ProfessionalService: 'Professional service',
}

/** Keys holding a plain string, so the generic text helper cannot be pointed at a list. */
type TextKey = {
  [K in keyof SeoStructuredData]: SeoStructuredData[K] extends string ? K : never
}[keyof SeoStructuredData]

/**
 * Keys holding a list edited as one-per-line text. `orgTypes` is excluded by
 * hand: it is an `OrgType[]`, which structurally IS a `string[]`, so without
 * this the tick-boxes would be handed to the textarea helper and then flattened
 * back over the saved value by the list collector.
 */
type ListKey = Exclude<{
  [K in keyof SeoStructuredData]: SeoStructuredData[K] extends string[] ? K : never
}[keyof SeoStructuredData], 'orgTypes'>

const LIST_KEYS: ListKey[] = ['openingHours', 'areaServed', 'sameAs', 'contactAreaServed', 'contactAvailableLanguage']

function Field({ id, label, help, children }: { id: string; label: string; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle} htmlFor={id}>{label}</label>
      {children}
      {help && <p style={helpStyle}>{help}</p>}
    </div>
  )
}

function Toggle({ checked, onChange, label, help, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; help: string; disabled?: boolean }) {
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <label style={{
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'center',
        fontSize: '0.8125rem',
        // Greyed and not-allowed, so a switch that cannot do anything looks like
        // one rather than like a switch that is simply ignoring the click.
        color: disabled ? 'var(--color-text-secondary)' : 'var(--color-text)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      <p style={helpStyle}>{help}</p>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card" style={{ padding: '1rem' }}>
      <h2 className="card-title" style={{ marginBottom: '0.75rem' }}>{title}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>{children}</div>
    </section>
  )
}

const rowStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }

// Schema.org's own words on the left, a shopkeeper's on the right. Nobody has
// ever described their returns policy as a MerchantReturnFiniteReturnWindow.
const RETURN_CATEGORY_LABELS: Record<ReturnPolicyCategory, string> = {
  MerchantReturnFiniteReturnWindow: 'Accepted, within a set number of days',
  MerchantReturnUnlimitedWindow: 'Accepted, no time limit',
  MerchantReturnNotPermitted: 'Not accepted',
}

const RETURN_METHOD_LABELS: Record<ReturnMethod, string> = {
  ReturnByMail: 'Sent back by post or carrier',
  ReturnInStore: 'Brought back to the shop',
  ReturnAtKiosk: 'Dropped at a collection point',
}

const RETURN_FEES_LABELS: Record<ReturnFees, string> = {
  FreeReturn: 'Free - we pay',
  ReturnShippingFees: 'The customer pays return postage',
  RestockingFees: 'A restocking fee applies',
}

export default function StructuredDataClient() {
  const [data, setData] = useState<Payload | null>(null)
  const [form, setForm] = useState<SeoStructuredData | null>(null)
  // Every one-per-line list is edited as raw text so a half-typed line is not
  // eaten mid-keystroke by the trim-and-filter that runs on save.
  const [lists, setLists] = useState<Record<ListKey, string>>({
    openingHours: '', areaServed: '', sameAs: '', contactAreaServed: '', contactAvailableLanguage: '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback((payload: Payload) => {
    setData(payload)
    setForm(payload.structuredData)
    setLists(Object.fromEntries(
      LIST_KEYS.map((key) => [key, payload.structuredData[key].join('\n')])
    ) as Record<ListKey, string>)
  }, [])

  useEffect(() => {
    fetch(`${API}/structured-data`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load')
        load(await res.json() as Payload)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
  }, [load])

  async function save() {
    if (!form) return
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const listValues = Object.fromEntries(
        LIST_KEYS.map((key) => [key, lists[key].split('\n').map((s) => s.trim()).filter(Boolean)])
      ) as Record<ListKey, string[]>
      const res = await fetch(`${API}/structured-data`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, ...listValues } satisfies SeoStructuredData),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error ?? 'Failed to save')
      load(payload as Payload)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (error && !form) return <div className="alert alert-danger">{error}</div>
  if (!form || !data) return <p style={{ color: 'var(--color-text-secondary)' }}>Reading the paperwork…</p>

  const set = (patch: Partial<SeoStructuredData>) => setForm({ ...form, ...patch })
  const isLocal = form.orgTypes.some((t) => LOCAL_ORG_TYPES.has(t))

  const text = (key: TextKey, label: string, help?: React.ReactNode, placeholder?: string) => (
    <Field id={`sd-${key}`} label={label} help={help}>
      <input
        id={`sd-${key}`}
        value={form[key]}
        onChange={(e) => set({ [key]: e.target.value } as Partial<SeoStructuredData>)}
        style={inputStyle}
        placeholder={placeholder}
      />
    </Field>
  )

  const number = (key: 'logoWidth' | 'logoHeight', label: string) => (
    <Field id={`sd-${key}`} label={label}>
      <input
        id={`sd-${key}`}
        type="number"
        min={1}
        value={form[key] ?? ''}
        onChange={(e) => set({ [key]: e.target.value ? parseInt(e.target.value, 10) : null })}
        style={inputStyle}
      />
    </Field>
  )

  const list = (key: ListKey, label: string, help?: React.ReactNode, placeholder?: string) => (
    <Field id={`sd-${key}`} label={label} help={help}>
      <textarea
        id={`sd-${key}`}
        value={lists[key]}
        onChange={(e) => setLists({ ...lists, [key]: e.target.value })}
        style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
        placeholder={placeholder}
      />
    </Field>
  )

  const toggleType = (type: OrgType) => {
    const next = form.orgTypes.includes(type)
      ? form.orgTypes.filter((t) => t !== type)
      : [...form.orgTypes, type]
    // Never leave it with nothing to say - an empty @type is not markup.
    set({ orgTypes: next.length ? next : ['Organization'] })
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Structured data</h1>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>

      <p style={{ ...helpStyle, marginBottom: '1rem', maxWidth: 720 }}>
        Tell search engines who is behind this site, once, and it goes out on every page - no dragging a block onto
        anything. Leave anything blank and it is simply left out. The page-builder block still exists for the odd page
        that needs to describe somebody else.
      </p>

      {!data.siteUrl && (
        <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
          <strong>No site address configured.</strong> Structured data needs to know where the site lives before it can
          publish anything, so nothing will go out until that is set.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1rem', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Card title="What goes out">
            <div>
              <Toggle
                checked={form.emitOrganization}
                onChange={(v) => set({ emitOrganization: v })}
                label="Publish the organisation details on every page"
                help="The record search engines use for a knowledge panel: name, logo, contact details, official profiles."
              />
              <Toggle
                checked={form.emitWebSite}
                onChange={(v) => set({ emitWebSite: v })}
                label="Publish the website details on every page"
                help="Names the site itself and ties it to the organisation above."
              />
              <Toggle
                checked={form.emitSearchAction}
                // Greyed rather than merely explained. The builder drops the
                // search box along with the website record it hangs off, so a
                // switch left on with the one above off did nothing at all and
                // said nothing about it.
                disabled={!form.emitWebSite}
                onChange={(v) => set({ emitSearchAction: v })}
                label="Offer a search box in search results"
                help="Lets Google put a search box for your site directly in its results. Needs the website details switched on."
              />
            </div>
            {form.emitOrganization && !form.emitWebSite && (
              // The commonest half-finished state on this screen, and an easy one
              // to leave behind: the organisation record goes out on its own, with
              // nothing naming the site or tying the two together, and the search
              // box below is switched off whatever it says.
              <div className="alert alert-info" style={{ marginTop: '0.75rem' }}>
                The organisation is being published but the website is not. The website record is
                what names the site, points back at the organisation and carries the search box -
                on its own, the organisation record is half an introduction.
              </div>
            )}
            {form.emitWebSite && form.emitSearchAction && text(
              'searchUrlTemplate',
              'Search address',
              <>Must contain <code>{'{search_term_string}'}</code> where the visitor&apos;s words go.</>,
              '/search?q={search_term_string}',
            )}
          </Card>

          <Card title="What kind of organisation is this?">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.375rem' }}>
              {ORG_TYPES.map((type) => (
                <label key={type} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.8125rem', color: 'var(--color-text)' }}>
                  <input type="checkbox" checked={form.orgTypes.includes(type)} onChange={() => toggleType(type)} />
                  {ORG_TYPE_LABELS[type]}
                </label>
              ))}
            </div>
            <p style={helpStyle}>
              Tick more than one where more than one is true - an online shop is both an organisation and an online
              shop, and saying so is how it qualifies for both sets of treatment in search results.
              {isLocal
                ? ' You have ticked a type with premises, so opening hours and a price range appear below.'
                : ' Opening hours and a price range only mean something on a type with premises, so they are hidden.'}
            </p>
          </Card>

          <Card title="Who you are">
            {text('name', 'Name', data.siteName ? `Blank uses the site name, “${data.siteName}”.` : 'Blank uses the site name.')}
            {text('alternateName', 'Also known as', 'The short form people actually type.')}
            {text('legalName', 'Registered legal name', 'Only if it differs from the trading name.')}
            <Field id="sd-description" label="Description">
              <textarea id="sd-description" value={form.description} onChange={(e) => set({ description: e.target.value })} style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} maxLength={1000} />
            </Field>
            {text('url', 'Home page', 'Blank uses this site. Set it only if the organisation lives at a different address.')}
            {text('foundingDate', 'Founded', 'Year, or a full date as 2026-07-10.', '2026-07-10')}
          </Card>

          <Card title="Logo and photograph">
            {text('logoUrl', 'Logo', 'A site path like /brand/logo.png is fine; it goes out as a full address either way.')}
            <div style={rowStyle}>
              {number('logoWidth', 'Logo width (px)')}
              {number('logoHeight', 'Logo height (px)')}
            </div>
            {text('logoCaption', 'Logo caption', 'What the logo says, for anything reading it out.')}
            {text('imageUrl', 'Photograph', 'A picture of the business. Falls back to the logo.')}
          </Card>

          <Card title="How to reach you">
            {text('email', 'Email')}
            {text('telephone', 'Phone', 'In full international form, so it works from anywhere.', '+44 20 8138 0512')}
            {text('streetAddress', 'Street address')}
            <div style={rowStyle}>
              {text('addressLocality', 'Town or city')}
              {text('addressRegion', 'County')}
            </div>
            <div style={rowStyle}>
              {text('postalCode', 'Postcode')}
              {text('addressCountry', 'Country', 'Two-letter code.', 'GB')}
            </div>
            {list('areaServed', 'Areas served (one per line)', 'Where you actually trade. Two-letter country codes or place names. Leave blank if that is everywhere.', 'GB')}
          </Card>

          <Card title="Contact point">
            <p style={{ ...helpStyle, margin: 0 }}>
              A named front door, separate from your own details above - the one search results can offer a caller.
              Needs an email or a phone number before it is published at all.
            </p>
            <Field id="sd-contactType" label="What is it for?">
              <select id="sd-contactType" value={form.contactType} onChange={(e) => set({ contactType: e.target.value })} style={inputStyle}>
                <option value="">Not stated</option>
                {CONTACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            {text('contactEmail', 'Email')}
            {text('contactTelephone', 'Phone', undefined, '+44 20 8138 0512')}
            {list('contactAreaServed', 'Areas served (one per line)', undefined, 'GB')}
            {list('contactAvailableLanguage', 'Languages (one per line)', 'Language tags, e.g. en-GB.', 'en-GB')}
          </Card>

          <Card title="Registration numbers">
            <div style={rowStyle}>
              {text('vatId', 'VAT number', undefined, 'GB525366781')}
              {text('taxId', 'Tax ID', 'Only if you have one distinct from the numbers below.')}
            </div>
            <div style={rowStyle}>
              {text('duns', 'D-U-N-S number', undefined, '234986302')}
              {text('iso6523Code', 'ISO 6523 code', 'Scheme and number, e.g. 0060:234986302.', '0060:234986302')}
            </div>
            <div style={rowStyle}>
              {text('identifierName', 'Other number - what it is', undefined, 'Companies House company number')}
              {text('identifierValue', 'Other number - the number', undefined, '17332661')}
            </div>
            <p style={helpStyle}>Both halves of the last pair are needed: a registration number nobody can name is a number nobody can use.</p>
          </Card>

          <Card title="Official profiles">
            {list(
              'sameAs',
              'Profile URLs (one per line)',
              data.fallbackSameAs.length
                ? `Anywhere that proves you are you - social pages, company registries. Leave blank and the ${data.fallbackSameAs.length} from Settings → SEO are used instead.`
                : 'Anywhere that proves you are you - social pages, company registries.',
              'https://find-and-update.company-information.service.gov.uk/company/17332661',
            )}
          </Card>

          <Card title="Returns">
            <Field
              id="sd-returnPolicyCategory"
              label="Do you accept returns?"
              help="Published as a returns policy on the organisation record. Assistants asked to recommend a supplier weigh up what happens when something is wrong, and this is the machine-readable answer. Leave it on “Not stated” and nothing goes out."
            >
              <select
                id="sd-returnPolicyCategory"
                value={form.returnPolicyCategory}
                onChange={(e) => set({ returnPolicyCategory: e.target.value as ReturnPolicyCategory | '' })}
                style={inputStyle}
              >
                <option value="">Not stated</option>
                {RETURN_POLICY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{RETURN_CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </Field>

            {form.returnPolicyCategory === 'MerchantReturnFiniteReturnWindow' && (
              <Field id="sd-returnDays" label="Days to return" help="Counted from delivery.">
                <input
                  id="sd-returnDays"
                  type="number"
                  min={1}
                  value={form.returnDays ?? ''}
                  onChange={(e) => set({ returnDays: e.target.value ? parseInt(e.target.value, 10) : null })}
                  style={inputStyle}
                  placeholder="30"
                />
              </Field>
            )}

            {form.returnPolicyCategory && form.returnPolicyCategory !== 'MerchantReturnNotPermitted' && (
              <>
                <Field id="sd-returnMethod" label="How does it come back?">
                  <select
                    id="sd-returnMethod"
                    value={form.returnMethod}
                    onChange={(e) => set({ returnMethod: e.target.value as ReturnMethod | '' })}
                    style={inputStyle}
                  >
                    <option value="">Not stated</option>
                    {RETURN_METHODS.map((m) => (
                      <option key={m} value={m}>{RETURN_METHOD_LABELS[m]}</option>
                    ))}
                  </select>
                </Field>
                <Field id="sd-returnFees" label="Who pays?">
                  <select
                    id="sd-returnFees"
                    value={form.returnFees}
                    onChange={(e) => set({ returnFees: e.target.value as ReturnFees | '' })}
                    style={inputStyle}
                  >
                    <option value="">Not stated</option>
                    {RETURN_FEES.map((f) => (
                      <option key={f} value={f}>{RETURN_FEES_LABELS[f]}</option>
                    ))}
                  </select>
                </Field>
                {form.returnFees && form.returnFees !== 'FreeReturn' && (
                  <div style={rowStyle}>
                    <Field id="sd-returnFeeAmount" label="How much?" help="Both boxes, or neither: a fee with no currency is a warning rather than a figure.">
                      <input
                        id="sd-returnFeeAmount"
                        type="number"
                        min={0}
                        step="0.01"
                        value={form.returnFeeAmount ?? ''}
                        onChange={(e) => set({ returnFeeAmount: e.target.value ? parseFloat(e.target.value) : null })}
                        style={inputStyle}
                        placeholder="4.99"
                      />
                    </Field>
                    {text('returnFeeCurrency', 'Currency', 'Three letters, e.g. GBP.', 'GBP')}
                  </div>
                )}
              </>
            )}

            {form.returnPolicyCategory && (
              <>
                {text('returnPolicyCountry', 'Where it applies', 'Two-letter country code. Blank uses the country in your address above.', 'GB')}
                {text('returnPolicyUrl', 'Policy page', 'The page a person can read it on.', '/returns-and-cancellations')}
              </>
            )}
          </Card>

          {isLocal && (
            <Card title="Premises">
              {list('openingHours', 'Opening hours (one per line)', 'Days then times, e.g. Mo-Fr 09:00-17:30.', 'Mo-Fr 09:00-17:30\nSa 10:00-16:00')}
              {text('priceRange', 'Price range', 'The rough bracket, as £ to ££££.', '££')}
            </Card>
          )}
        </div>

        <section className="card" style={{ padding: '1rem', position: 'sticky', top: '1rem' }}>
          <h2 className="card-title" style={{ marginBottom: '0.25rem' }}>What search engines will read</h2>
          <p style={{ ...helpStyle, marginBottom: '0.75rem' }}>
            Saved and live. Paste it into Google&apos;s Rich Results Test if you want a second opinion.
          </p>
          {data.jsonLd.length === 0 ? (
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
              Nothing published yet - switch something on above, fill in a name, and press Save.
            </p>
          ) : (
            <pre style={{
              margin: 0,
              padding: '0.75rem',
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              fontSize: '0.75rem',
              lineHeight: 1.5,
              color: 'var(--color-text)',
              overflowX: 'auto',
              maxHeight: '70vh',
            }}>
              {JSON.stringify(data.jsonLd, null, 2)}
            </pre>
          )}
        </section>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '1rem' }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save structured data'}</button>
        {saved && <span style={{ fontSize: '0.8125rem', color: 'var(--color-success)' }}>Saved</span>}
        {error && <span style={{ fontSize: '0.8125rem', color: 'var(--color-error)' }}>{error}</span>}
      </div>
    </div>
  )
}
