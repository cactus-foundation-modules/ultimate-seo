// The structured data a page publishes about itself, built from stored facts.
//
// Built here rather than stored finished, because every URL in it is absolute -
// @id, url, image, every breadcrumb step - and a hostname baked into twenty
// thousand rows is a hostname that has to be rebuilt out of them. See
// migrations/004_page_structured_data.sql.
//
// What is NOT here matters as much as what is. The shop already publishes the
// `Product` block on a product page, with the tax adjustment applied and the
// prices withheld when the shop is set to hide them. A second Product block
// from this module would be a duplicate at best and a contradiction at worst -
// two different prices for one item is precisely what gets a Merchant Center
// account suspended. So a product gets its breadcrumbs from here and its
// Product from the shop, which is the half nobody was publishing.

import type { EntityType } from '../types'

export type BreadcrumbStep = { name: string; path: string }

export type PageFacts = {
  kind: EntityType
  title: string
  description: string | null
  /** Home first, this page last. Paths have no leading slash; '' is the home page. */
  breadcrumb: BreadcrumbStep[]
  /** Absolute already (a media URL) or a site path. Either is understood. */
  image?: string | null
  publishedAt?: string | null
  updatedAt?: string | null
  author?: string | null
  /** What a category, collection or filter page lists. */
  items?: BreadcrumbStep[]
  telephone?: string | null
  email?: string | null
  address?: string | null
  website?: string | null
}

function absolute(siteUrl: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  const path = pathOrUrl.replace(/^\/+/, '')
  return path ? `${siteUrl}/${path}` : siteUrl
}

/** An ISO date, or undefined for anything unparseable - never an "Invalid Date". */
function isoDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const t = Date.parse(value)
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined
}

function breadcrumbList(siteUrl: string, steps: BreadcrumbStep[]): Record<string, unknown> | null {
  // One step is the page itself, which is not a trail. Two is Home > This, which
  // is - it tells a search engine the page sits directly under the site root.
  if (steps.length < 2) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: steps.map((step, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: step.name,
      item: absolute(siteUrl, step.path),
    })),
  }
}

function selfUrl(siteUrl: string, facts: PageFacts): string {
  const last = facts.breadcrumb[facts.breadcrumb.length - 1]
  return absolute(siteUrl, last ? last.path : '')
}

function blogPosting(siteUrl: string, facts: PageFacts): Record<string, unknown> {
  const url = selfUrl(siteUrl, facts)
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    '@id': url,
    mainEntityOfPage: url,
    headline: facts.title,
    ...(facts.description ? { description: facts.description } : {}),
    ...(facts.image ? { image: absolute(siteUrl, facts.image) } : {}),
    ...(facts.author ? { author: { '@type': 'Person', name: facts.author } } : {}),
    ...(isoDate(facts.publishedAt) ? { datePublished: isoDate(facts.publishedAt) } : {}),
    // Falls back to the publication date rather than being left out: a post
    // with no modification date reads as one that may never have been checked.
    ...(isoDate(facts.updatedAt) || isoDate(facts.publishedAt)
      ? { dateModified: isoDate(facts.updatedAt) ?? isoDate(facts.publishedAt) }
      : {}),
  }
}

// Capped. An ItemList is a summary of what the page shows, and a category with
// eight hundred products in it would otherwise put eight hundred entries in the
// document head of a page that already renders them.
const MAX_LIST_ITEMS = 30

function collectionPage(siteUrl: string, facts: PageFacts): Record<string, unknown> {
  const url = selfUrl(siteUrl, facts)
  const items = (facts.items ?? []).slice(0, MAX_LIST_ITEMS)
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': url,
    url,
    name: facts.title,
    ...(facts.description ? { description: facts.description } : {}),
    ...(facts.image ? { image: absolute(siteUrl, facts.image) } : {}),
    ...(items.length
      ? {
        mainEntity: {
          '@type': 'ItemList',
          numberOfItems: items.length,
          itemListElement: items.map((item, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: item.name,
            url: absolute(siteUrl, item.path),
          })),
        },
      }
      : {}),
  }
}

function localBusiness(siteUrl: string, facts: PageFacts): Record<string, unknown> {
  const url = selfUrl(siteUrl, facts)
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': url,
    url,
    name: facts.title,
    ...(facts.description ? { description: facts.description } : {}),
    ...(facts.image ? { image: absolute(siteUrl, facts.image) } : {}),
    ...(facts.telephone ? { telephone: facts.telephone } : {}),
    ...(facts.email ? { email: facts.email } : {}),
    ...(facts.address ? { address: { '@type': 'PostalAddress', streetAddress: facts.address } } : {}),
    ...(facts.website ? { sameAs: [facts.website] } : {}),
  }
}

/**
 * Everything this page should publish about itself, in document order.
 *
 * Empty is a perfectly ordinary answer: a page at the site root with no trail
 * above it and no type worth declaring has nothing to say that the site-wide
 * Organization and WebSite blocks have not already said.
 */
export function buildPageJsonLd(siteUrl: string, facts: PageFacts): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []

  const crumbs = breadcrumbList(siteUrl, facts.breadcrumb)
  if (crumbs) out.push(crumbs)

  switch (facts.kind) {
    case 'gazette-post':
      out.push(blogPosting(siteUrl, facts))
      break
    case 'shop-category':
    case 'shop-collection':
    case 'filter-collection':
      out.push(collectionPage(siteUrl, facts))
      break
    case 'directory-entry':
      out.push(localBusiness(siteUrl, facts))
      break
    // A product's Product block is the shop's to publish, and it already does.
    // A core page is a page: WebPage adds nothing a search engine did not
    // already work out from the page itself.
    case 'shop-product':
    case 'core-page':
      break
  }

  return out
}

/** Where this page's Markdown twin lives. */
export function markdownTwinUrl(siteUrl: string, path: string): string {
  return `${siteUrl}/${path}.md`
}
