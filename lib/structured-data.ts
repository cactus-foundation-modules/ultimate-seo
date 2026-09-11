// Site-wide structured data: the Organization / LocalBusiness and WebSite
// blocks emitted on every public page from the saved profile.
//
// Pure functions - no DB, no fetch, no environment - so the whole thing is unit
// testable and the admin preview and the live page are built by the same code
// rather than by two renderings that agree until one of them is edited.
//
// This is deliberately NOT the page-builder block. That block still exists and
// still wins where it is placed: it is the per-page override for a page that
// describes something other than the site's owner. This is the "set it once and
// it is on every page" half, which is what search engines actually want for an
// organisation - one consistent record, anchored to a stable @id, not a
// different one on each page an editor remembered to drag the block onto.

import { LOCAL_ORG_TYPES, type SeoStructuredData } from './types'

export type StructuredDataContext = {
  /** The site's own origin, no trailing slash. */
  siteUrl: string
  /** Fallback name when the profile has none - the site's own. */
  siteName: string
  /** Profile URLs from the older Settings → SEO list, used when the profile has none of its own. */
  sameAs: string[]
}

/** Stable anchors so every block can point at the same record rather than repeat it. */
export function organizationId(siteUrl: string): string {
  return `${siteUrl}/#organization`
}
export function webSiteId(siteUrl: string): string {
  return `${siteUrl}/#website`
}

/**
 * Absolute form of a URL that may have been entered either way. A logo stored
 * as `/uploads/logo.png` is correct in an <img> and useless in JSON-LD, which
 * is consumed off-site by something that has no idea what host it came from.
 * Returns null for anything that will not resolve, so a blank field and a typo
 * both end as an omitted property rather than a broken one.
 */
export function absoluteUrl(siteUrl: string, value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed, `${siteUrl}/`).toString()
  } catch {
    return null
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))]
}

function buildAddress(sd: SeoStructuredData): Record<string, string> | null {
  const address: Record<string, string> = {}
  if (sd.streetAddress.trim()) address.streetAddress = sd.streetAddress.trim()
  if (sd.addressLocality.trim()) address.addressLocality = sd.addressLocality.trim()
  if (sd.addressRegion.trim()) address.addressRegion = sd.addressRegion.trim()
  if (sd.postalCode.trim()) address.postalCode = sd.postalCode.trim()
  if (sd.addressCountry.trim()) address.addressCountry = sd.addressCountry.trim()
  return Object.keys(address).length ? { '@type': 'PostalAddress', ...address } : null
}

/**
 * schema.org properties that accept one value or many take a bare value when
 * there is one. An array of one is not wrong, but every published example and
 * every validator output shows the bare form, and matching what an owner will
 * see when they check their markup against a reference is worth the four lines.
 */
function oneOrMany(values: string[]): string | string[] | null {
  const first = values[0]
  if (first === undefined) return null
  return values.length === 1 ? first : values
}

function buildLogo(sd: SeoStructuredData, siteUrl: string): Record<string, unknown> | null {
  const url = absoluteUrl(siteUrl, sd.logoUrl)
  if (!url) return null
  return {
    '@type': 'ImageObject',
    url,
    // Consumers split over which of the two they read, and for a logo they are
    // always the same file, so both are published rather than making the owner
    // fill the same address in twice.
    contentUrl: url,
    ...(sd.logoWidth ? { width: sd.logoWidth } : {}),
    ...(sd.logoHeight ? { height: sd.logoHeight } : {}),
    ...(sd.logoCaption.trim() ? { caption: sd.logoCaption.trim() } : {}),
  }
}

function buildContactPoint(sd: SeoStructuredData): Record<string, unknown> | null {
  const contactType = sd.contactType.trim()
  const email = sd.contactEmail.trim()
  const telephone = sd.contactTelephone.trim()
  const areaServed = oneOrMany(sd.contactAreaServed)
  const availableLanguage = oneOrMany(sd.contactAvailableLanguage)
  // A ContactPoint carrying only a contactType says nothing anybody can act on.
  if (!email && !telephone) return null
  return {
    '@type': 'ContactPoint',
    ...(contactType ? { contactType } : {}),
    ...(email ? { email } : {}),
    ...(telephone ? { telephone } : {}),
    ...(areaServed ? { areaServed } : {}),
    ...(availableLanguage ? { availableLanguage } : {}),
  }
}

/**
 * The return policy, as a MerchantReturnPolicy hung off the organisation.
 *
 * Null when the owner has not said, which is not the same as "no returns" -
 * schema.org has a category for that and it is not this function's to assume.
 *
 * Why on the Organization rather than on each offer: it is one policy, the shop
 * already publishes its own Product blocks, and a policy restated on twenty
 * thousand offers is twenty thousand places for it to fall out of step with the
 * page a customer actually reads.
 */
export function buildReturnPolicyJsonLd(
  sd: SeoStructuredData,
  ctx: StructuredDataContext
): Record<string, unknown> | null {
  if (!sd.returnPolicyCategory) return null

  const country = sd.returnPolicyCountry.trim() || sd.addressCountry.trim()
  const data: Record<string, unknown> = {
    '@type': 'MerchantReturnPolicy',
    returnPolicyCategory: `https://schema.org/${sd.returnPolicyCategory}`,
  }
  if (country) data.applicableCountry = country

  // Only meaningful on a finite window. On "unlimited" or "not permitted" it is
  // a contradiction, and a validator reads a contradiction as a reason to
  // ignore the whole block rather than the half that disagreed.
  if (sd.returnPolicyCategory === 'MerchantReturnFiniteReturnWindow' && sd.returnDays !== null) {
    data.merchantReturnDays = sd.returnDays
  }

  if (sd.returnPolicyCategory !== 'MerchantReturnNotPermitted') {
    if (sd.returnMethod) data.returnMethod = `https://schema.org/${sd.returnMethod}`
    if (sd.returnFees) {
      data.returnFees = `https://schema.org/${sd.returnFees}`
      // A fee with no figure is a warning to the buyer and a warning in every
      // validator. Published only when both halves are there.
      const currency = sd.returnFeeCurrency.trim().toUpperCase()
      if (sd.returnFees !== 'FreeReturn' && sd.returnFeeAmount !== null && currency) {
        data.returnShippingFeesAmount = {
          '@type': 'MonetaryAmount',
          value: sd.returnFeeAmount,
          currency,
        }
      }
    }
  }

  const url = sd.returnPolicyUrl.trim() ? absoluteUrl(ctx.siteUrl, sd.returnPolicyUrl) : null
  if (url) data.merchantReturnLink = url

  return data
}

/**
 * The Organization (or LocalBusiness family) record. Returns null when there is
 * not enough to say - a nameless organisation is not markup, it is noise, and
 * markup that says nothing is scored accordingly.
 */
export function buildOrganizationJsonLd(
  sd: SeoStructuredData,
  ctx: StructuredDataContext
): Record<string, unknown> | null {
  if (!sd.emitOrganization) return null
  const name = sd.name.trim() || ctx.siteName.trim()
  if (!name) return null

  // Trailing slash on the default: this is the site's home page, and that is the
  // form every reference example uses for an organisation's own url.
  const url = absoluteUrl(ctx.siteUrl, sd.url) ?? `${ctx.siteUrl}/`
  const logo = buildLogo(sd, ctx.siteUrl)
  const image = absoluteUrl(ctx.siteUrl, sd.imageUrl) ?? (logo?.url as string | undefined)
  // The profile's own list wins; the older Settings → SEO list is the fallback,
  // so an install that filled that one in years ago keeps working untouched.
  const sameAs = dedupe(sd.sameAs.length ? sd.sameAs : ctx.sameAs)
  const address = buildAddress(sd)
  const contactPoint = buildContactPoint(sd)
  const areaServed = oneOrMany(sd.areaServed)
  const isLocal = sd.orgTypes.some((t) => LOCAL_ORG_TYPES.has(t))

  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    // A bare string for one type, an array for several - both are valid, and the
    // single-element array reads as a mistake to anyone checking the markup.
    '@type': sd.orgTypes.length === 1 ? sd.orgTypes[0] : sd.orgTypes,
    '@id': organizationId(ctx.siteUrl),
    name,
  }

  if (sd.alternateName.trim()) data.alternateName = sd.alternateName.trim()
  if (sd.legalName.trim()) data.legalName = sd.legalName.trim()
  data.url = url
  // logo is an ImageObject rather than a bare string: Google's own guidance
  // asks for one, and a bare string is the difference between a logo that shows
  // up beside the site in a knowledge panel and one that is quietly ignored.
  if (logo) data.logo = logo
  if (image) data.image = image
  if (sd.description.trim()) data.description = sd.description.trim()
  if (sd.email.trim()) data.email = sd.email.trim()
  if (sd.telephone.trim()) data.telephone = sd.telephone.trim()
  if (sd.foundingDate.trim()) data.foundingDate = sd.foundingDate.trim()
  if (sd.vatId.trim()) data.vatID = sd.vatId.trim()
  if (sd.taxId.trim()) data.taxID = sd.taxId.trim()
  if (sd.iso6523Code.trim()) data.iso6523Code = sd.iso6523Code.trim()
  if (sd.duns.trim()) data.duns = sd.duns.trim()
  // A registration number nobody can name is a number nobody can use, so both
  // halves are required before this goes out.
  if (sd.identifierName.trim() && sd.identifierValue.trim()) {
    data.identifier = {
      '@type': 'PropertyValue',
      name: sd.identifierName.trim(),
      value: sd.identifierValue.trim(),
    }
  }
  if (address) data.address = address
  if (areaServed) data.areaServed = areaServed
  const returnPolicy = buildReturnPolicyJsonLd(sd, ctx)
  if (returnPolicy) data.hasMerchantReturnPolicy = returnPolicy
  if (contactPoint) data.contactPoint = contactPoint
  if (sameAs.length) data.sameAs = sameAs

  // Opening hours and a price range on a plain Organization are ignored at best
  // and a structured-data warning at worst - they only mean something on a type
  // that has a door and a till.
  if (isLocal) {
    if (sd.openingHours.length) data.openingHours = sd.openingHours
    if (sd.priceRange.trim()) data.priceRange = sd.priceRange.trim()
  }

  return data
}

/** True when the template can actually carry a query the search box fills in. */
export function isValidSearchTemplate(template: string): boolean {
  return template.includes('{search_term_string}')
}

/**
 * The WebSite record, with the sitelinks search box when the site has a search
 * page to point it at. `publisher` references the organisation by @id rather
 * than restating it, which is what makes the two blocks one graph instead of
 * two unrelated claims.
 */
export function buildWebSiteJsonLd(
  sd: SeoStructuredData,
  ctx: StructuredDataContext,
  { hasOrganization }: { hasOrganization: boolean }
): Record<string, unknown> | null {
  if (!sd.emitWebSite) return null
  const name = sd.name.trim() || ctx.siteName.trim()
  if (!name) return null

  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': webSiteId(ctx.siteUrl),
    name,
    url: `${ctx.siteUrl}/`,
  }

  if (hasOrganization) data.publisher = { '@id': organizationId(ctx.siteUrl) }

  const template = sd.searchUrlTemplate.trim()
  if (sd.emitSearchAction && isValidSearchTemplate(template)) {
    // The target is built by hand rather than through absoluteUrl: the braces
    // in the placeholder are not valid in a URL, so anything that parses the
    // string would percent-encode them and hand search engines a search box
    // that queries for the literal text "%7Bsearch_term_string%7D".
    const path = template.startsWith('/') ? template : `/${template}`
    data.potentialAction = {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${ctx.siteUrl}${path}`,
      },
      'query-input': 'required name=search_term_string',
    }
  }

  return data
}

/** Everything this module contributes to every public page, in emission order. */
export function buildSiteJsonLd(sd: SeoStructuredData, ctx: StructuredDataContext): Record<string, unknown>[] {
  const organization = buildOrganizationJsonLd(sd, ctx)
  const webSite = buildWebSiteJsonLd(sd, ctx, { hasOrganization: !!organization })
  return [organization, webSite].filter((d): d is Record<string, unknown> => d !== null)
}
