import { cache } from 'react'
import { prisma } from '@/lib/db/prisma'
import { getSeoSettings } from './settings'
import { buildSiteJsonLd } from './structured-data'

// Scanned by scripts/generate-module-router.mjs and rendered by the core public
// layout: the site-wide structured data and the meta tags that belong on every
// page rather than on one this module serves.

export type PublicHead = {
  jsonLd: object[]
  meta: Array<{ name?: string; property?: string; content: string }>
}

const EMPTY: PublicHead = { jsonLd: [], meta: [] }

// One query per request, not one per call. This runs on the render path of
// every public page on the site, so it gets the same cache() treatment core
// gives its own config reads - a page that costs an extra round trip for a tag
// nobody can see is a page that got slower for its SEO score.
const readSettings = cache(async () => {
  const [settings, config] = await Promise.all([
    getSeoSettings(),
    prisma.siteConfig
      .findUnique({ where: { id: 'singleton' }, select: { siteName: true } })
      .catch(() => null),
  ])
  return { settings, siteName: config?.siteName ?? '' }
})

export async function getPublicHead(siteUrl: string): Promise<PublicHead> {
  try {
    const { settings, siteName } = await readSettings()
    const jsonLd = buildSiteJsonLd(settings.structuredData, {
      siteUrl,
      siteName,
      sameAs: settings.organization.sameAs,
    })

    const meta: PublicHead['meta'] = []
    // The handle has been stored, validated and rendered in the settings form
    // since the module shipped, and read by precisely nothing. This is the tag
    // it was always for: it credits the account when somebody shares a page.
    const handle = settings.social.twitterHandle.trim()
    if (handle) {
      meta.push({ name: 'twitter:site', content: handle.startsWith('@') ? handle : `@${handle}` })
    }

    return { jsonLd, meta }
  } catch {
    // A settings table that is mid-migration, or a database having a moment,
    // must cost the page its structured data and nothing else.
    return EMPTY
  }
}
