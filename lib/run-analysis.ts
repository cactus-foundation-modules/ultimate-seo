// Loads a single entity's full content, runs the analyser, persists the result.

import { prisma } from '@/lib/db/prisma'
import { analyzePage } from './analyze'
import { extractContent, type ExtractedContent } from './content'
import { upsertPageMeta } from './db'
import { getInventory } from './inventory'
import { getSeoSettings } from './settings'
import type { AnalysisResult, EntityType } from './types'

type EntityDetail = {
  title: string
  slug: string
  metaDescription: string | null
  hasOgImage: boolean
  isPublished: boolean
  content: ExtractedContent
}

async function loadEntity(entityType: EntityType, entityId: string): Promise<EntityDetail | null> {
  if (entityType === 'core-page') {
    const page = await prisma.infoPage.findUnique({
      where: { id: entityId },
      select: { title: true, slug: true, metaDescription: true, ogImageId: true, status: true, builderData: true, publishedData: true },
    })
    if (!page) return null
    const data = page.status === 'published' && page.publishedData ? page.publishedData : page.builderData
    return {
      title: page.title,
      slug: page.slug,
      metaDescription: page.metaDescription,
      hasOgImage: !!page.ogImageId,
      isPublished: page.status === 'published',
      content: extractContent(data),
    }
  }

  if (entityType === 'gazette-post') {
    const rows = await prisma.$queryRaw<Array<{
      title: string; slug: string; status: string; seo_title: string | null
      seo_description: string | null; excerpt: string | null; featured_image_id: string | null
      builder_data: unknown
    }>>`
      SELECT "title", "slug", "status", "seo_title", "seo_description", "excerpt", "featured_image_id", "builder_data"
      FROM "gz_posts" WHERE "id" = ${entityId}
    `
    const p = rows[0]
    if (!p) return null
    return {
      title: p.seo_title || p.title,
      slug: p.slug,
      metaDescription: p.seo_description || p.excerpt,
      hasOgImage: !!p.featured_image_id,
      isPublished: p.status === 'PUBLISHED',
      content: extractContent(p.builder_data),
    }
  }

  if (entityType === 'shop-product') {
    const rows = await prisma.$queryRaw<Array<{
      name: string; slug: string; status: string; meta_title: string | null
      meta_description: string | null; short_description: string | null
      description: string | null; og_image_id: string | null
    }>>`
      SELECT "name", "slug", "status", "meta_title", "meta_description", "short_description", "description", "og_image_id"
      FROM "shp_products" WHERE "id" = ${entityId}
    `
    const p = rows[0]
    if (!p) return null
    // Product description is an HTML string; wrap it in a synthetic Puck item so
    // the shared extractor handles headings/links/images uniformly.
    const content = extractContent({ content: [{ type: 'RichText', props: { html: p.description ?? p.short_description ?? '' } }] })
    return {
      title: p.meta_title || p.name,
      slug: p.slug,
      metaDescription: p.meta_description || p.short_description,
      hasOgImage: !!p.og_image_id,
      isPublished: p.status === 'ACTIVE',
      content,
    }
  }

  // directory-entry
  const rows = await prisma.$queryRaw<Array<{
    name: string; slug: string; status: string; short_description: string | null; description: string | null
  }>>`
    SELECT "name", "slug", "status", "short_description", "description"
    FROM "dir_entries" WHERE "id" = ${entityId}
  `
  const e = rows[0]
  if (!e) return null
  return {
    title: e.name,
    slug: e.slug,
    metaDescription: e.short_description,
    hasOgImage: false,
    isPublished: e.status.toUpperCase() === 'PUBLISHED' || e.status.toLowerCase() === 'active',
    content: extractContent({ content: [{ type: 'RichText', props: { html: e.description ?? '' } }] }),
  }
}

export async function runAnalysisFor(
  entityType: EntityType,
  entityId: string,
  focusKeyword: string | null,
): Promise<AnalysisResult | null> {
  const [entity, settings, inventory] = await Promise.all([
    loadEntity(entityType, entityId),
    getSeoSettings(),
    getInventory(),
  ])
  if (!entity) return null

  const others = inventory.filter((i) => !(i.entityType === entityType && i.entityId === entityId))
  const result = analyzePage({
    title: entity.title,
    slug: entity.slug,
    metaDescription: entity.metaDescription,
    hasOgImage: entity.hasOgImage,
    focusKeyword,
    content: entity.content,
    targets: settings.targets,
    otherTitles: others.map((o) => o.title),
    otherDescriptions: others.map((o) => o.metaDescription ?? '').filter(Boolean),
    isPublished: entity.isPublished,
  })

  await upsertPageMeta({ entityType, entityId, focusKeyword, score: result.score, checks: result.checks })
  return result
}

/**
 * Suggest a meta description from the page's own copy: first ~155 characters,
 * cut at a word boundary. Returns null when there is not enough content.
 */
export async function suggestDescription(entityType: EntityType, entityId: string): Promise<string | null> {
  const entity = await loadEntity(entityType, entityId)
  if (!entity || entity.content.wordCount < 10) return null
  const text = entity.content.text
  if (text.length <= 160) return text
  const cut = text.slice(0, 156)
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`
}
