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
import type { BreadcrumbStep, PageFacts } from './json-ld'
import type { EntityType, InventoryItem } from '../types'

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
}

/** How each content type is described to a reader that has never seen the site. */
export const ENTITY_KIND_LABEL: Record<EntityType, string> = {
  'core-page': 'Page',
  'gazette-post': 'Blog post',
  'shop-product': 'Product',
  'shop-category': 'Product category',
  'shop-collection': 'Product collection',
  'filter-collection': 'Product collection',
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

function moneyFormatter(currency: string): (value: unknown) => string {
  let format: Intl.NumberFormat
  try {
    format = new Intl.NumberFormat('en-GB', { style: 'currency', currency })
  } catch {
    // An unrecognised currency code would throw here and take the whole rebuild
    // with it. Falling back to plain numbers loses the symbol and nothing else.
    format = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return (value: unknown) => {
    const n = decimalToNumber(value)
    return n === null ? '' : format.format(n)
  }
}

async function shopCurrency(): Promise<string> {
  try {
    const rows = await prisma.$queryRaw<Array<{ currency: string | null }>>`
      SELECT "config" ->> 'currency' AS currency FROM "shp_settings" WHERE "id" = 'singleton' LIMIT 1
    `
    const code = rows[0]?.currency?.trim().toUpperCase()
    return code && /^[A-Z]{3}$/.test(code) ? code : 'GBP'
  } catch {
    return 'GBP'
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
}

type ProductExtras = {
  categories: Map<string, Array<{ id: string; name: string; slug: string }>>
  collections: Map<string, Array<{ id: string; name: string; slug: string }>>
  attributes: Map<string, Array<{ attribute: string; value: string }>>
  variants: Map<string, VariantRow[]>
  /** Product ids - parents and variant children alike - that have a 3D model. */
  modelled: Set<string>
  photoCounts: Map<string, number>
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
  options: string | null
}

async function loadProductExtras(ids: string[], hasModule: (name: string) => boolean): Promise<ProductExtras> {
  const empty: ProductExtras = {
    categories: new Map(), collections: new Map(), attributes: new Map(),
    variants: new Map(), modelled: new Set(), photoCounts: new Map(),
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
    categories: groupBy(categories, (r) => r.product_id),
    collections: groupBy(collections, (r) => r.product_id),
    attributes: new Map(),
    variants: new Map(),
    modelled: new Set(),
    photoCounts: new Map(photos.map((p) => [p.product_id, Number(p.count)])),
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
               child."stock_count", child."track_inventory",
               (
                 SELECT string_agg(ov."label", ', ' ORDER BY o."position" ASC)
                 FROM "svr_variant_values" vv
                 JOIN "svr_option_values" ov ON ov."id" = vv."option_value_id"
                 JOIN "svr_options" o ON o."id" = ov."option_id"
                 WHERE vv."variant_id" = v."id"
               ) AS options
        FROM "svr_variants" v
        JOIN "shp_products" child ON child."id" = v."child_product_id"
        WHERE v."product_id" IN (${Prisma.join(ids)}) AND v."enabled" = true
        ORDER BY v."position" ASC
      `
      extras.variants = groupBy(variants, (v) => v.parent_id)
      childIds = variants.map((v) => v.child_id)
    } catch {
      // Module present but mid-migration: a document without its variations is
      // worth more than no document.
    }
  }

  if (hasModule('product-attributes-for-shop')) {
    try {
      const rows = await prisma.$queryRaw<Array<{ product_id: string; attribute: string; value: string }>>`
        SELECT pv."product_id", a."name" AS attribute, av."label" AS value
        FROM "pat_product_values" pv
        JOIN "pat_attribute_values" av ON av."id" = pv."value_id"
        JOIN "pat_attributes" a ON a."id" = av."attribute_id"
        WHERE pv."product_id" IN (${Prisma.join(ids)})
        ORDER BY a."position" ASC, a."name" ASC, av."position" ASC
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

// Deliberately capped. A listing with four hundred combinations turns its twin
// into a wall of table rows that pushes the description out of any context
// window it lands in, and the first fifty say everything the next three hundred
// and fifty repeat.
const MAX_VARIANTS_LISTED = 50

function productSections(
  product: ProductRow,
  extras: ProductExtras,
  money: (v: unknown) => string,
): DocumentSection[] {
  const sections: DocumentSection[] = []

  const body = bodyMarkdown(product.description_puck, product.description)
  if (body) sections.push({ heading: 'Description', body })

  const variants = extras.variants.get(product.id) ?? []
  if (variants.length > 0) {
    const rows = variants.slice(0, MAX_VARIANTS_LISTED).map((v) => [
      v.options?.trim() || v.name,
      v.sku ?? '',
      money(effectivePrice(v)),
      v.track_inventory ? String(v.stock_count ?? 0) : 'Made to order',
      extras.modelled.has(v.child_id) ? 'Yes' : 'No',
    ])
    const more = variants.length > MAX_VARIANTS_LISTED
      ? `\n\n${variants.length - MAX_VARIANTS_LISTED} further combinations are available on the page itself.`
      : ''
    sections.push({
      heading: 'Variations',
      body: `${table(['Choice', 'SKU', 'Price', 'Stock', '3D model'], rows)}${more}`,
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
  money: (v: unknown) => string,
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
        ? `${money(sale)} (was ${money(listPrice)})`
        : money(own),
    })
  } else {
    const prices = variants.map(effectivePrice).filter((n): n is number => n !== null)
    if (prices.length > 0) {
      const low = Math.min(...prices)
      const high = Math.max(...prices)
      facts.push({
        label: 'Price',
        value: low === high ? money(low) : `${money(low)} to ${money(high)}, by choice`,
      })
    }
  }

  if (product.sku) facts.push({ label: 'SKU', value: product.sku })

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
  if (product.supplier) facts.push({ label: 'Supplier', value: product.supplier })

  return facts
}

// ---------------------------------------------------------------------------
// Shop categories and collections, filter collections, directory entries
// ---------------------------------------------------------------------------

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
): Promise<Map<string, Array<{ name: string; path: string; price: unknown }>>> {
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
  const rows = await prisma.$queryRaw<Array<{ owner_id: string; name: string; slug: string; price: unknown; rank: bigint }>>`
    SELECT owner_id, name, slug, price, rank FROM (
      SELECT j.${Prisma.raw(`"${column}"`)} AS owner_id, p."name", p."slug", ${priceExpr} AS price,
             ROW_NUMBER() OVER (PARTITION BY j.${Prisma.raw(`"${column}"`)} ORDER BY p."popularity" DESC NULLS LAST, p."name" ASC) AS rank
      FROM ${Prisma.raw(`"${join}"`)} j
      JOIN "shp_products" p ON p."id" = j."product_id"
      WHERE j.${Prisma.raw(`"${column}"`)} IN (${Prisma.join(ids)})
        AND p."catalogue_hidden" = false AND p."status" = 'ACTIVE'
    ) ranked
    WHERE rank <= 100
  `
  const byOwner = groupBy(rows, (r) => r.owner_id)
  const out = new Map<string, Array<{ name: string; path: string; price: unknown }>>()
  for (const [ownerId, products] of byOwner) {
    out.set(ownerId, products.map((p) => ({
      name: p.name,
      path: atRoot ? p.slug : `shop/products/${p.slug}`,
      price: p.price,
    })))
  }
  return out
}

/** The same products, as the table that goes in the Markdown twin. */
function productTable(
  products: Array<{ name: string; path: string; price: unknown }> | undefined,
  money: (v: unknown) => string,
): string {
  if (!products || products.length === 0) return ''
  return table(['Product', 'Price'], products.map((p) => [
    link(p.name, `/${p.path}`),
    money(p.price) || 'On request',
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
  const money = moneyFormatter(await shopCurrency())
  const out: BuiltDocument[] = []

  const compose = (
    item: InventoryItem,
    sections: DocumentSection[],
    facts?: Array<{ label: string; value: string }>,
    page?: Partial<PageFacts>,
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
               "dimension_l", "dimension_w", "dimension_h", "dimension_unit", "supplier"
        FROM "shp_products" WHERE "id" IN (${Prisma.join(ids)})
      `,
      loadProductExtras(ids, ctx.hasModule),
      categoryTree().catch(() => new Map()),
    ])
    const byId = new Map(rows.map((r) => [r.id, r]))
    for (const item of products) {
      const product = byId.get(item.entityId)
      if (!product) continue
      // The master category when the shop has been told one, else the first the
      // product is filed under - which is the order the product page itself
      // uses for its own heading.
      const categoryId = product.master_category_id ?? extras.categories.get(product.id)?.[0]?.id ?? null
      const trail = categoryId ? categoryTrail(categoryId, tree) : [HOME]
      compose(item, productSections(product, extras, money), productFacts(product, extras, money), {
        breadcrumb: [...trail, { name: item.title, path: pathOf(item.url) }],
      })
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
