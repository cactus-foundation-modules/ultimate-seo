import { describe, expect, it } from 'vitest'
import {
  absoluteUrl,
  buildOrganizationJsonLd,
  buildSiteJsonLd,
  buildWebSiteJsonLd,
  organizationId,
} from '@/modules/ultimate-seo/lib/structured-data'
import { DEFAULT_STRUCTURED_DATA, type SeoStructuredData } from '@/modules/ultimate-seo/lib/types'

const ctx = { siteUrl: 'https://example.com', siteName: 'Example Ltd', sameAs: [] as string[] }

function profile(patch: Partial<SeoStructuredData> = {}): SeoStructuredData {
  return { ...DEFAULT_STRUCTURED_DATA, emitOrganization: true, name: 'Example Ltd', ...patch }
}

describe('absoluteUrl', () => {
  it('leaves an absolute URL alone', () => {
    expect(absoluteUrl('https://example.com', 'https://cdn.test/logo.png')).toBe('https://cdn.test/logo.png')
  })

  it('resolves a site-relative path against the site origin', () => {
    expect(absoluteUrl('https://example.com', '/uploads/logo.png')).toBe('https://example.com/uploads/logo.png')
  })

  it('returns null for blank input rather than the bare origin', () => {
    expect(absoluteUrl('https://example.com', '   ')).toBeNull()
  })
})

describe('buildOrganizationJsonLd', () => {
  it('emits nothing while the switch is off', () => {
    expect(buildOrganizationJsonLd(profile({ emitOrganization: false }), ctx)).toBeNull()
  })

  it('emits nothing when there is no name anywhere to use', () => {
    expect(buildOrganizationJsonLd(profile({ name: '' }), { ...ctx, siteName: '' })).toBeNull()
  })

  it('falls back to the site name when the profile has none', () => {
    expect(buildOrganizationJsonLd(profile({ name: '' }), ctx)?.name).toBe('Example Ltd')
  })

  it('anchors to a stable @id and defaults url to the site', () => {
    const data = buildOrganizationJsonLd(profile(), ctx)
    expect(data?.['@id']).toBe('https://example.com/#organization')
    // Trailing slash: this is the organisation's home page, and that is the
    // form every reference example uses.
    expect(data?.url).toBe('https://example.com/')
  })

  it('wraps the logo as an ImageObject with an absolute URL', () => {
    const data = buildOrganizationJsonLd(profile({ logoUrl: '/media/logo.png' }), ctx)
    expect(data?.logo).toEqual({
      '@type': 'ImageObject',
      url: 'https://example.com/media/logo.png',
      contentUrl: 'https://example.com/media/logo.png',
    })
  })

  it('builds a PostalAddress from whichever parts are filled in', () => {
    const data = buildOrganizationJsonLd(profile({ addressLocality: 'Leeds', postalCode: 'LS1 1AA' }), ctx)
    expect(data?.address).toEqual({ '@type': 'PostalAddress', addressLocality: 'Leeds', postalCode: 'LS1 1AA' })
  })

  it('omits the address entirely when no part is filled in', () => {
    expect(buildOrganizationJsonLd(profile(), ctx)).not.toHaveProperty('address')
  })

  it('drops opening hours and price range on a plain Organization', () => {
    const data = buildOrganizationJsonLd(profile({ openingHours: ['Mo-Fr 09:00-17:00'], priceRange: '££' }), ctx)
    expect(data).not.toHaveProperty('openingHours')
    expect(data).not.toHaveProperty('priceRange')
  })

  it('keeps them on a type that has a door', () => {
    const data = buildOrganizationJsonLd(
      profile({ orgTypes: ['Store'], openingHours: ['Mo-Fr 09:00-17:00'], priceRange: '££' }),
      ctx
    )
    expect(data?.openingHours).toEqual(['Mo-Fr 09:00-17:00'])
    expect(data?.priceRange).toBe('££')
  })

  it('keeps them when a premises type is one of several', () => {
    const data = buildOrganizationJsonLd(
      profile({ orgTypes: ['Organization', 'Store'], openingHours: ['Mo-Fr 09:00-17:00'] }),
      ctx
    )
    expect(data?.openingHours).toEqual(['Mo-Fr 09:00-17:00'])
  })

  it('emits a bare @type for one and an array for several', () => {
    expect(buildOrganizationJsonLd(profile(), ctx)?.['@type']).toBe('Organization')
    expect(buildOrganizationJsonLd(profile({ orgTypes: ['Organization', 'OnlineStore'] }), ctx)?.['@type'])
      .toEqual(['Organization', 'OnlineStore'])
  })

  it('falls back to the older settings profile list only when it has none of its own', () => {
    const fallback = { ...ctx, sameAs: ['https://x.com/example', 'https://x.com/example', ' '] }
    expect(buildOrganizationJsonLd(profile(), fallback)?.sameAs).toEqual(['https://x.com/example'])
    expect(buildOrganizationJsonLd(profile({ sameAs: ['https://own.example'] }), fallback)?.sameAs)
      .toEqual(['https://own.example'])
  })

  it('publishes the logo dimensions and caption, and mirrors url into contentUrl', () => {
    const data = buildOrganizationJsonLd(
      profile({ logoUrl: '/brand/logo.png', logoWidth: 1200, logoHeight: 271, logoCaption: 'Example Ltd' }),
      ctx
    )
    expect(data?.logo).toEqual({
      '@type': 'ImageObject',
      url: 'https://example.com/brand/logo.png',
      contentUrl: 'https://example.com/brand/logo.png',
      width: 1200,
      height: 271,
      caption: 'Example Ltd',
    })
  })

  it('emits a single areaServed as a bare string, several as an array', () => {
    expect(buildOrganizationJsonLd(profile({ areaServed: ['GB'] }), ctx)?.areaServed).toBe('GB')
    expect(buildOrganizationJsonLd(profile({ areaServed: ['GB', 'IE'] }), ctx)?.areaServed).toEqual(['GB', 'IE'])
  })

  it('needs both halves of the named identifier before publishing it', () => {
    expect(buildOrganizationJsonLd(profile({ identifierValue: '17332661' }), ctx)).not.toHaveProperty('identifier')
    expect(buildOrganizationJsonLd(profile({ identifierName: 'Companies House' }), ctx)).not.toHaveProperty('identifier')
    expect(buildOrganizationJsonLd(profile({ identifierName: 'Companies House', identifierValue: '17332661' }), ctx)?.identifier)
      .toEqual({ '@type': 'PropertyValue', name: 'Companies House', value: '17332661' })
  })

  it('will not publish a contact point nobody can actually contact', () => {
    expect(buildOrganizationJsonLd(profile({ contactType: 'customer service' }), ctx)).not.toHaveProperty('contactPoint')
    expect(buildOrganizationJsonLd(profile({ contactType: 'sales', contactEmail: 'hi@example.com' }), ctx)?.contactPoint)
      .toEqual({ '@type': 'ContactPoint', contactType: 'sales', email: 'hi@example.com' })
  })
})

describe('buildWebSiteJsonLd', () => {
  it('references the organisation by @id rather than restating it', () => {
    const data = buildWebSiteJsonLd(profile({ emitWebSite: true }), ctx, { hasOrganization: true })
    expect(data?.publisher).toEqual({ '@id': organizationId(ctx.siteUrl) })
  })

  it('leaves the publisher off when no organisation is being emitted', () => {
    const data = buildWebSiteJsonLd(profile({ emitWebSite: true }), ctx, { hasOrganization: false })
    expect(data).not.toHaveProperty('publisher')
  })

  it('leaves the placeholder braces intact in the search target', () => {
    const data = buildWebSiteJsonLd(
      profile({ emitWebSite: true, emitSearchAction: true, searchUrlTemplate: '/search?q={search_term_string}' }),
      ctx,
      { hasOrganization: true }
    )
    expect(data?.potentialAction).toMatchObject({
      target: { urlTemplate: 'https://example.com/search?q={search_term_string}' },
      'query-input': 'required name=search_term_string',
    })
  })

  it('omits the search action when the template has no placeholder to fill', () => {
    const data = buildWebSiteJsonLd(
      profile({ emitWebSite: true, emitSearchAction: true, searchUrlTemplate: '/search' }),
      ctx,
      { hasOrganization: true }
    )
    expect(data).not.toHaveProperty('potentialAction')
  })
})

describe('buildSiteJsonLd', () => {
  it('returns nothing at all while both switches are off', () => {
    expect(buildSiteJsonLd(DEFAULT_STRUCTURED_DATA, ctx)).toEqual([])
  })

  it('returns the organisation first, then the website', () => {
    const blocks = buildSiteJsonLd(profile({ emitWebSite: true }), ctx)
    expect(blocks.map((b) => b['@type'])).toEqual(['Organization', 'WebSite'])
  })
})

// The reference record this screen was built to be able to produce, field for
// field. Its value is not that these particular values are interesting - it is
// that every property in a real, hand-written organisation record has somewhere
// to come from, so "you can always paste custom JSON" stops being the answer.
describe('a complete hand-written record, rebuilt from fields alone', () => {
  const deskwell: SeoStructuredData = {
    ...DEFAULT_STRUCTURED_DATA,
    emitOrganization: true,
    orgTypes: ['Organization', 'OnlineStore'],
    name: 'Deskwell Office Furniture',
    alternateName: 'Deskwell',
    legalName: 'Deskwell Limited',
    logoUrl: 'https://deskwell.co.uk/brand/deskwell-logo-wide.png',
    logoWidth: 1200,
    logoHeight: 271,
    logoCaption: 'Deskwell Office Furniture',
    description:
      'Office furniture for UK businesses, sold online at one price for every buyer. Full specifications and honest pricing on every product page, shipped direct from the manufacturer. No sales calls.',
    email: 'hi@deskwell.co.uk',
    telephone: '+44 20 8138 0512',
    foundingDate: '2026-07-10',
    vatId: 'GB525366781',
    iso6523Code: '0060:234986302',
    duns: '234986302',
    identifierName: 'Companies House company number',
    identifierValue: '17332661',
    streetAddress: '22 Blackwall Basin Moorings, 1 Myers Walk, Canary Wharf',
    addressLocality: 'London',
    postalCode: 'E14 5GT',
    addressCountry: 'GB',
    areaServed: ['GB'],
    contactType: 'customer service',
    contactEmail: 'hi@deskwell.co.uk',
    contactTelephone: '+44 20 8138 0512',
    contactAreaServed: ['GB'],
    contactAvailableLanguage: ['en-GB'],
    sameAs: ['https://find-and-update.company-information.service.gov.uk/company/17332661'],
  }

  it('produces the record exactly, with nothing left over', () => {
    const data = buildOrganizationJsonLd(deskwell, {
      siteUrl: 'https://deskwell.co.uk',
      siteName: 'Deskwell',
      sameAs: [],
    })

    expect(data).toEqual({
      '@context': 'https://schema.org',
      '@type': ['Organization', 'OnlineStore'],
      '@id': 'https://deskwell.co.uk/#organization',
      name: 'Deskwell Office Furniture',
      alternateName: 'Deskwell',
      legalName: 'Deskwell Limited',
      url: 'https://deskwell.co.uk/',
      logo: {
        '@type': 'ImageObject',
        url: 'https://deskwell.co.uk/brand/deskwell-logo-wide.png',
        contentUrl: 'https://deskwell.co.uk/brand/deskwell-logo-wide.png',
        width: 1200,
        height: 271,
        caption: 'Deskwell Office Furniture',
      },
      image: 'https://deskwell.co.uk/brand/deskwell-logo-wide.png',
      description:
        'Office furniture for UK businesses, sold online at one price for every buyer. Full specifications and honest pricing on every product page, shipped direct from the manufacturer. No sales calls.',
      email: 'hi@deskwell.co.uk',
      telephone: '+44 20 8138 0512',
      foundingDate: '2026-07-10',
      vatID: 'GB525366781',
      iso6523Code: '0060:234986302',
      duns: '234986302',
      identifier: {
        '@type': 'PropertyValue',
        name: 'Companies House company number',
        value: '17332661',
      },
      address: {
        '@type': 'PostalAddress',
        streetAddress: '22 Blackwall Basin Moorings, 1 Myers Walk, Canary Wharf',
        addressLocality: 'London',
        postalCode: 'E14 5GT',
        addressCountry: 'GB',
      },
      areaServed: 'GB',
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer service',
        email: 'hi@deskwell.co.uk',
        telephone: '+44 20 8138 0512',
        areaServed: 'GB',
        availableLanguage: 'en-GB',
      },
      sameAs: ['https://find-and-update.company-information.service.gov.uk/company/17332661'],
    })
  })
})
