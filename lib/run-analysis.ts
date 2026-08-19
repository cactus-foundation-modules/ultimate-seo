// Loads entity content, runs the analyser, persists the result.
// Loaders work in batches so the bulk sweep costs one query per content type
// rather than one per page; the single-page path is the batch of one.

import { prisma } from '@/lib/db/prisma'
import { analyzePage } from './analyze'
import { extractContent, type ExtractedContent } from './content'
import { upsertPageMeta } from './db'
import { getInventory } from './inventory'
import { getSeoSettings } from './settings'
import type { AnalysisResult, EntityType } from './types'

export type EntityDetail = {
  title: string
  slug: string
  metaDescription: string | null
  hasOgImage: boolean
  isPublished: boolean
  content: ExtractedContent
  /** See AnalysisInput.titleIsH1 - true for the module content types whose own
   * template prints the title as the page's H1. */
  titleIsH1?: boolean
}

async function loadCorePages(ids: string[]): Promise<Map<string, EntityDetail>> {
  const pages = await prisma.infoPage.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true, slug: true, metaDescription: true, ogImageId: true, status: true, builderData: true, publishedData: true },
  })
  const out = new Map<string, EntityDetail>()
  for (const page of pages) {
    const data = page.status === 'published' && page.publishedData ? page.publishedData : page.builderData
    out.set(page.id, {
      title: page.title,
      slug: page.slug,
      metaDescription: page.metaDescription,
      hasOgImage: !!page.ogImageId,
      isPublished: page.status === 'published',
      content: extractContent(data),
    })
  }
  return out
}

async function loadGazettePosts(ids: string[]): Promise<Map<string, EntityDetail>> {
  const rows = await prisma.$queryRaw<Array<{
    id: string; title: string; slug: string; status: string; seo_title: string | null
    seo_description: string | null; excerpt: string | null; featured_image_id: string | null
    builder_data: unknown
  }>>`
    SELECT "id", "title", "slug", "status", "seo_title", "seo_description", "excerpt", "featured_image_id", "builder_data"
    FROM "gz_posts" WHERE "id" = ANY(${ids}::text[])
  `
  const out = new Map<string, EntityDetail>()
  for (const p of rows) {
    out.set(p.id, {
      title: p.seo_title || p.title,
      slug: p.slug,
      metaDescription: p.seo_description || p.excerpt,
      hasOgImage: !!p.featured_image_id,
      isPublished: p.status === 'PUBLISHED',
      content: extractContent(p.builder_data),
      // The post template prints the title as the page's H1.
      titleIsH1: true,
    })
  }
  return out
}

async function loadShopProducts(ids: string[]): Promise<Map<string, EntityDetail>> {
  const rows = await prisma.$queryRaw<Array<{
    id: string; name: string; slug: string; status: string; meta_title: string | null
    meta_description: string | null; short_description: string | null
    description: string | null; og_image_id: string | null; photo_count: bigint
  }>>`
    SELECT p."id", p."name", p."slug", p."status", p."meta_title", p."meta_description",
           p."short_description", p."description", p."og_image_id",
           (SELECT COUNT(*) FROM "shp_product_media" m
             WHERE m."product_id" = p."id" AND m."type" <> 'VIDEO_URL') AS photo_count
    FROM "shp_products" p WHERE p."id" = ANY(${ids}::text[])
  `
  const out = new Map<string, EntityDetail>()
  for (const p of rows) {
    // Product description is an HTML string; wrap it in a synthetic Puck item so
    // the shared extractor handles headings/links/images uniformly.
    out.set(p.id, {
      title: p.meta_title || p.name,
      slug: p.slug,
      metaDescription: p.meta_description || p.short_description,
      // A product page publishes its first photograph as the social image, so a
      // product with pictures HAS one whether or not a dedicated social image
      // was ever chosen - and nothing in the shop's editor sets og_image_id, so
      // reading that column alone told every product on every shop it had none.
      hasOgImage: !!p.og_image_id || Number(p.photo_count) > 0,
      isPublished: p.status === 'ACTIVE',
      content: extractContent({ content: [{ type: 'RichText', props: { html: p.description ?? p.short_description ?? '' } }] }),
      // The product page prints the product's name as its H1.
      titleIsH1: true,
    })
  }
  return out
}

async function loadDirectoryEntries(ids: string[]): Promise<Map<string, EntityDetail>> {
  const rows = await prisma.$queryRaw<Array<{
    id: string; name: string; slug: string; status: string; short_description: string | null; description: string | null
  }>>`
    SELECT "id", "name", "slug", "status", "short_description", "description"
    FROM "dir_entries" WHERE "id" = ANY(${ids}::text[])
  `
  const out = new Map<string, EntityDetail>()
  for (const e of rows) {
    out.set(e.id, {
      title: e.name,
      slug: e.slug,
      metaDescription: e.short_description,
      hasOgImage: false,
      isPublished: e.status.toUpperCase() === 'PUBLISHED' || e.status.toLowerCase() === 'active',
      content: extractContent({ content: [{ type: 'RichText', props: { html: e.description ?? '' } }] }),
      // The entry page prints the entry's name as its H1.
      titleIsH1: true,
    })
  }
  return out
}

/** Batch-load one content type's analysable detail, keyed by entity id. */
export async function loadEntities(entityType: EntityType, ids: string[]): Promise<Map<string, EntityDetail>> {
  if (ids.length === 0) return new Map()
  switch (entityType) {
    case 'core-page': return loadCorePages(ids)
    case 'gazette-post': return loadGazettePosts(ids)
    case 'shop-product': return loadShopProducts(ids)
    case 'directory-entry': return loadDirectoryEntries(ids)
  }
}

async function loadEntity(entityType: EntityType, entityId: string): Promise<EntityDetail | null> {
  const found = await loadEntities(entityType, [entityId])
  return found.get(entityId) ?? null
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
    titleIsH1: entity.titleIsH1,
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
