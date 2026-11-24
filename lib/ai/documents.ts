// Building the Markdown twin of a page, one content type at a time.
//
// Every query in here is scoped to a batch of ids and asked once for the whole
// batch. A catalogue of twenty thousand products is the normal case, and a
// builder that asked six questions per product would be four figures of
// database round trips per rebuild.
//
// Module content is read by raw SQL against the module's own tables, never by
// importing its code - the same rule lib/inventory.ts follows, and for the same
// reason: this module has to work identically whether or not shop, gazette,
// filters or directory are installed.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { htmlToMarkdown, looksLikeHtml } from './html-to-markdown'
import { puckToMarkdown } from './puck-markdown'
import { bulletList, link, oneLine, renderDocument, table, type DocumentSection } from './document-format'
import { faqSection, normaliseFaqItems, normaliseFaqSet, resolveFaqs, EMPTY_FAQ_SET, type AiFaqItem, type AiFaqSet } from './faqs'
import type { BreadcrumbStep, PageFacts } from './json-ld'
import type { DocumentFacets, EntityType, InventoryItem, ProductAvailability, ProductFacets } from '../types'

export { DOCUMENT_BUILDER_REVISION } from './builder-revision'

export type BuiltDocument = {
  entityType: EntityType
  entityId: string
  /** Public address without its leading slash and without .md. '' is the homepage. */
  path: string
  title: string
  summary: string | null
  markdown: string
  sourceUpdatedAt: Date | null
  /** What this page's structured data and its twin link are built from at serve time. */
  pageFacts: PageFacts
  /** Price, stock and shelf, for the agent endpoint to filter on. Null off a product. */
  facets: DocumentFacets | null
}

/** How each content type is described to a reader that has never seen the site. */
export const ENTITY_KIND_LABEL: Record<EntityType, string> = {
  'core-page': 'Page',
  'gazette-post': 'Blog post',
  'shop-product': 'Product',
  'shop-category': 'Product category',
  'shop-collection': 'Product collection',
  // Not 'Product collection' as well. These labels are what an agent is handed
  // by list_sections and beside every search hit, and two different kinds of
  // thing under one name reads as the same section counted twice - which is
  // exactly how it looked on a live site: "Product collection: 168" directly
  // above "Product collection: 39".
  'filter-collection': 'Curated collection',
  'directory-entry': 'Directory listing',
}

// The homepage answers at '/', and '/.md' is not an address anybody would type
// or any reader would construct. It gets 'index' instead, so its twin sits at
// /index.md - which is both a real path and the one a person would guess.
function pathOf(url: string): string {
  const trimmed = url.replace(/^\/+/, '').replace(/\/+$/, '')
  return trimmed || 'index'
}

// A NUMERIC column arrives from raw SQL as a Prisma.Decimal, not a number, and
// `${decimal}` on one gives back a string that happens to look right - until a
// trailing zero or an exponent says otherwise. Everything goes through here.
function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (value instanceof Prisma.Decimal) return value.toNumber()
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Prices as the SHOP PRINTS THEM, which is not always what the shop stores.
 *
 * `taxMode` says what the figures in the product editor mean; `priceDisplayTax`
 * says what the storefront shows. A shop keeping its prices net for a trade
 * catalogue and showing them gross to consumers stores one figure and displays
 * another, and a twin that published the stored one would have every assistant
 * on the internet quoting a price 20% below the page - which is worse than
 * quoting nothing, because the shopper only finds out at the basket.
 *
 * The rate comes from the shop's default zone, which is the same answer its own
 * catalogue pages give: a price has to be printed long before anybody knows
 * where the parcel is going.
 */
type PriceView = {
  currency: string
  /** The shop's own wording after a price, e.g. "ex VAT". Empty when it has none. */
  suffix: string
  /** A stored figure as the storefront prints it, or null when there is none. */
  amount(value: unknown, taxClassId: string | null): number | null
  /** That figure, formatted, with the wording on the end. */
  format(value: unknown, taxClassId: string | null): string
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

type ShopPriceConfig = {
  currency: string
  mode: 'AS_ENTERED' | 'INCLUSIVE' | 'EXCLUSIVE'
  storedIncludesTax: boolean
  suffix: string
  /** Rate per tax-class id in the default zone. Absent means zero-rated. */
  rates: Map<string, number>
}

const NO_PRICE_ADJUSTMENT: ShopPriceConfig = {
  currency: 'GBP', mode: 'AS_ENTERED', storedIncludesTax: true, suffix: '', rates: new Map(),
}

async function shopPriceConfig(): Promise<ShopPriceConfig> {
  let config = NO_PRICE_ADJUSTMENT
  try {
    const rows = await prisma.$queryRaw<Array<{ currency: string | null; mode: string | null; tax_mode: string | null; suffix: string | null }>>`
      SELECT "config" ->> 'currency'              AS currency,
             "config" ->> 'priceDisplayTax'       AS mode,
             "config" ->> 'taxMode'               AS tax_mode,
             "config" ->> 'priceDisplayTaxSuffix' AS suffix
      FROM "shp_settings" WHERE "id" = 'singleton' LIMIT 1
    `
    const row = rows[0]
    if (!row) return config
    const code = row.currency?.trim().toUpperCase()
    config = {
      currency: code && /^[A-Z]{3}$/.test(code) ? code : 'GBP',
      mode: row.mode === 'INCLUSIVE' || row.mode === 'EXCLUSIVE' ? row.mode : 'AS_ENTERED',
      // The shop's own default. A column that has never been written means a
      // shop that has never thought about it, and that shop's prices carry tax.
      storedIncludesTax: row.tax_mode !== 'EXCLUSIVE',
      suffix: row.suffix?.trim() ?? '',
      rates: new Map(),
    }
  } catch {
    // No shop installed, or a version of it without these keys. Print what is
    // stored and say nothing about tax, which is what this did before.
    return NO_PRICE_ADJUSTMENT
  }

  // Nothing to convert: skip the zone and rate queries entirely rather than
  // reading a rate table per rebuild for a multiply by one.
  if (config.mode === 'AS_ENTERED') return config

  try {
    // The default zone is the one with no postcodes listed - the catch-all -
    // else the first by name. Same rule the shop's own resolver follows.
    const zones = await prisma.$queryRaw<Array<{ id: string; postcodes: unknown }>>`
      SELECT "id", "postcodes" FROM "shp_shipping_zones" ORDER BY "name" ASC
    `
    const zone = zones.find((z) => Array.isArray(z.postcodes) && z.postcodes.length === 0) ?? zones[0]
    if (!zone) return config
    const rates = await prisma.$queryRaw<Array<{ tax_class_id: string; rate: unknown }>>`
      SELECT "tax_class_id", "rate" FROM "shp_tax_zone_rates" WHERE "zone_id" = ${zone.id}
    `
    for (const rate of rates) {
      const value = decimalToNumber(rate.rate)
      if (value !== null) config.rates.set(rate.tax_class_id, value)
    }
  } catch {
    // Rates unreadable: the suffix and the currency are still right, and the
    // figures are the stored ones, which is where this started.
  }
  return config
}

function priceView(config: ShopPriceConfig): PriceView {
  let format: Intl.NumberFormat
  try {
    format = new Intl.NumberFormat('en-GB', { style: 'currency', currency: config.currency })
  } catch {
    // An unrecognised currency code would throw here and take the whole rebuild
    // with it. Falling back to plain numbers loses the symbol and nothing else.
    format = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const wantsTax = config.mode === 'AS_ENTERED' ? config.storedIncludesTax : config.mode === 'INCLUSIVE'
  const factor = (taxClassId: string | null): number => {
    if (wantsTax === config.storedIncludesTax) return 1
    const rate = (taxClassId ? config.rates.get(taxClassId) : 0) ?? 0
    if (rate <= 0) return 1
    return wantsTax ? 1 + rate : 1 / (1 + rate)
  }

  const amount = (value: unknown, taxClassId: string | null): number | null => {
    const n = decimalToNumber(value)
    if (n === null) return null
    const f = factor(taxClassId)
    return f === 1 ? n : round2(n * f)
  }

  return {
    currency: config.currency,
    suffix: config.suffix,
    amount,
    format(value, taxClassId) {
      const n = amount(value, taxClassId)
      if (n === null) return ''
      return config.suffix ? `${format.format(n)} ${config.suffix}` : format.format(n)
    },
  }
}

/** Body copy that may be stored as a builder document, HTML, or plain text. */
function bodyMarkdown(puck: unknown, html: string | null): string {
  const fromPuck = puckToMarkdown(puck)
  if (fromPuck) return fromPuck
  if (!html) return ''
  return looksLikeHtml(html) ? htmlToMarkdown(html) : html.trim()
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const k = key(row)
    const list = map.get(k)
    if (list) list.push(row)
    else map.set(k, [row])
  }
  return map
}

// ---------------------------------------------------------------------------
// Breadcrumb trails and images
// ---------------------------------------------------------------------------

const HOME: BreadcrumbStep = { name: 'Home', path: '' }

/** Every shop category, for walking a parent chain. Small on any real site. */
async function categoryTree(): Promise<Map<string, { id: string; name: string; slug: string; parent_id: string | null }>> {
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; slug: string; parent_id: string | null }>>`
    SELECT "id", "name", "slug", "parent_id" FROM "shp_categories"
  `
  return new Map(rows.map((r) => [r.id, r]))
}

/**
 * Home > … > this category.
 *
 * Guarded against a cycle rather than trusted not to have one: `parent_id` is a
 * plain self-reference with no constraint stopping two categories naming each
 * other, and the cost of being wrong here is a rebuild that never returns.
 */
function categoryTrail(
  id: string,
  tree: Map<string, { id: string; name: string; slug: string; parent_id: string | null }>,
): BreadcrumbStep[] {
  const steps: BreadcrumbStep[] = []
  const seen = new Set<string>()
  let current = tree.get(id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    steps.unshift({ name: current.name, path: `shop/categories/${current.slug}` })
    current = current.parent_id ? tree.get(current.parent_id) : undefined
  }
  return [HOME, ...steps]
}

/** Media URLs for a set of ids, in one query. */
async function mediaUrls(ids: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter(Boolean))]
  if (wanted.length === 0) return new Map()
  try {
    const rows = await prisma.media.findMany({ where: { id: { in: wanted } }, select: { id: true, url: true } })
    return new Map(rows.map((r) => [r.id, r.url]))
  } catch {
    // An image is worth less than the document it is attached to.
    return new Map()
  }
}

// ---------------------------------------------------------------------------
// Core pages
// ---------------------------------------------------------------------------

async function corePageBodies(ids: string[]): Promise<Map<string, string>> {
  const pages = await prisma.infoPage.findMany({
    where: { id: { in: ids } },
    select: { id: true, body: true, bodyFormat: true, publishedData: true, builderData: true },
  })
  return new Map(pages.map((p) => {
    // publishedData is what the public sees; builderData is the working draft.
    // A twin built from the draft would quote copy nobody has published.
    const data = p.publishedData ?? p.builderData
    const md = p.bodyFormat === 'builder'
      ? puckToMarkdown(data)
      : bodyMarkdown(data, p.body)
    return [p.id, md]
  }))
}

// ---------------------------------------------------------------------------
// Gazette posts
// ---------------------------------------------------------------------------

type GazetteRow = {
  id: string
  builder_data: unknown
  excerpt: string | null
  published_at: Date | null
  featured_image_id: string | null
  author_name: string | null
  series: string | null
}

async function gazetteBodies(ids: string[]): Promise<Map<string, { sections: DocumentSection[]; row: GazetteRow }>> {
  const [posts, tags] = await Promise.all([
    prisma.$queryRaw<GazetteRow[]>`
      SELECT p."id", p."builder_data", p."excerpt", p."published_at", p."featured_image_id",
             COALESCE(NULLIF(u."displayName", ''), u."username", p."imported_author_name") AS author_name,
             s."title" AS series
      FROM "gz_posts" p
      LEFT JOIN "User" u ON u."id" = p."author_id"
      LEFT JOIN "gz_series" s ON s."id" = p."series_id"
      WHERE p."id" IN (${Prisma.join(ids)})
    `,
    prisma.$queryRaw<Array<{ post_id: string; name: string }>>`
      SELECT pt."post_id", t."name"
      FROM "gz_post_tags" pt JOIN "gz_tags" t ON t."id" = pt."tag_id"
      WHERE pt."post_id" IN (${Prisma.join(ids)})
      ORDER BY t."name" ASC
    `,
  ])
  const tagsByPost = groupBy(tags, (t) => t.post_id)

  return new Map(posts.map((post) => {
    const sections: DocumentSection[] = []
    const facts: string[] = []
    if (post.author_name) facts.push(`Written by ${post.author_name}`)
    if (post.published_at) facts.push(`Published ${post.published_at.toISOString().slice(0, 10)}`)
    if (post.series) facts.push(`Part of the series “${post.series}”`)
    const postTags = tagsByPost.get(post.id)?.map((t) => t.name) ?? []
    if (postTags.length) facts.push(`Tagged ${postTags.join(', ')}`)
    if (facts.length) sections.push({ heading: 'About this post', body: bulletList(facts) })
    sections.push({ heading: 'Article', body: puckToMarkdown(post.builder_data) })
    return [post.id, { sections, row: post }]
  }))
}

// ---------------------------------------------------------------------------
// Shop products
// ---------------------------------------------------------------------------

type ProductRow = {
  id: string
  master_category_id: string | null
  sku: string | null
  supplier_sku: string | null
  barcode: string | null
  price: unknown
  sale_price: unknown
  track_inventory: boolean
  stock_count: number | null
  out_of_stock_behaviour: string | null
  is_pre_order: boolean
  min_order_quantity: number | null
  short_description: string | null
  description: string | null
  description_puck: unknown
  weight: unknown
  weight_unit: string | null
  dimension_l: unknown
  dimension_w: unknown
  dimension_h: unknown
  dimension_unit: string | null
  supplier: string | null
  tax_class_id: string | null
}

type ProductExtras = {
  categories: Map<string, Array<{ id: string; name: string; slug: string }>>
  collections: Map<string, Array<{ id: string; name: string; slug: string }>>
  attributes: Map<string, Array<{ attribute: string; value: string }>>
  variants: Map<string, VariantRow[]>
  /** Each listing's options, in the order the page asks them, with the values
   *  at least one live combination actually uses. */
  options: Map<string, Array<{ name: string; values: string[] }>>
  /** Product ids - parents and variant children alike - that have a 3D model. */
  modelled: Set<string>
  photoCounts: Map<string, number>
  photos: Map<string, Array<{ url: string; alt: string | null }>>
  addons: Map<string, AddonRow[]>
  /** What the shop calls its add-ons, plural: "Add-ons", "Accessories". */
  addonNoun: string
  downloads: Map<string, Array<{ id: string; name: string; mime_type: string; size: number }>>
  reviews: Map<string, ReviewRow[]>
  related: Map<string, Array<{ name: string; slug: string }>>
}

type VariantRow = {
  parent_id: string
  child_id: string
  name: string
  sku: string | null
  price: unknown
  sale_price: unknown
  stock_count: number | null
  track_inventory: boolean
  is_pre_order: boolean
  out_of_stock_behaviour: string | null
  options: string | null
  /** Option name -> the value this combination takes for it. */
  option_map: Record<string, string> | null
}

type AddonRow = {
  product_id: string
  name: string
  slug: string
  tax_class_id: string | null
  price_min: unknown
  price_max: unknown
  /** "Width: 120cm, 140cm; Finish: Oak, White" - what is chosen on the add-on. */
  choices: string | null
}

type ReviewRow = {
  product_id: string
  rating: number
  title: string | null
  body: string | null
  author_name: string | null
  verified_purchase: boolean
  published_at: Date | null
  reply_body: string | null
}

// The add-on's own price, falling back to the spread across its combinations
// when the listing row carries none - the same reason productFacts falls back.
const ADDON_SPREAD_SQL = `
  SELECT MIN(COALESCE(NULLIF(child."sale_price", 0), NULLIF(child."price", 0))) AS lo,
         MAX(COALESCE(NULLIF(child."sale_price", 0), NULLIF(child."price", 0))) AS hi
  FROM "svr_variants" v JOIN "shp_products" child ON child."id" = v."child_product_id"
  WHERE v."product_id" = a."id" AND v."enabled" = true`

async function loadProductExtras(ids: string[], hasModule: (name: string) => boolean): Promise<ProductExtras> {
  const empty: ProductExtras = {
    categories: new Map(), collections: new Map(), attributes: new Map(),
    variants: new Map(), options: new Map(), modelled: new Set(), photoCounts: new Map(),
    photos: new Map(), addons: new Map(), addonNoun: 'Add-ons', downloads: new Map(),
    reviews: new Map(), related: new Map(),
  }
  if (ids.length === 0) return empty

  const [categories, collections, photos] = await Promise.all([
    prisma.$queryRaw<Array<{ product_id: string; id: string; name: string; slug: string }>>`
      SELECT pc."product_id", c."id", c."name", c."slug"
      FROM "shp_product_categories" pc JOIN "shp_categories" c ON c."id" = pc."category_id"
      WHERE pc."product_id" IN (${Prisma.join(ids)})
      ORDER BY c."position" ASC, c."name" ASC
    `,
    prisma.$queryRaw<Array<{ product_id: string; id: string; name: string; slug: string }>>`
      SELECT pc."product_id", c."id", c."name", c."slug"
      FROM "shp_product_collections" pc JOIN "shp_collections" c ON c."id" = pc."collection_id"
      WHERE pc."product_id" IN (${Prisma.join(ids)})
      ORDER BY c."position" ASC, c."name" ASC
    `,
    prisma.$queryRaw<Array<{ product_id: string; count: bigint }>>`
      SELECT "product_id", COUNT(*) AS count FROM "shp_product_media"
      WHERE "product_id" IN (${Prisma.join(ids)}) AND "type" <> 'VIDEO_URL'
      GROUP BY "product_id"
    `,
  ])

  const extras: ProductExtras = {
    ...empty,
    categories: groupBy(categories, (r) => r.product_id),
    collections: groupBy(collections, (r) => r.product_id),
    photoCounts: new Map(photos.map((p) => [p.product_id, Number(p.count)])),
  }

  // The photographs themselves, not just how many. An assistant asked "what
  // does it look like" can hand over a picture; one told "7" cannot.
  try {
    const rows = await prisma.$queryRaw<Array<{ product_id: string; url: string; alt_text: string | null }>>`
      SELECT "product_id", "url", "alt_text" FROM "shp_product_media"
      WHERE "product_id" IN (${Prisma.join(ids)}) AND "type" = 'IMAGE' AND "url" IS NOT NULL AND "url" <> ''
      ORDER BY "product_id", "is_primary" DESC, "position" ASC
    `
    for (const [productId, list] of groupBy(rows, (r) => r.product_id)) {
      extras.photos.set(productId, list.map((r) => ({ url: r.url, alt: r.alt_text })))
    }
  } catch {
    // A twin without its pictures is still worth more than no twin.
  }

  // Related products, where the shop has named any. Only live, visible ones -
  // a link to a draft is a link to a 404.
  try {
    const rows = await prisma.$queryRaw<Array<{ product_id: string; name: string; slug: string }>>`
      SELECT r."product_id", p."name", p."slug" FROM (
        SELECT "product_id", "related_id" AS other, "position" FROM "shp_related_products"
        UNION ALL
        SELECT "product_id", "upsell_id" AS other, "position" + 10000 FROM "shp_upsell_products"
      ) r
      JOIN "shp_products" p ON p."id" = r.other
      WHERE r."product_id" IN (${Prisma.join(ids)}) AND p."status" = 'ACTIVE' AND p."catalogue_hidden" = false
      ORDER BY r."product_id", r."position" ASC
    `
    extras.related = groupBy(rows, (r) => r.product_id)
  } catch {
    // As above.
  }

  // Variations. A "variation" is a hidden CHILD product row, which is why the
  // 3D lookup below has to cover the children as well as the parents: a model
  // attached to one colourway is attached to that child's id, not the parent's.
  let childIds: string[] = []
  if (hasModule('shop-variations')) {
    try {
      const variants = await prisma.$queryRaw<VariantRow[]>`
        SELECT v."product_id" AS parent_id, v."child_product_id" AS child_id,
               child."name", child."sku", child."price", child."sale_price",
               child."stock_count", child."track_inventory", child."is_pre_order", child."out_of_stock_behaviour",
               (
                 SELECT string_agg(ov."label", ', ' ORDER BY o."position" ASC)
                 FROM "svr_variant_values" vv
                 JOIN "svr_option_values" ov ON ov."id" = vv."option_value_id"
                 JOIN "svr_options" o ON o."id" = ov."option_id"
                 WHERE vv."variant_id" = v."id"
               ) AS options,
               (
                 SELECT jsonb_object_agg(o."name", ov."label")
                 FROM "svr_variant_values" vv
                 JOIN "svr_option_values" ov ON ov."id" = vv."option_value_id"
                 JOIN "svr_options" o ON o."id" = ov."option_id"
                 WHERE vv."variant_id" = v."id"
               ) AS option_map
        FROM "svr_variants" v
        JOIN "shp_products" child ON child."id" = v."child_product_id"
        WHERE v."product_id" IN (${Prisma.join(ids)}) AND v."enabled" = true
        ORDER BY v."position" ASC
      `
      extras.variants = groupBy(variants, (v) => v.parent_id)
      childIds = variants.map((v) => v.child_id)

      // The options a shopper is asked, each with the values some live
      // combination actually takes. A value no enabled combination uses is one
      // the page will not offer, so it is not one to promise here either.
      const options = await prisma.$queryRaw<Array<{ product_id: string; option_id: string; name: string; label: string }>>`
        SELECT o."product_id", o."id" AS option_id, o."name", ov."label"
        FROM "svr_options" o
        JOIN "svr_option_values" ov ON ov."option_id" = o."id"
        WHERE o."product_id" IN (${Prisma.join(ids)})
          AND EXISTS (
            SELECT 1 FROM "svr_variant_values" vv
            JOIN "svr_variants" v ON v."id" = vv."variant_id"
            WHERE vv."option_value_id" = ov."id" AND v."enabled" = true
          )
        ORDER BY o."product_id", o."position" ASC, ov."position" ASC
      `
      for (const [productId, rows] of groupBy(options, (r) => r.product_id)) {
        const list: Array<{ name: string; values: string[] }> = []
        for (const [, values] of groupBy(rows, (r) => r.option_id)) {
          list.push({ name: values[0]!.name, values: [...new Set(values.map((v) => v.label))] })
        }
        extras.options.set(productId, list)
      }
    } catch {
      // Module present but mid-migration: a document without its variations is
      // worth more than no document.
    }
  }

  if (hasModule('product-addons-for-shop')) {
    try {
      const spread = hasModule('shop-variations')
        ? Prisma.raw(`LEFT JOIN LATERAL (${ADDON_SPREAD_SQL}) s ON true`)
        : Prisma.raw('LEFT JOIN LATERAL (SELECT NULL::numeric AS lo, NULL::numeric AS hi) s ON true')
      const choices = hasModule('shop-variations')
        ? Prisma.raw(`(
            SELECT string_agg(o."name" || ': ' || (
              SELECT string_agg(ov."label", ', ' ORDER BY ov."position" ASC)
              FROM "svr_option_values" ov WHERE ov."option_id" = o."id"
            ), '; ' ORDER BY o."position" ASC)
            FROM "svr_options" o WHERE o."product_id" = a."id"
          )`)
        : Prisma.raw('NULL::text')
      // Only live, visible add-ons, exactly as the product page offers them:
      // a draft or hidden listing drops out there and has to here too.
      const [rows, noun] = await Promise.all([
        prisma.$queryRaw<AddonRow[]>`
          SELECT l."product_id", a."name", a."slug", a."tax_class_id",
                 COALESCE(NULLIF(COALESCE(NULLIF(a."sale_price", 0), a."price"), 0), s.lo) AS price_min,
                 COALESCE(NULLIF(COALESCE(NULLIF(a."sale_price", 0), a."price"), 0), s.hi) AS price_max,
                 ${choices} AS choices
          FROM "pad_links" l
          JOIN "shp_products" a ON a."id" = l."addon_product_id"
          ${spread}
          WHERE l."product_id" IN (${Prisma.join(ids)}) AND l."enabled" = true
            AND a."status" = 'ACTIVE' AND a."catalogue_hidden" = false
          ORDER BY l."product_id", l."position" ASC
        `,
        prisma.$queryRaw<Array<{ noun_plural: string | null }>>`
          SELECT "noun_plural" FROM "pad_settings" WHERE "id" = 'singleton' LIMIT 1
        `.catch(() => []),
      ])
      extras.addons = groupBy(rows, (r) => r.product_id)
      const plural = noun[0]?.noun_plural?.trim()
      if (plural) extras.addonNoun = plural
    } catch {
      // As above.
    }
  }

  if (hasModule('product-downloads-for-shop')) {
    try {
      const rows = await prisma.$queryRaw<Array<{ product_id: string; id: string; name: string; mime_type: string; size: number }>>`
        SELECT "product_id", "id", "name", "mime_type", "size" FROM "pdl_files"
        WHERE "product_id" IN (${Prisma.join(ids)})
        ORDER BY "product_id", "position" ASC, "created_at" ASC
      `
      extras.downloads = groupBy(rows, (r) => r.product_id)
    } catch {
      // As above.
    }
  }

  if (hasModule('reviews-for-shop')) {
    try {
      // Published reviews only - the ones the page prints, under the name the
      // page prints. Nothing pending, nothing turned down, no email address.
      const rows = await prisma.$queryRaw<ReviewRow[]>`
        SELECT "product_id", "rating", "title", "body", "author_name", "verified_purchase",
               "published_at", "reply_body"
        FROM "rvw_reviews"
        WHERE "product_id" IN (${Prisma.join(ids)}) AND "status" = 'PUBLISHED'
        ORDER BY "product_id", "published_at" DESC NULLS LAST, "created_at" DESC
      `
      extras.reviews = groupBy(rows, (r) => r.product_id)
    } catch {
      // As above.
    }
  }

  if (hasModule('product-attributes-for-shop')) {
    try {
      // Only the helpings the owner flagged for the product page's Specification
      // panel, under the name the panel shows and in the order it shows them.
      //
      // The filter is the point of this query, not a tidy-up. A product's
      // attributes are also where a shop keeps the things it has no intention of
      // publishing - supplier catalogue codes, commodity codes, and on the site
      // this was first run against an attribute called "Markup" holding the
      // margin. None of it appears on the page; all of it appeared here, in the
      // one file written to be read by assistants and quoted back at customers.
      // The rule is now the same one the page follows: show_in_spec decides, so
      // the twin says what the page says and nothing else.
      const rows = await prisma.$queryRaw<Array<{
        product_id: string; attribute: string; value: string
        spec_position: number; attribute_position: number; value_position: number
      }>>`
        SELECT DISTINCT ppa."spec_position", a."position" AS attribute_position,
               av."position" AS value_position, pv."product_id",
               COALESCE(NULLIF(TRIM(ppa."name_override"), ''), a."name") AS attribute,
               av."label" AS value
        FROM "pat_product_values" pv
        JOIN "pat_attribute_values" av ON av."id" = pv."value_id"
        JOIN "pat_attributes" a ON a."id" = av."attribute_id"
        -- Matched on the helping where the value says which one it belongs to,
        -- and on the attribute where it does not: assignment_id is nullable, and
        -- a product-level tick saved before helpings could repeat carries none.
        JOIN "pat_product_attributes" ppa
          ON ppa."product_id" = pv."product_id"
         AND ppa."attribute_id" = av."attribute_id"
         AND (pv."assignment_id" IS NULL OR pv."assignment_id" = ppa."id")
        WHERE pv."product_id" IN (${Prisma.join(ids)})
          AND ppa."show_in_spec" = true
        ORDER BY ppa."spec_position" ASC, a."position" ASC, av."position" ASC
      `
      extras.attributes = groupBy(rows, (r) => r.product_id)
    } catch {
      // As above.
    }
  }

  if (hasModule('product-3d-views-for-shop')) {
    try {
      const lookIn = [...ids, ...childIds]
      const rows = await prisma.$queryRaw<Array<{ product_id: string }>>`
        SELECT DISTINCT "product_id" FROM "p3d_models" WHERE "product_id" IN (${Prisma.join(lookIn)})
      `
      extras.modelled = new Set(rows.map((r) => r.product_id))
    } catch {
      // As above.
    }
  }

  return extras
}

// Every combination is listed: the exact price of the exact thing a shopper is
// about to choose is the question an assistant is most often asked, and "139
// further combinations are on the page" answered it for none of them. The cap
// is only a guard against a runaway listing - at one short table row each, a
// thousand combinations is still well under a hundred kilobytes.
const MAX_VARIANTS_LISTED = 1000
const MAX_PHOTOS_LISTED = 30
const MAX_REVIEWS_LISTED = 20

/** What a combination's stock means to somebody wanting one. */
function variantStock(v: VariantRow): string {
  if (v.is_pre_order) return 'Pre-order'
  if (!v.track_inventory) return 'Made to order'
  const stock = v.stock_count ?? 0
  if (stock > 0) return String(stock)
  return v.out_of_stock_behaviour === 'BACKORDER' ? 'On backorder' : 'Out of stock'
}

/** A price, with the figure it was reduced from where there is one. */
function priceWithWas(row: { price: unknown; sale_price: unknown }, taxClassId: string | null, money: PriceView): string {
  const now = effectivePrice(row)
  if (now === null) return ''
  const list = decimalToNumber(row.price)
  const sale = decimalToNumber(row.sale_price)
  if (sale !== null && sale > 0 && list !== null && list > sale) {
    return `${money.format(sale, taxClassId)} (was ${money.format(list, taxClassId)})`
  }
  return money.format(now, taxClassId)
}

function formatBytes(size: number): string {
  if (!size || size <= 0) return ''
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function fileKind(mime: string): string {
  if (mime === 'application/pdf') return 'PDF'
  if (mime.startsWith('image/')) return 'Image'
  if (mime.includes('wordprocessingml') || mime === 'application/msword') return 'Word document'
  if (mime.includes('spreadsheetml') || mime === 'application/vnd.ms-excel') return 'Spreadsheet'
  if (mime.includes('zip')) return 'ZIP archive'
  return ''
}

function productSections(
  product: ProductRow,
  extras: ProductExtras,
  money: PriceView,
  delivery: ProductDeliverySummary | null,
  productPath: (slug: string) => string,
): DocumentSection[] {
  const sections: DocumentSection[] = []

  const body = bodyMarkdown(product.description_puck, product.description)
  // The short description is the line under the price on the page. Printed
  // where the long copy does not already open with it, so it is said once.
  const short = product.short_description ? bodyMarkdown(null, product.short_description).trim() : ''
  const flat = (text: string) => text.replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase()
  if (short && !flat(body).includes(flat(short).slice(0, 120))) {
    sections.push({ heading: 'Overview', body: short })
  }
  if (body) sections.push({ heading: 'Description', body })

  const options = extras.options.get(product.id) ?? []
  if (options.length > 0) {
    sections.push({
      heading: 'Options',
      body: [
        'Choose one value for each of these before adding the product to the basket. Each combination has its own SKU and price, listed under Variations below.',
        bulletList(options.map((o) => `**${o.name}**: ${o.values.join(', ')}`)),
      ].join('\n\n'),
    })
  }

  const variants = extras.variants.get(product.id) ?? []
  if (variants.length > 0) {
    // One column per option, in the order the page asks them, where every
    // combination can be split that way; the joined label otherwise.
    const optionNames = options.map((o) => o.name)
    const split = optionNames.length > 0 && variants.every((v) => v.option_map && optionNames.every((n) => n in v.option_map!))
    // A column per delivery service whose charge depends on the combination,
    // so "how much is installation on the six-person one" has an answer.
    const deliveryColumns = delivery?.varying ?? []
    const deliveryCell = (childId: string, key: string): string => {
      const charges = delivery?.perChild.get(childId)
      if (!charges) return ''
      const price = charges.get(key)
      if (price === undefined) return 'Not available'
      return price === 0 ? 'Free' : money.format(price, product.tax_class_id)
    }
    const rows = variants.slice(0, MAX_VARIANTS_LISTED).map((v) => [
      ...(split ? optionNames.map((n) => v.option_map![n] ?? '') : [v.options?.trim() || v.name]),
      v.sku ?? '',
      // The listing's tax class, not the child's: a combination is the same
      // goods in a different colour, and the shop charges it accordingly.
      priceWithWas(v, product.tax_class_id, money),
      ...deliveryColumns.map((c) => deliveryCell(v.child_id, c.key)),
      variantStock(v),
      extras.modelled.has(v.child_id) ? 'Yes' : 'No',
    ])
    const more = variants.length > MAX_VARIANTS_LISTED
      ? `\n\n${variants.length - MAX_VARIANTS_LISTED} further combinations are available on the page itself.`
      : ''
    sections.push({
      heading: 'Variations',
      body: `${variants.length} combination${variants.length === 1 ? '' : 's'}. Stock is the number available now${deliveryColumns.length ? '; delivery columns are the per-item charge for that service on that combination' : ''}.\n\n${table([...(split ? optionNames : ['Choice']), 'SKU', 'Price', ...deliveryColumns.map((c) => c.label), 'Stock', '3D model'], rows)}${more}`,
    })
  }

  const deliveryBody = delivery ? deliveryMarkdown(delivery, product.tax_class_id, money) : ''
  if (deliveryBody) sections.push({ heading: 'Delivery', body: deliveryBody })

  const addons = extras.addons.get(product.id) ?? []
  if (addons.length > 0) {
    const rows = addons.map((a) => {
      const lo = decimalToNumber(a.price_min)
      const hi = decimalToNumber(a.price_max)
      const price = lo === null
        ? 'On the page'
        : hi !== null && hi !== lo
          ? `${money.format(lo, a.tax_class_id)} to ${money.format(hi, a.tax_class_id)}`
          : money.format(lo, a.tax_class_id)
      return [link(a.name, `/${productPath(a.slug)}`), price, a.choices ?? '']
    })
    sections.push({
      heading: extras.addonNoun,
      body: `Optional extras that can be added to the basket from this product's page, each priced on top of the product itself.\n\n${table(['Item', 'Price', 'Choices'], rows)}`,
    })
  }

  const attributes = extras.attributes.get(product.id) ?? []
  if (attributes.length > 0) {
    // One row per attribute, its values joined - an attribute with three values
    // is one fact about the product, not three.
    const byAttribute = groupBy(attributes, (a) => a.attribute)
    sections.push({
      heading: 'Specification',
      body: table(['Attribute', 'Value'], [...byAttribute.entries()].map(([name, values]) => [
        name,
        values.map((v) => v.value).join(', '),
      ])),
    })
  }

  const dimensions = [
    decimalToNumber(product.dimension_w) ? `W ${decimalToNumber(product.dimension_w)}` : '',
    decimalToNumber(product.dimension_l) ? `D ${decimalToNumber(product.dimension_l)}` : '',
    decimalToNumber(product.dimension_h) ? `H ${decimalToNumber(product.dimension_h)}` : '',
  ].filter(Boolean).join(' × ')
  const weight = decimalToNumber(product.weight)
  const physical = [
    dimensions ? `Dimensions: ${dimensions}${product.dimension_unit ?? 'mm'}` : '',
    weight ? `Weight: ${weight}${product.weight_unit ?? 'kg'}` : '',
  ].filter(Boolean)
  if (physical.length) sections.push({ heading: 'Size and weight', body: bulletList(physical) })

  const reviews = extras.reviews.get(product.id) ?? []
  if (reviews.length > 0) {
    const average = reviews.reduce((n, r) => n + r.rating, 0) / reviews.length
    const listed = reviews.slice(0, MAX_REVIEWS_LISTED).map((r) => {
      const head = [
        `${r.rating} out of 5`,
        r.title?.trim() ? `**${r.title.trim()}**` : '',
      ].filter(Boolean).join(' - ')
      const by = [
        r.author_name?.trim() ? r.author_name.trim() : '',
        r.verified_purchase ? 'verified purchase' : '',
        r.published_at ? r.published_at.toISOString().slice(0, 10) : '',
      ].filter(Boolean).join(', ')
      const reply = r.reply_body?.trim() ? `\n\n  Reply from the shop: ${r.reply_body.trim().replace(/\s+/g, ' ')}` : ''
      return `- ${head}${by ? ` (${by})` : ''}${r.body?.trim() ? `\n\n  ${r.body.trim().replace(/\s+/g, ' ')}` : ''}${reply}`
    })
    sections.push({
      heading: 'Customer reviews',
      body: `Rated ${average.toFixed(1)} out of 5 from ${reviews.length} review${reviews.length === 1 ? '' : 's'}.\n\n${listed.join('\n')}`,
    })
  }

  const downloads = extras.downloads.get(product.id) ?? []
  if (downloads.length > 0) {
    sections.push({
      heading: 'Downloads',
      body: bulletList(downloads.map((d) => {
        const about = [fileKind(d.mime_type), formatBytes(d.size)].filter(Boolean).join(', ')
        return `${link(d.name, `/api/m/product-downloads-for-shop/public/files/${d.id}`)}${about ? ` (${about})` : ''}`
      })),
    })
  }

  const photos = extras.photos.get(product.id) ?? []
  if (photos.length > 0) {
    sections.push({
      heading: 'Photographs',
      body: bulletList(photos.slice(0, MAX_PHOTOS_LISTED).map((p, i) => {
        const alt = p.alt?.trim().replace(/[[\]]/g, '') || `Photograph ${i + 1}`
        return `![${alt}](${p.url})`
      })),
    })
  }

  const related = extras.related.get(product.id) ?? []
  if (related.length > 0) {
    sections.push({
      heading: 'Related products',
      body: bulletList(related.map((r) => link(r.name, `/${productPath(r.slug)}`))),
    })
  }

  const categories = extras.categories.get(product.id) ?? []
  const collections = extras.collections.get(product.id) ?? []
  if (categories.length || collections.length) {
    sections.push({
      heading: 'Where it sits',
      body: bulletList([
        ...categories.map((c) => link(c.name, `/shop/categories/${c.slug}`)),
        ...collections.map((c) => link(c.name, `/shop/collections/${c.slug}`)),
      ]),
    })
  }

  return sections
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/** One delivery choice as the twin prints it. */
type DeliveryLine = {
  label: string
  description: string | null
  /** Cheapest and dearest across the combinations that offer it. Null = no figure. */
  lo: number | null
  hi: number | null
  /** True when charged on every unit rather than once per order. */
  perUnit: boolean
  /** Whether the figure is converted on the product's own tax class. */
  productTax: boolean
  daysLo: number | null
  daysHi: number | null
  /** Anything else worth a sentence: an estimate in the shop's own words. */
  note: string | null
  /** Order value above which this rate is free, where the shop sets one. */
  freeOver?: number | null
}

type ProductDeliverySummary = {
  lines: DeliveryLine[]
  /** Services whose price differs between combinations, or that only some of
   *  them carry, in the order they are listed. Each gets a column of its own in
   *  the variations table, so the charge for the exact combination is there. */
  varying: Array<{ key: string; label: string }>
  /** Combination id -> service key -> its per-item charge. */
  perChild: Map<string, Map<string, number>>
}

type TimingOption = { key: string; label: string; description: string | null; price: number; handlingDays: number; transitDays: number }

/**
 * Per-product delivery services, from whichever module publishes them at
 * `shop.product-delivery-timing`. Read through core's registry rather than
 * imported: this module has to build identically on a shop with no delivery
 * module at all, and there the point is simply empty.
 *
 * Checked rather than trusted - it crosses a registry seam with no shared
 * types - and one malformed option is dropped on its own.
 */
async function deliveryTiming(productIds: string[]): Promise<Map<string, TimingOption[]> | null> {
  // The SERVER map, reached with a dynamic import rather than a static one: the
  // registry imports this module's own agent-content provider, which leads back
  // here through llms-txt.ts, and a static edge closes that loop. See
  // scripts/check-import-cycles.mjs in core.
  const { moduleServerExtensionPointComponents } = await import('@/lib/modules/extension-points.server')
  const registered = (moduleServerExtensionPointComponents as Record<string, Record<string, unknown> | undefined>)['shop.product-delivery-timing'] ?? {}
  const provider = Object.values(registered).find((entry): entry is (ids: string[]) => Promise<unknown> => typeof entry === 'function')
  if (!provider) return null
  const out = new Map<string, TimingOption[]>()
  if (productIds.length === 0) return out
  try {
    const answered = await provider(productIds)
    if (!(answered instanceof Map)) return out
    for (const [productId, value] of answered) {
      if (typeof productId !== 'string' || typeof value !== 'object' || value === null) continue
      const options: TimingOption[] = []
      for (const raw of Array.isArray((value as { options?: unknown }).options) ? (value as { options: unknown[] }).options : []) {
        if (typeof raw !== 'object' || raw === null) continue
        const o = raw as Record<string, unknown>
        const days = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null)
        const key = typeof o.key === 'string' ? o.key : ''
        const label = typeof o.label === 'string' ? o.label.trim() : ''
        const price = typeof o.price === 'number' && Number.isFinite(o.price) && o.price >= 0 ? o.price : null
        const handling = days(o.handlingDays)
        const transit = days(o.transitDays)
        if (!key || !label || price === null || handling === null || transit === null) continue
        options.push({
          key, label, price, handlingDays: handling, transitDays: transit,
          description: typeof o.description === 'string' && o.description.trim() ? o.description.trim() : null,
        })
      }
      if (options.length) out.set(productId, options)
    }
  } catch (err) {
    // Delivery is worth a section, not the document.
    console.error('[ultimate-seo] delivery timing unavailable for the twin', err)
  }
  return out
}

/**
 * A listing's delivery choices, across whatever a shopper can actually buy.
 *
 * Read from the combinations where it has any - they are what goes in the
 * basket, and a service whose price depends on the size chosen is quoted as
 * the spread rather than as whichever one happened to be asked first - and
 * from the listing itself where it has none, or where none of them answered.
 */
function summariseDelivery(
  parentId: string,
  childIds: string[],
  timing: Map<string, TimingOption[]>,
): ProductDeliverySummary | null {
  const answering = childIds.filter((id) => timing.has(id))
  const sources = answering.length ? answering : timing.has(parentId) ? [parentId] : []
  if (sources.length === 0) return null

  const byKey = new Map<string, DeliveryLine>()
  for (const id of sources) {
    for (const o of timing.get(id) ?? []) {
      const total = o.handlingDays + o.transitDays
      const line = byKey.get(o.key)
      if (!line) {
        byKey.set(o.key, {
          label: o.label, description: o.description, lo: o.price, hi: o.price,
          perUnit: true, productTax: true, daysLo: total, daysHi: total, note: null,
        })
        continue
      }
      line.lo = Math.min(line.lo ?? o.price, o.price)
      line.hi = Math.max(line.hi ?? o.price, o.price)
      line.daysLo = Math.min(line.daysLo ?? total, total)
      line.daysHi = Math.max(line.daysHi ?? total, total)
    }
  }
  const lines = [...byKey.values()]
  const perChild = new Map<string, Map<string, number>>()
  const varying: Array<{ key: string; label: string }> = []
  if (answering.length > 1) {
    for (const id of answering) perChild.set(id, new Map((timing.get(id) ?? []).map((o) => [o.key, o.price])))
    for (const [key, line] of byKey) {
      const everywhere = answering.every((id) => perChild.get(id)!.has(key))
      if (line.lo !== line.hi || !everywhere) varying.push({ key, label: line.label })
    }
  }
  // Where only some combinations carry a service, say so: "available" on a
  // listing where the shopper's chosen size cannot have it is a promise broken
  // at the basket.
  if (sources.length > 1) {
    for (const [key, line] of byKey) {
      const carrying = sources.filter((id) => (timing.get(id) ?? []).some((o) => o.key === key)).length
      if (carrying < sources.length) line.note = `Available on ${carrying} of ${sources.length} combinations.`
    }
  }
  return { lines, varying, perChild }
}

type ShopRateRow = { name: string; type: string; flat_rate: unknown; free_threshold: unknown; estimated_days: string | null }

/**
 * The shop's own shipping rates, for a shop with no per-product delivery
 * module. Charged per ORDER, from the catch-all zone - the same zone the
 * catalogue prices are worked out against.
 */
async function shopShippingRates(): Promise<ProductDeliverySummary | null> {
  try {
    const zones = await prisma.$queryRaw<Array<{ id: string; postcodes: unknown }>>`
      SELECT "id", "postcodes" FROM "shp_shipping_zones" ORDER BY "name" ASC
    `
    const zone = zones.find((z) => Array.isArray(z.postcodes) && z.postcodes.length === 0) ?? zones[0]
    if (!zone) return null
    const rates = await prisma.$queryRaw<ShopRateRow[]>`
      SELECT "name", "type", "flat_rate", "free_threshold", "estimated_days"
      FROM "shp_shipping_rates" WHERE "zone_id" = ${zone.id} AND "is_active" = true
      ORDER BY "position" ASC, "name" ASC
    `
    if (rates.length === 0) return null
    return {
      lines: rates.map((r) => {
        const flat = r.type === 'FREE' ? 0 : r.type === 'FLAT' ? decimalToNumber(r.flat_rate) : null
        const threshold = decimalToNumber(r.free_threshold)
        const notes = [
          r.type === 'WEIGHT_BASED' ? 'Priced by the weight of the order, worked out at checkout.' : '',
          r.estimated_days?.trim() ? `Estimated ${r.estimated_days.trim()}${/day/i.test(r.estimated_days) ? '' : ' days'}.` : '',
        ].filter(Boolean)
        return {
          label: r.name, description: null, lo: flat, hi: flat, perUnit: false, productTax: false,
          daysLo: null, daysHi: null, note: notes.join(' ') || null,
          freeOver: threshold !== null && threshold > 0 ? threshold : null,
        }
      }),
      varying: [],
      perChild: new Map(),
    }
  } catch {
    return null
  }
}

function deliveryMarkdown(summary: ProductDeliverySummary, taxClassId: string | null, money: PriceView): string {
  if (summary.lines.length === 0) return ''
  const fmt = (n: number, line: DeliveryLine) => money.format(n, line.productTax ? taxClassId : null)
  const rows = summary.lines.map((line) => {
    let price = 'Worked out at checkout'
    if (line.lo !== null && line.hi !== null) {
      if (line.hi === 0) price = 'Free'
      else {
        const unit = line.perUnit ? ' per item' : ' per order'
        price = line.lo === line.hi
          ? `${fmt(line.lo, line)}${unit}`
          : `${line.lo === 0 ? 'Free' : fmt(line.lo, line)} to ${fmt(line.hi, line)}${unit}, by combination`
      }
    }
    const days = line.daysLo === null || line.daysHi === null
      ? ''
      : line.daysLo === line.daysHi
        ? `${line.daysHi} working day${line.daysHi === 1 ? '' : 's'}`
        : `${line.daysLo} to ${line.daysHi} working days`
    const freeOver = line.freeOver ? `Free on orders over ${money.format(line.freeOver, null)}.` : ''
    return [line.label, price, days, [line.description ?? '', freeOver, line.note ?? ''].filter(Boolean).join(' ')]
  })
  const anyDays = rows.some((r) => r[2])
  const headers = anyDays ? ['Service', 'Price', 'Delivery time', 'Details'] : ['Service', 'Price', 'Details']
  const body = table(headers, anyDays ? rows : rows.map((r) => [r[0]!, r[1]!, r[3]!]))
  const notes = [
    summary.lines.some((l) => l.perUnit && (l.hi ?? 0) > 0)
      ? 'Charges marked per item apply to every unit: two of the same product is twice the charge.'
      : '',
    summary.varying.length
      ? `The charge for each combination is in the Variations table${summary.varying.length === 1 ? '' : ', one column per service'}.`
      : '',
    anyDays
      ? 'Delivery times are working days from the order, with weekends and public holidays not counted. The product page and checkout show the exact date before payment.'
      : '',
  ].filter(Boolean).join(' ')
  return notes ? `${body}\n\n${notes}` : body
}

/** What a variant actually sells for: its sale price if it has one, else its price. */
function effectivePrice(row: { price: unknown; sale_price: unknown }): number | null {
  const sale = decimalToNumber(row.sale_price)
  if (sale !== null && sale > 0) return sale
  const price = decimalToNumber(row.price)
  return price !== null && price > 0 ? price : null
}

function productFacts(
  product: ProductRow,
  extras: ProductExtras,
  money: PriceView,
  publishSupplier: boolean,
): Array<{ label: string; value: string }> {
  const facts: Array<{ label: string; value: string }> = []
  const variants = extras.variants.get(product.id) ?? []

  // A listing whose combinations carry the money - which is most of them, and
  // every one on the site this was first run against - has a price of zero on
  // the parent row. Printed as it stands, every product in the catalogue reads
  // "£0.00", and an assistant quoting that is worse than one quoting nothing.
  const own = effectivePrice(product)
  if (own !== null) {
    const listPrice = decimalToNumber(product.price)
    const sale = decimalToNumber(product.sale_price)
    facts.push({
      label: 'Price',
      value: sale !== null && sale > 0 && listPrice !== null && listPrice > sale
        ? `${money.format(sale, product.tax_class_id)} (was ${money.format(listPrice, product.tax_class_id)})`
        : money.format(own, product.tax_class_id),
    })
  } else {
    const prices = variants.map(effectivePrice).filter((n): n is number => n !== null)
    if (prices.length > 0) {
      const low = Math.min(...prices)
      const high = Math.max(...prices)
      facts.push({
        label: 'Price',
        value: low === high
          ? money.format(low, product.tax_class_id)
          : `${money.format(low, product.tax_class_id)} to ${money.format(high, product.tax_class_id)}, by choice`,
      })
    }
  }

  if (product.sku) facts.push({ label: 'SKU', value: product.sku })
  // The same identifier the page's own structured data publishes as its GTIN.
  if (product.barcode?.trim()) facts.push({ label: 'GTIN', value: product.barcode.trim() })

  const reviews = extras.reviews.get(product.id) ?? []
  if (reviews.length > 0) {
    const average = reviews.reduce((n, r) => n + r.rating, 0) / reviews.length
    facts.push({ label: 'Rating', value: `${average.toFixed(1)} out of 5 (${reviews.length} review${reviews.length === 1 ? '' : 's'})` })
  }

  const options = extras.options.get(product.id) ?? []
  if (options.length > 0) {
    facts.push({ label: 'Options', value: options.map((o) => `${o.name} (${o.values.length})`).join(', ') })
  }

  const variantStock = variants.reduce((n, v) => n + (v.track_inventory ? (v.stock_count ?? 0) : 0), 0)
  const anyVariantMadeToOrder = variants.some((v) => !v.track_inventory)

  if (product.is_pre_order) {
    facts.push({ label: 'Availability', value: 'Available to pre-order' })
  } else if (variants.length > 0) {
    // The parent of a set of combinations holds no stock of its own; what is
    // available is whatever its combinations have.
    facts.push({
      label: 'Availability',
      value: variantStock > 0
        ? `In stock (${variantStock} across ${variants.length} combinations)`
        : anyVariantMadeToOrder ? 'Made to order' : 'Out of stock',
    })
  } else if (!product.track_inventory) {
    facts.push({ label: 'Availability', value: 'Made to order' })
  } else {
    const stock = product.stock_count ?? 0
    facts.push({
      label: 'Availability',
      value: stock > 0
        ? `In stock (${stock})`
        : product.out_of_stock_behaviour === 'BACKORDER' ? 'On backorder' : 'Out of stock',
    })
  }

  if (product.min_order_quantity && product.min_order_quantity > 1) {
    facts.push({ label: 'Minimum order', value: String(product.min_order_quantity) })
  }

  const modelledVariants = variants.filter((v) => extras.modelled.has(v.child_id)).length
  const baseModelled = extras.modelled.has(product.id)
  if (baseModelled || modelledVariants > 0) {
    // The question this whole flag exists to answer is "can I look at this
    // thing in 3D", so it says which of the two is true rather than just "yes".
    facts.push({
      label: '3D model',
      value: variants.length > 0
        ? `Yes - ${modelledVariants} of ${variants.length} variations${baseModelled ? ', plus the base product' : ''}`
        : 'Yes',
    })
  } else {
    facts.push({ label: '3D model', value: 'No' })
  }

  const photos = extras.photoCounts.get(product.id) ?? 0
  if (photos > 0) facts.push({ label: 'Photographs', value: String(photos) })
  if (publishSupplier && product.supplier) facts.push({ label: 'Supplier', value: product.supplier })

  return facts
}

/**
 * The same product, as values rather than as prose.
 *
 * Written from the same rows the prose is, in the same pass, so the two cannot
 * disagree: a price that appears in one and not the other is the kind of thing
 * that is only noticed when an assistant quotes the wrong one.
 */
function productFacets(product: ProductRow, extras: ProductExtras, money: PriceView): ProductFacets {
  const variants = extras.variants.get(product.id) ?? []
  const taxClass = product.tax_class_id

  // The listing's own price when it has one, else the spread across whatever a
  // buyer can actually choose - which for most catalogues is where the money is.
  const own = effectivePrice(product)
  const prices = own !== null
    ? [own]
    : variants.map(effectivePrice).filter((n): n is number => n !== null)
  const shown = prices
    .map((p) => money.amount(p, taxClass))
    .filter((n): n is number => n !== null)

  return {
    kind: 'product',
    currency: money.currency,
    priceMin: shown.length ? Math.min(...shown) : null,
    priceMax: shown.length ? Math.max(...shown) : null,
    priceSuffix: money.suffix,
    availability: productAvailability(product, variants),
    sku: product.sku,
    groups: productGroups(product, extras),
  }
}

/** Whether somebody can have this, in one word, on the same rules as the prose. */
function productAvailability(product: ProductRow, variants: VariantRow[]): ProductAvailability {
  if (product.is_pre_order) return 'pre-order'
  if (variants.length > 0) {
    const stock = variants.reduce((n, v) => n + (v.track_inventory ? (v.stock_count ?? 0) : 0), 0)
    if (stock > 0) return 'in-stock'
    return variants.some((v) => !v.track_inventory) ? 'made-to-order' : 'out-of-stock'
  }
  if (!product.track_inventory) return 'made-to-order'
  if ((product.stock_count ?? 0) > 0) return 'in-stock'
  return product.out_of_stock_behaviour === 'BACKORDER' ? 'backorder' : 'out-of-stock'
}

/**
 * Every shelf this sits on, as words somebody might actually use.
 *
 * Names AND slugs, lowercased: an agent narrowing a catalogue has read a page,
 * so it knows "office chairs"; it has not read the database, so it does not know
 * that the slug is `office-seating`. Matching either costs one array.
 */
function productGroups(product: ProductRow, extras: ProductExtras): string[] {
  const out = new Set<string>()
  for (const group of [...(extras.categories.get(product.id) ?? []), ...(extras.collections.get(product.id) ?? [])]) {
    const name = group.name.trim().toLowerCase()
    const slug = group.slug.trim().toLowerCase()
    if (name) out.add(name)
    if (slug) out.add(slug)
  }
  return [...out]
}

// ---------------------------------------------------------------------------
// Shop categories and collections, filter collections, directory entries
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Questions and answers
// ---------------------------------------------------------------------------

/**
 * Every FAQ set the batch could need, read once.
 *
 * Shop keeps them in three places - the product, the category chain above it,
 * and one shop-wide list - and the page shows all three merged. The twin showed
 * none of them, which made the single most quotable thing on a product page the
 * one thing an assistant reading the Markdown could not see: a shopper asking
 * "will it take my weight" gets an answer on the page and got a specification
 * table here.
 */
type FaqSources = {
  products: Map<string, AiFaqSet>
  categories: Map<string, AiFaqSet>
  collections: Map<string, AiFaqSet>
  shopWide: AiFaqItem[]
  /** The shop's master switch. Off means the page shows no questions at all. */
  enabled: boolean
}

const NO_FAQS: FaqSources = {
  products: new Map(), categories: new Map(), collections: new Map(), shopWide: [], enabled: false,
}

/** One table's `faqs` column for a batch of ids. */
async function faqColumn(
  tableName: 'shp_products' | 'shp_categories' | 'shp_collections',
  ids: string[],
): Promise<Map<string, AiFaqSet>> {
  if (ids.length === 0) return new Map()
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; faqs: unknown }>>`
      SELECT "id", "faqs" FROM ${Prisma.raw(`"${tableName}"`)}
      WHERE "id" IN (${Prisma.join(ids)}) AND "faqs" IS NOT NULL
    `
    return new Map(rows.map((r) => [r.id, normaliseFaqSet(r.faqs)]))
  } catch {
    // A shop from before the column existed. No questions is what its pages
    // show, and what its twins showed until now.
    return new Map()
  }
}

/** Every category's set, because a product inherits from a chain the batch does
 *  not name. Small on any real site - the same reason categoryTree reads whole. */
async function categoryFaqs(): Promise<Map<string, AiFaqSet>> {
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; faqs: unknown }>>`
      SELECT "id", "faqs" FROM "shp_categories" WHERE "faqs" IS NOT NULL
    `
    return new Map(rows.map((r) => [r.id, normaliseFaqSet(r.faqs)]))
  } catch {
    return new Map()
  }
}

async function shopWideFaqs(): Promise<{ items: AiFaqItem[]; enabled: boolean }> {
  try {
    const rows = await prisma.$queryRaw<Array<{ faqs: unknown; enabled: string | null }>>`
      SELECT "config" -> 'productFaqs'          AS faqs,
             "config" ->> 'productFaqsEnabled'  AS enabled
      FROM "shp_settings" WHERE "id" = 'singleton' LIMIT 1
    `
    const row = rows[0]
    if (!row) return { items: [], enabled: false }
    // Absent means on: the switch defaults to true in shop's own config, and a
    // shop that has never opened the setting is showing its questions.
    return { items: normaliseFaqItems(row.faqs), enabled: row.enabled !== 'false' }
  } catch {
    return { items: [], enabled: false }
  }
}

/** Every FAQ set the batch could need, in one round of queries. */
async function loadFaqs(opts: {
  productIds: string[]
  categoryIds: string[]
  collectionIds: string[]
  wantsCategoryChain: boolean
}): Promise<FaqSources> {
  const [products, collections, categories, wide] = await Promise.all([
    faqColumn('shp_products', opts.productIds),
    faqColumn('shp_collections', opts.collectionIds),
    opts.wantsCategoryChain || opts.categoryIds.length
      ? categoryFaqs()
      : Promise.resolve(new Map<string, AiFaqSet>()),
    shopWideFaqs(),
  ])
  return { products, categories, collections, shopWide: wide.items, enabled: wide.enabled }
}

/**
 * A category's own set then its parents', nearest first.
 *
 * Guarded against a cycle for the same reason categoryTrail is: `parent_id` is a
 * plain self-reference, and being wrong here is a rebuild that never returns.
 */
function categoryFaqChain(
  id: string | null,
  tree: Map<string, { id: string; parent_id: string | null }>,
  sets: Map<string, AiFaqSet>,
): AiFaqSet[] {
  const chain: AiFaqSet[] = []
  const seen = new Set<string>()
  let current = id ? tree.get(id) : undefined
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    chain.push(sets.get(current.id) ?? EMPTY_FAQ_SET)
    current = current.parent_id ? tree.get(current.parent_id) : undefined
  }
  return chain
}

/**
 * The merged questions for one page, as the nought-or-one sections it adds to
 * the twin. Nought when the shop has switched FAQs off, when nothing anywhere in
 * the chain asks a question, or when there is no shop installed at all.
 *
 * Returned as an array rather than a nullable section so the callers can spread
 * it into a section list without a filter at every site.
 */
function faqSections(
  sources: FaqSources,
  page: {
    own?: AiFaqSet | undefined
    categoryId?: string | null
    tree?: Map<string, { id: string; parent_id: string | null }>
  },
): DocumentSection[] {
  if (!sources.enabled) return []
  const ancestors = page.tree
    ? categoryFaqChain(page.categoryId ?? null, page.tree, sources.categories)
    : []
  const items = resolveFaqs({
    own: page.own ?? EMPTY_FAQ_SET,
    ancestors,
    shopWide: sources.shopWide,
  })
  const section = faqSection(items)
  return section ? [section] : []
}

type TaxonomyRow = {
  id: string
  description: string | null
  short_description: string | null
  description_puck: unknown
  og_image_id: string | null
}

async function taxonomyBodies(tableName: 'shp_categories' | 'shp_collections', ids: string[]): Promise<Map<string, TaxonomyRow>> {
  const rows = await prisma.$queryRaw<TaxonomyRow[]>`
    SELECT "id", "description", "short_description", "description_puck", "og_image_id"
    FROM ${Prisma.raw(`"${tableName}"`)}
    WHERE "id" IN (${Prisma.join(ids)})
  `
  return new Map(rows.map((r) => [r.id, r]))
}

async function taxonomyProducts(
  join: 'shp_product_categories' | 'shp_product_collections',
  column: 'category_id' | 'collection_id',
  ids: string[],
  atRoot: boolean,
  hasVariations: boolean,
): Promise<Map<string, Array<{ name: string; path: string; price: unknown; taxClassId: string | null }>>> {
  // The listed price, falling back to the cheapest of a listing's combinations
  // when the parent row carries none - see productFacts for why that is the
  // normal case. Only asked when shop-variations is installed: on a site
  // without it the svr_ tables do not exist and naming them fails the query.
  const priceExpr = hasVariations
    ? Prisma.raw(`COALESCE(NULLIF(p."price", 0), (
        SELECT MIN(COALESCE(NULLIF(child."sale_price", 0), NULLIF(child."price", 0)))
        FROM "svr_variants" v JOIN "shp_products" child ON child."id" = v."child_product_id"
        WHERE v."product_id" = p."id" AND v."enabled" = true
      ))`)
    : Prisma.raw('p."price"')
  // Capped per taxonomy row for the same reason variations are: a category with
  // eight hundred products in it is an index, not a document, and the sitemap
  // already lists every one of them.
  const rows = await prisma.$queryRaw<Array<{ owner_id: string; name: string; slug: string; price: unknown; tax_class_id: string | null; rank: bigint }>>`
    SELECT owner_id, name, slug, price, tax_class_id, rank FROM (
      SELECT j.${Prisma.raw(`"${column}"`)} AS owner_id, p."name", p."slug", ${priceExpr} AS price, p."tax_class_id",
             ROW_NUMBER() OVER (PARTITION BY j.${Prisma.raw(`"${column}"`)} ORDER BY p."popularity" DESC NULLS LAST, p."name" ASC) AS rank
      FROM ${Prisma.raw(`"${join}"`)} j
      JOIN "shp_products" p ON p."id" = j."product_id"
      WHERE j.${Prisma.raw(`"${column}"`)} IN (${Prisma.join(ids)})
        AND p."catalogue_hidden" = false AND p."status" = 'ACTIVE'
    ) ranked
    WHERE rank <= 100
  `
  const byOwner = groupBy(rows, (r) => r.owner_id)
  const out = new Map<string, Array<{ name: string; path: string; price: unknown; taxClassId: string | null }>>()
  for (const [ownerId, products] of byOwner) {
    out.set(ownerId, products.map((p) => ({
      name: p.name,
      path: atRoot ? p.slug : `shop/products/${p.slug}`,
      price: p.price,
      taxClassId: p.tax_class_id,
    })))
  }
  return out
}

/** The same products, as the table that goes in the Markdown twin. */
function productTable(
  products: Array<{ name: string; path: string; price: unknown; taxClassId: string | null }> | undefined,
  money: PriceView,
): string {
  if (!products || products.length === 0) return ''
  return table(['Product', 'Price'], products.map((p) => [
    link(p.name, `/${p.path}`),
    money.format(p.price, p.taxClassId) || 'On request',
  ]))
}

async function filterCollectionBodies(ids: string[]): Promise<Map<string, { body: string; image: string | null }>> {
  const rows = await prisma.$queryRaw<Array<{ id: string; intro_puck: unknown; short_description: string | null; og_image: string | null }>>`
    SELECT "id", "intro_puck", "short_description", "og_image" FROM "flt_collections" WHERE "id" IN (${Prisma.join(ids)})
  `
  // og_image on this table is a URL, not a media id - see lib/inventory.ts.
  return new Map(rows.map((r) => [r.id, { body: bodyMarkdown(r.intro_puck, r.short_description), image: r.og_image }]))
}

type DirectoryRow = {
  id: string
  description: string | null
  short_description: string | null
  address: string | null
  area: string | null
  phone: string | null
  email: string | null
  website: string | null
  category_name: string | null
  category_slug: string | null
}

async function directoryBodies(ids: string[]): Promise<Map<string, DirectoryRow>> {
  const rows = await prisma.$queryRaw<DirectoryRow[]>`
    SELECT e."id", e."description", e."short_description", e."address", e."area",
           e."phone", e."email", e."website",
           c."name" AS category_name, c."slug" AS category_slug
    FROM "dir_entries" e LEFT JOIN "dir_categories" c ON c."id" = e."category_id"
    WHERE e."id" IN (${Prisma.join(ids)})
  `
  return new Map(rows.map((r) => [r.id, r]))
}

// ---------------------------------------------------------------------------
// The one entry point
// ---------------------------------------------------------------------------

export type BuildContext = {
  siteUrl: string
  /** Whether a module is installed. Passed in so the caller asks the Module table once. */
  hasModule: (name: string) => boolean
  /** Owner-written abstracts, keyed "entityType:entityId". */
  abstracts: Map<string, string>
  /** Whether the shop serves products off the site root. */
  productsAtRoot: boolean
  /** Whether the gazette serves its posts off the site root. */
  postsAtRoot: boolean
  /** Whether a product's twin may name the supplier behind it. */
  publishSupplier: boolean
}

/**
 * Markdown twins for a batch of inventory items, and the facts each page's
 * structured data is built from.
 *
 * The batch is expected to be one content type's worth or fewer - the caller
 * chunks - and every query below is scoped to it.
 */
export async function buildDocuments(items: InventoryItem[], ctx: BuildContext): Promise<BuiltDocument[]> {
  if (items.length === 0) return []

  const byType = groupBy(items, (i) => i.entityType)
  const productIds = (byType.get('shop-product') ?? []).map((i) => i.entityId)
  const categoryIds = (byType.get('shop-category') ?? []).map((i) => i.entityId)
  const collectionIds = (byType.get('shop-collection') ?? []).map((i) => i.entityId)
  const [money, faqs] = await Promise.all([
    shopPriceConfig().then(priceView),
    // Skipped outright on a batch with no shop content in it. A page or a blog
    // post has no FAQ set to read, and a batch of them should not pay for four
    // queries to be told so.
    productIds.length || categoryIds.length || collectionIds.length
      ? loadFaqs({ productIds, categoryIds, collectionIds, wantsCategoryChain: productIds.length > 0 })
      : Promise.resolve(NO_FAQS),
  ])
  const out: BuiltDocument[] = []

  const compose = (
    item: InventoryItem,
    sections: DocumentSection[],
    facts?: Array<{ label: string; value: string }>,
    page?: Partial<PageFacts>,
    facets: DocumentFacets | null = null,
  ) => {
    const abstract = ctx.abstracts.get(`${item.entityType}:${item.entityId}`) ?? null
    const summary = oneLine(abstract) ?? oneLine(item.metaDescription)
    const path = pathOf(item.url)
    const markdown = renderDocument({
      title: item.title,
      summary,
      url: `${ctx.siteUrl}${item.url}`,
      kind: ENTITY_KIND_LABEL[item.entityType],
      updatedAt: item.updatedAt ? new Date(item.updatedAt) : null,
      facts,
    }, sections)
    out.push({
      entityType: item.entityType,
      entityId: item.entityId,
      path,
      title: item.title,
      summary,
      markdown,
      sourceUpdatedAt: item.updatedAt ? new Date(item.updatedAt) : null,
      pageFacts: {
        kind: item.entityType,
        title: item.title,
        description: summary,
        // The home page is its own root: a trail reading "Home > Home" is not a
        // trail, and buildPageJsonLd drops anything shorter than two steps.
        breadcrumb: path === 'index' ? [HOME] : [HOME, { name: item.title, path }],
        updatedAt: item.updatedAt,
        ...page,
      },
      facets,
    })
  }

  const corePages = byType.get('core-page') ?? []
  if (corePages.length) {
    const bodies = await corePageBodies(corePages.map((i) => i.entityId))
    for (const item of corePages) {
      compose(item, [{ heading: 'Content', body: bodies.get(item.entityId) ?? '' }])
    }
  }

  const posts = byType.get('gazette-post') ?? []
  if (posts.length) {
    const bodies = await gazetteBodies(posts.map((i) => i.entityId))
    const images = await mediaUrls([...bodies.values()].map((b) => b.row.featured_image_id ?? ''))
    for (const item of posts) {
      const built = bodies.get(item.entityId)
      const path = pathOf(item.url)
      compose(item, built?.sections ?? [], undefined, {
        // A post served off the site root has no /gazette step above it, because
        // there is no /gazette page for that step to point at.
        breadcrumb: ctx.postsAtRoot
          ? [HOME, { name: item.title, path }]
          : [HOME, { name: 'Blog', path: 'gazette' }, { name: item.title, path }],
        image: built?.row.featured_image_id ? images.get(built.row.featured_image_id) ?? null : null,
        publishedAt: built?.row.published_at ? built.row.published_at.toISOString() : null,
        author: built?.row.author_name ?? null,
      })
    }
  }

  const products = byType.get('shop-product') ?? []
  if (products.length) {
    const ids = products.map((i) => i.entityId)
    const [rows, extras, tree] = await Promise.all([
      prisma.$queryRaw<ProductRow[]>`
        SELECT "id", "master_category_id", "sku", "supplier_sku", "barcode", "price", "sale_price", "track_inventory",
               "stock_count", "out_of_stock_behaviour", "is_pre_order", "min_order_quantity",
               "short_description", "description", "description_puck", "weight", "weight_unit",
               "dimension_l", "dimension_w", "dimension_h", "dimension_unit", "supplier", "tax_class_id"
        FROM "shp_products" WHERE "id" IN (${Prisma.join(ids)})
      `,
      loadProductExtras(ids, ctx.hasModule),
      categoryTree().catch(() => new Map()),
    ])
    const byId = new Map(rows.map((r) => [r.id, r]))

    // Delivery for the listings AND their combinations, in one ask: a listing
    // whose delivery is set on its variations answers nothing on its own.
    const childIds = [...extras.variants.values()].flat().map((v) => v.child_id)
    const timing = await deliveryTiming([...ids, ...childIds])
    // Only a shop with no per-product delivery module falls back to its own
    // order-level rates. Where one IS installed and a product is absent from its
    // answer, the honest thing to print is nothing.
    const shopRates = timing === null ? await shopShippingRates() : null
    const productPath = (slug: string) => (ctx.productsAtRoot ? slug : `shop/products/${slug}`)

    for (const item of products) {
      const product = byId.get(item.entityId)
      if (!product) continue
      // The master category when the shop has been told one, else the first the
      // product is filed under - which is the order the product page itself
      // uses for its own heading.
      const categoryId = product.master_category_id ?? extras.categories.get(product.id)?.[0]?.id ?? null
      const trail = categoryId ? categoryTrail(categoryId, tree) : [HOME]
      const delivery = timing
        ? summariseDelivery(product.id, (extras.variants.get(product.id) ?? []).map((v) => v.child_id), timing)
        : shopRates
      compose(
        item,
        [
          ...productSections(product, extras, money, delivery, productPath),
          ...faqSections(faqs, { own: faqs.products.get(product.id), categoryId, tree }),
        ],
        productFacts(product, extras, money, ctx.publishSupplier),
        { breadcrumb: [...trail, { name: item.title, path: pathOf(item.url) }] },
        productFacets(product, extras, money),
      )
    }
  }

  for (const [type, tableName, join, column] of [
    ['shop-category', 'shp_categories', 'shp_product_categories', 'category_id'],
    ['shop-collection', 'shp_collections', 'shp_product_collections', 'collection_id'],
  ] as const) {
    const rows = byType.get(type) ?? []
    if (rows.length === 0) continue
    const ids = rows.map((i) => i.entityId)
    const [bodies, products, tree] = await Promise.all([
      taxonomyBodies(tableName, ids),
      taxonomyProducts(join, column, ids, ctx.productsAtRoot, ctx.hasModule('shop-variations')),
      type === 'shop-category' ? categoryTree().catch(() => new Map()) : Promise.resolve(new Map()),
    ])
    const images = await mediaUrls([...bodies.values()].map((b) => b.og_image_id ?? ''))
    for (const item of rows) {
      const row = bodies.get(item.entityId)
      const listed = products.get(item.entityId)
      compose(item, [
        { heading: 'About', body: row ? bodyMarkdown(row.description_puck, row.description ?? row.short_description) : '' },
        { heading: 'Products', body: productTable(listed, money) },
        // A category inherits up its own chain; a collection is a flat set, so
        // its own questions are the only level below the shop-wide list.
        ...faqSections(faqs, type === 'shop-category'
          ? { categoryId: item.entityId, tree }
          : { own: faqs.collections.get(item.entityId) }),
      ], undefined, {
        // A category knows where it sits; a collection is a flat set with no
        // parent to name, so its trail is Home and itself.
        breadcrumb: type === 'shop-category'
          ? categoryTrail(item.entityId, tree)
          : [HOME, { name: item.title, path: pathOf(item.url) }],
        image: row?.og_image_id ? images.get(row.og_image_id) ?? null : null,
        items: (listed ?? []).map((p) => ({ name: p.name, path: p.path })),
      })
    }
  }

  const filterCollections = byType.get('filter-collection') ?? []
  if (filterCollections.length) {
    const bodies = await filterCollectionBodies(filterCollections.map((i) => i.entityId))
    for (const item of filterCollections) {
      const row = bodies.get(item.entityId)
      compose(item, [{ heading: 'About', body: row?.body ?? '' }], undefined, {
        image: row?.image ?? null,
        // Deliberately no item list: what a filter page shows is decided by
        // running the filter engine, and this module does not import another
        // module's code to find out.
      })
    }
  }

  const directory = byType.get('directory-entry') ?? []
  if (directory.length) {
    const bodies = await directoryBodies(directory.map((i) => i.entityId))
    for (const item of directory) {
      const row = bodies.get(item.entityId)
      const contact = row
        ? bulletList([
          row.address ? `Address: ${row.address}` : '',
          row.area ? `Area: ${row.area}` : '',
          row.phone ? `Telephone: ${row.phone}` : '',
          row.email ? `Email: ${row.email}` : '',
          row.website ? `Website: ${row.website}` : '',
        ])
        : ''
      compose(item, [
        { heading: 'About', body: row ? bodyMarkdown(null, row.description ?? row.short_description) : '' },
        { heading: 'Contact', body: contact },
      ], undefined, {
        breadcrumb: [
          HOME,
          { name: 'Directory', path: 'directory' },
          ...(row?.category_name && row.category_slug
            ? [{ name: row.category_name, path: `directory/${row.category_slug}` }]
            : []),
          { name: item.title, path: pathOf(item.url) },
        ],
        telephone: row?.phone ?? null,
        email: row?.email ?? null,
        address: row?.address ?? null,
        website: row?.website ?? null,
      })
    }
  }

  return out
}
