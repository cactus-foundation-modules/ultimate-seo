// Unified content inventory: core InfoPages plus the content of whichever
// SEO-relevant modules happen to be installed. Detection is live from the
// Module table - never a hard import of another module's code, so this module
// works identically whether or not gazette/shop/directory are present.

import { prisma } from '@/lib/db/prisma'
import { INSTALLED_MODULE_WHERE } from '@/lib/modules/live-status'
import { getAllPageMeta } from './db'
import type { EntityType, InventoryItem, SeoCheck } from './types'

type RawItem = Omit<InventoryItem, 'focusKeyword' | 'score' | 'checks' | 'analyzedAt'>

async function getActiveModuleNames(): Promise<Set<string>> {
  const rows = await prisma.module.findMany({
    where: { ...INSTALLED_MODULE_WHERE },
    select: { name: true },
  })
  return new Set(rows.map((r) => r.name))
}

async function coreP(): Promise<RawItem[]> {
  const [pages, config] = await Promise.all([
    prisma.infoPage.findMany({
      select: { id: true, slug: true, title: true, metaDescription: true, ogImageId: true, status: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.siteConfig.findUnique({ where: { id: 'singleton' }, select: { homepageId: true } }),
  ])
  return pages.map((p) => ({
    entityType: 'core-page' as EntityType,
    entityId: p.id,
    title: p.title,
    slug: p.slug,
    url: config?.homepageId === p.id ? '/' : `/${p.slug}`,
    status: p.status,
    metaDescription: p.metaDescription,
    hasOgImage: !!p.ogImageId,
    editable: true,
    editPath: `/pages/${p.id}`,
    updatedAt: p.updatedAt.toISOString(),
  }))
}

async function gazettePosts(): Promise<RawItem[]> {
  const rows = await prisma.$queryRaw<Array<{
    id: string; title: string; slug: string; status: string
    seo_title: string | null; seo_description: string | null; excerpt: string | null
    featured_image_id: string | null; updated_at: Date | null
  }>>`
    SELECT "id", "title", "slug", "status", "seo_title", "seo_description", "excerpt", "featured_image_id", "updated_at"
    FROM "gz_posts" WHERE "is_private" = false
    ORDER BY "published_at" DESC NULLS LAST
  `
  return rows.map((p) => ({
    entityType: 'gazette-post' as EntityType,
    entityId: p.id,
    title: p.seo_title || p.title,
    slug: p.slug,
    url: `/gazette/${p.slug}`,
    status: p.status.toLowerCase(),
    metaDescription: p.seo_description || p.excerpt,
    hasOgImage: !!p.featured_image_id,
    editable: false,
    editPath: `/m/gazette/posts/${p.id}`,
    updatedAt: p.updated_at ? p.updated_at.toISOString() : null,
  }))
}

async function shopProducts(): Promise<RawItem[]> {
  const rows = await prisma.$queryRaw<Array<{
    id: string; name: string; slug: string; status: string
    meta_title: string | null; meta_description: string | null; short_description: string | null
    og_image_id: string | null; updated_at: Date
  }>>`
    SELECT "id", "name", "slug", "status", "meta_title", "meta_description", "short_description", "og_image_id", "updated_at"
    FROM "shp_products" WHERE "catalogue_hidden" = false
    ORDER BY "updated_at" DESC
  `
  return rows.map((p) => ({
    entityType: 'shop-product' as EntityType,
    entityId: p.id,
    title: p.meta_title || p.name,
    slug: p.slug,
    url: `/shop/products/${p.slug}`,
    status: p.status.toLowerCase() === 'active' ? 'published' : p.status.toLowerCase(),
    metaDescription: p.meta_description || p.short_description,
    hasOgImage: !!p.og_image_id,
    editable: false,
    editPath: `/m/shop/products/${p.id}`,
    updatedAt: p.updated_at.toISOString(),
  }))
}

async function directoryEntries(): Promise<RawItem[]> {
  const rows = await prisma.$queryRaw<Array<{
    id: string; name: string; slug: string; status: string
    short_description: string | null; category_slug: string | null
  }>>`
    SELECT e."id", e."name", e."slug", e."status", e."short_description", c."slug" AS category_slug
    FROM "dir_entries" e LEFT JOIN "dir_categories" c ON c."id" = e."category_id"
    ORDER BY e."name" ASC
  `
  return rows.map((e) => ({
    entityType: 'directory-entry' as EntityType,
    entityId: e.id,
    title: e.name,
    slug: e.slug,
    url: e.category_slug ? `/directory/${e.category_slug}/${e.slug}` : '/directory',
    status: e.status.toLowerCase(),
    metaDescription: e.short_description,
    hasOgImage: false,
    editable: false,
    editPath: `/m/directory/entries/${e.id}`,
    updatedAt: null,
  }))
}

export async function getInventory(): Promise<InventoryItem[]> {
  const active = await getActiveModuleNames()

  const sources: Array<Promise<RawItem[]>> = [coreP()]
  if (active.has('gazette')) sources.push(gazettePosts())
  if (active.has('shop')) sources.push(shopProducts())
  if (active.has('directory')) sources.push(directoryEntries())

  const settled = await Promise.allSettled(sources)
  const items: RawItem[] = []
  for (const s of settled) {
    // A module mid-install may not have its tables yet; skip that source rather than 500 the page.
    if (s.status === 'fulfilled') items.push(...s.value)
  }

  const meta = await getAllPageMeta()
  const metaByKey = new Map(meta.map((m) => [`${m.entity_type}:${m.entity_id}`, m]))

  return items.map((item) => {
    const m = metaByKey.get(`${item.entityType}:${item.entityId}`)
    return {
      ...item,
      focusKeyword: m?.focus_keyword ?? null,
      score: m?.score ?? null,
      checks: (m?.checks as SeoCheck[] | null) ?? null,
      analyzedAt: m?.analyzed_at ? new Date(m.analyzed_at).toISOString() : null,
    }
  })
}
