-- Ultimate SEO - the commerce half of the AI answer: the facts an assistant
-- needs to filter a catalogue rather than read it.
--
-- A new numbered file rather than an edit to an earlier one: run-module-migrations
-- records applied files per module and never re-runs one it has already seen, so
-- an in-place edit reaches fresh installs only. All DDL idempotent, as ever.

-- The structured half of a Markdown twin: price, stock, and what the thing is
-- filed under. The twin itself is prose, and prose cannot answer "office chairs
-- under £250 that are in stock" without the reader fetching all four hundred of
-- them and doing the arithmetic itself - which is the point at which it gives up
-- and recommends somebody else.
--
-- On the same row as the twin rather than in a table of its own, for the same
-- reason "page_facts" is: it is built from the same source in the same pass, and
-- a second table is a second thing to keep in step.
--
-- Shape, for a product (null for everything else):
-- {
--   "kind": "product",
--   "currency": "GBP",
--   "priceMin": 335, "priceMax": 381,   -- as the storefront PRINTS them
--   "priceSuffix": "ex VAT",            -- the shop's own wording, or ""
--   "availability": "in-stock" | "made-to-order" | "pre-order" | "backorder" | "out-of-stock",
--   "sku": "ZUR-…",
--   "groups": ["office chairs", "office-chairs", …]  -- category and collection
--                                                      names AND slugs, lowercased
-- }
ALTER TABLE "seo_llm_documents" ADD COLUMN IF NOT EXISTS "facets" JSONB;

-- The three shapes find_products asks in: narrow to products, order by price,
-- and test membership of a group. The price expression is indexed rather than
-- the whole column because a range scan over it is the one that would otherwise
-- read every product row on a catalogue of any size.
CREATE INDEX IF NOT EXISTS "seo_llm_documents_facet_price_idx"
    ON "seo_llm_documents" ((("facets" ->> 'priceMin')::numeric))
    WHERE "facets" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "seo_llm_documents_facets_idx"
    ON "seo_llm_documents" USING GIN ("facets" jsonb_path_ops);
