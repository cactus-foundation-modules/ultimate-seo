import { cache } from 'react'
import { prisma } from '@/lib/db/prisma'
import { observeAiRequest } from './ai/analytics'
import { getPageHead } from './ai/page-head'
import { getSeoSettings } from './settings'
import { buildSiteJsonLd } from './structured-data'

// Scanned by scripts/generate-module-router.mjs and rendered by the core public
// layout: the site-wide structured data and the meta tags that belong on every
// page rather than on one this module serves.

export type PublicHead = {
  jsonLd: object[]
  meta: Array<{ name?: string; property?: string; content: string }>
  links: Array<{ rel: string; href: string; type?: string; title?: string; hrefLang?: string }>
}

const EMPTY: PublicHead = { jsonLd: [], meta: [], links: [] }

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
  // Runs on every public page, which makes it the one place that sees an AI
  // crawler arrive. Costs an ordinary visitor two string comparisons and
  // nothing else; see lib/ai/analytics.ts.
  void observeAiRequest()

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

    const links: PublicHead['links'] = []
    // How a reader finds out this site keeps Markdown copies of itself. There
    // is no meta tag that can say it, and an agent that has not been told looks
    // for /llms.txt exactly once before giving up on the idea.
    if (settings.ai.llmsTxt) {
      links.push({
        rel: 'alternate',
        type: 'text/markdown',
        href: `${siteUrl}/llms.txt`,
        title: 'Markdown index of this site',
      })
    }

    // This page's own structured data and its twin link. Both are off unless
    // the owner has asked, because between them they put one database read on
    // the render of every public page - see lib/ai/page-head.ts.
    const page = await getPageHead(siteUrl, settings.ai)
    jsonLd.push(...page.jsonLd)
    links.push(...page.links)

    return { jsonLd, meta, links }
  } catch {
    // A settings table that is mid-migration, or a database having a moment,
    // must cost the page its structured data and nothing else.
    return EMPTY
  }
}
