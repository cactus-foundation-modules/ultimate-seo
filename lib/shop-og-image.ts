// Which shop category and collection pages actually publish a social image.
//
// Reading `og_image_id` alone was true when neither page emitted `openGraph` at
// all, and stopped being true with shop 0.1.267: both pages now fall back the
// way the product page does, so a page with no dedicated social image still
// publishes one. Reading the column alone would report every category and
// collection on every shop as having none - the same mistake `shopProducts()`
// already carries a comment about.
//
// Mirrors shop's lib/catalogue-social-image.ts:
//   category   - og_image_id, else its own image_url, else a photograph from
//                the products it lists
//   collection - og_image_id, else image_id, else a photograph from the
//                products on the shelf
//
// Raw SQL against shop's tables, never an import of shop's code - this module
// works identically whether or not shop is installed, and the caller has
// already checked that it is.
//
// Two deliberate differences from shop's own answer, both harmless here:
//   - shop scans the first twelve products it would list and takes the first
//     with a photograph; this asks whether ANY listed product has one. The two
//     disagree only where twelve consecutive listed products are photoless and
//     a later one is not, which would be a stranger catalogue than any real
//     shop.
//   - shop's listing also applies the shop's out-of-stock hiding, which lives
//     behind shop's own code and a request scope. A category whose only
//     photographed products are all hidden for being sold out would be counted
//     here and not there.
// A dangling `og_image_id` (pointing at a media row since deleted) counts as an
// image here and resolves to none in shop; that is a broken picture everywhere
// else on the site too, not something this screen should be the one to notice.
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

// Restrict to these ids, or every row when null.
function idFilter(column: Prisma.Sql, ids: string[] | null): Prisma.Sql {
  return ids ? Prisma.sql`${column} = ANY(${ids}::text[])` : Prisma.sql`TRUE`
}

// The shop-wide default for what a category page lists, straight out of shop's
// settings singleton. 'rollup' is shop's own default when the key is unset.
const DEFAULT_DISPLAY_MODE = Prisma.sql`
  COALESCE(NULLIF(
    (SELECT "config"->>'categoryProductDisplayMode' FROM "shp_settings" WHERE "id" = 'singleton'),
    ''
  ), 'rollup')
`

export async function shopCategoriesWithSocialImage(ids: string[] | null): Promise<Set<string>> {
  // The subtree closure is built for every category rather than only the ones
  // asked about: the recursive term has to walk down from each root anyway, and
  // both callers ask about the whole table or most of it.
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH RECURSIVE sub AS (
      SELECT "id" AS root, "id" FROM "shp_categories"
      UNION
      SELECT s.root, c."id" FROM "shp_categories" c JOIN sub s ON c."parent_id" = s."id"
    )
    SELECT cat."id"
      FROM "shp_categories" cat
     WHERE ${idFilter(Prisma.sql`cat."id"`, ids)}
       AND (
         cat."og_image_id" IS NOT NULL
         OR cat."image_url" IS NOT NULL
         OR EXISTS (
           SELECT 1
             FROM sub s
             JOIN "shp_product_categories" pc ON pc."category_id" = s."id"
             JOIN "shp_products" p ON p."id" = pc."product_id"
                  AND p."status" = 'ACTIVE' AND p."catalogue_hidden" = false
             JOIN "shp_product_media" m ON m."product_id" = p."id" AND m."type" = 'IMAGE'
            WHERE s.root = cat."id"
              -- An 'exact' category lists only what is filed directly on it, so
              -- a descendant's photograph is not on its page to borrow.
              AND (COALESCE(cat."product_display_mode", ${DEFAULT_DISPLAY_MODE}) = 'rollup' OR s."id" = cat."id")
         )
       )
  `
  return new Set(rows.map((r) => r.id))
}

export async function shopCollectionsWithSocialImage(ids: string[] | null): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT col."id"
      FROM "shp_collections" col
     WHERE ${idFilter(Prisma.sql`col."id"`, ids)}
       AND (
         col."og_image_id" IS NOT NULL
         OR col."image_id" IS NOT NULL
         OR EXISTS (
           SELECT 1
             FROM "shp_product_collections" pc
             JOIN "shp_products" p ON p."id" = pc."product_id"
                  AND p."status" = 'ACTIVE' AND p."catalogue_hidden" = false
             JOIN "shp_product_media" m ON m."product_id" = p."id" AND m."type" = 'IMAGE'
            WHERE pc."collection_id" = col."id"
         )
       )
  `
  return new Set(rows.map((r) => r.id))
}
