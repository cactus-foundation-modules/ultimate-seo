// Structured data (JSON-LD) Puck block. Search engines read JSON-LD from the
// body just as happily as from the head, which is what makes this possible
// from a page-builder block at all.
//
// Both the editor and RSC paths render the exact same component (parity
// invariant): the block is purely props-driven, so there is nothing async to
// diverge on. resolveFields only decorates the editor sidebar.

export type StructuredDataBlockProps = {
  schemaType?: string
  // Organisation / LocalBusiness
  orgName?: string
  orgLogoUrl?: string
  orgSameAs?: string
  // LocalBusiness extras
  bizPhone?: string
  bizStreet?: string
  bizLocality?: string
  bizRegion?: string
  bizPostcode?: string
  bizCountry?: string
  bizOpeningHours?: string
  // WebSite
  siteName?: string
  siteUrl?: string
  // Custom
  customJson?: string
}

function lines(value: string | undefined): string[] {
  return (value ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
}

export function buildStructuredData(props: StructuredDataBlockProps): object | null {
  const type = props.schemaType ?? 'organization'

  if (type === 'custom') {
    try {
      const parsed = JSON.parse(props.customJson ?? '')
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
      return null
    }
  }

  if (type === 'website') {
    if (!props.siteName?.trim()) return null
    return {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: props.siteName.trim(),
      ...(props.siteUrl?.trim() ? { url: props.siteUrl.trim() } : {}),
    }
  }

  // organization / localBusiness share the base shape
  if (!props.orgName?.trim()) return null
  const sameAs = lines(props.orgSameAs)
  const base: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': type === 'localBusiness' ? 'LocalBusiness' : 'Organization',
    name: props.orgName.trim(),
    ...(props.orgLogoUrl?.trim() ? { logo: props.orgLogoUrl.trim() } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  }

  if (type === 'localBusiness') {
    if (props.bizPhone?.trim()) base.telephone = props.bizPhone.trim()
    const address: Record<string, string> = {}
    if (props.bizStreet?.trim()) address.streetAddress = props.bizStreet.trim()
    if (props.bizLocality?.trim()) address.addressLocality = props.bizLocality.trim()
    if (props.bizRegion?.trim()) address.addressRegion = props.bizRegion.trim()
    if (props.bizPostcode?.trim()) address.postalCode = props.bizPostcode.trim()
    if (props.bizCountry?.trim()) address.addressCountry = props.bizCountry.trim()
    if (Object.keys(address).length) base.address = { '@type': 'PostalAddress', ...address }
    const hours = lines(props.bizOpeningHours)
    if (hours.length) base.openingHours = hours
  }

  return base
}

/** Serialise for a <script> tag: escape `</` so content cannot close the tag early. */
export function jsonLdString(data: object): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

export function StructuredDataBlock(props: StructuredDataBlockProps) {
  const data = buildStructuredData(props)
  // Wrapper div keeps the block selectable in the editor canvas; zero height on
  // the live page. Identical markup in both paths.
  return (
    <div data-seo-structured-data style={{ height: 0, overflow: 'hidden' }} aria-hidden>
      {data && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />}
    </div>
  )
}

const ORG_FIELDS = {
  orgName: { type: 'text' as const, label: 'Organisation name' },
  orgLogoUrl: { type: 'text' as const, label: 'Logo URL' },
  orgSameAs: { type: 'textarea' as const, label: 'Official profile URLs (one per line)' },
}

export const structuredDataPuckComponent = {
  label: 'Structured data (SEO)',
  fields: {
    schemaType: {
      type: 'select' as const,
      label: 'What does this describe?',
      options: [
        { value: 'organization', label: 'Organisation' },
        { value: 'localBusiness', label: 'Local business' },
        { value: 'website', label: 'Website' },
        { value: 'custom', label: 'Custom JSON-LD' },
      ],
    },
    ...ORG_FIELDS,
    bizPhone: { type: 'text' as const, label: 'Phone' },
    bizStreet: { type: 'text' as const, label: 'Street address' },
    bizLocality: { type: 'text' as const, label: 'Town / city' },
    bizRegion: { type: 'text' as const, label: 'County / region' },
    bizPostcode: { type: 'text' as const, label: 'Postcode' },
    bizCountry: { type: 'text' as const, label: 'Country' },
    bizOpeningHours: { type: 'textarea' as const, label: 'Opening hours (schema.org format, one per line)' },
    siteName: { type: 'text' as const, label: 'Site name' },
    siteUrl: { type: 'text' as const, label: 'Site URL' },
    customJson: { type: 'textarea' as const, label: 'JSON-LD (advanced)' },
  },
  defaultProps: {
    schemaType: 'organization',
    orgName: '',
    orgLogoUrl: '',
    orgSameAs: '',
    bizPhone: '',
    bizStreet: '',
    bizLocality: '',
    bizRegion: '',
    bizPostcode: '',
    bizCountry: '',
    bizOpeningHours: '',
    siteName: '',
    siteUrl: '',
    customJson: '',
  },
  // Editor-only: pre-fill empty organisation fields from the module's saved
  // settings. The resolved values are stored in the block props, so the RSC
  // path renders the identical stored data (parity preserved).
  async resolveData(data: { props: StructuredDataBlockProps }) {
    const props = data.props
    const type = props.schemaType ?? 'organization'
    if ((type !== 'organization' && type !== 'localBusiness') || props.orgName?.trim()) return data
    try {
      const res = await fetch('/api/m/ultimate-seo/admin/settings')
      if (!res.ok) return data
      const settings = await res.json() as { organization?: { name?: string; logoUrl?: string; sameAs?: string[] } }
      const org = settings.organization
      if (!org?.name) return data
      return {
        ...data,
        props: {
          ...props,
          orgName: org.name,
          orgLogoUrl: props.orgLogoUrl?.trim() ? props.orgLogoUrl : (org.logoUrl ?? ''),
          orgSameAs: props.orgSameAs?.trim() ? props.orgSameAs : (org.sameAs ?? []).join('\n'),
        },
      }
    } catch {
      return data
    }
  },
  // Sidebar shows only the fields relevant to the chosen schema type.
  resolveFields(data: { props: StructuredDataBlockProps }, { fields }: { fields: Record<string, unknown> }) {
    const type = data.props.schemaType ?? 'organization'
    const pick = (keys: string[]) => Object.fromEntries(Object.entries(fields).filter(([k]) => keys.includes(k)))
    if (type === 'custom') return pick(['schemaType', 'customJson'])
    if (type === 'website') return pick(['schemaType', 'siteName', 'siteUrl'])
    if (type === 'localBusiness') {
      return pick(['schemaType', 'orgName', 'orgLogoUrl', 'orgSameAs', 'bizPhone', 'bizStreet', 'bizLocality', 'bizRegion', 'bizPostcode', 'bizCountry', 'bizOpeningHours'])
    }
    return pick(['schemaType', 'orgName', 'orgLogoUrl', 'orgSameAs'])
  },
  render: StructuredDataBlock,
}

export const structuredDataPuckRscComponent = {
  ...structuredDataPuckComponent,
  render: StructuredDataBlock,
}
