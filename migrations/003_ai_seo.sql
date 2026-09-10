-- Ultimate SEO - the AI half: llms.txt, the Markdown twin of every page, AI
-- crawler policy, AI referral analytics, per-entity abstracts and the read-only
-- MCP endpoint.
--
-- A new numbered file rather than an edit to 001 or 002: run-module-migrations
-- records applied files per module and never re-runs one it has already seen,
-- so an in-place edit reaches fresh installs only and leaves every live site
-- without the columns. All DDL idempotent, as ever.

-- Everything the owner switches on or off for AI readers, in one JSONB column
-- for the same reason "structured_data" is one:
-- {
--   siteSummary, llmsTxt, llmsFull, markdown, markdownTypes: string[],
--   abstracts, analytics, analyticsRetentionDays, mcp, mcpMaxResults,
--   crawlerPolicy: { [botKey]: 'allow' | 'block' },
--   contentSignals: { search, aiInput, aiTrain }   -- each yes | no | unset
-- }
ALTER TABLE "seo_settings" ADD COLUMN IF NOT EXISTS "ai" JSONB;

-- The short, answer-shaped summary an owner writes for one page, product or
-- post. It goes at the top of that page's Markdown twin and into its line in
-- llms.txt, which is the only place a model with no room for the whole document
-- will read. Lives on the existing per-entity table rather than a new one: it is
-- one more thing this module knows about an entity, exactly like a focus keyword.
ALTER TABLE "seo_page_meta" ADD COLUMN IF NOT EXISTS "ai_abstract" TEXT;

-- The Markdown twins, built ahead of time rather than on each request.
--
-- A catalogue of twenty thousand products rendered to Markdown per request is a
-- bill, not a feature: every fetch would re-read the product, its variants, its
-- attributes and its images. So the documents are built by the weekly job and
-- whenever their source is edited, and the public routes do one indexed read.
CREATE TABLE IF NOT EXISTS "seo_llm_documents" (
    "id"                TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    -- Matches seo_page_meta: 'core-page' | 'gazette-post' | 'shop-product' | …
    "entity_type"       TEXT         NOT NULL,
    "entity_id"         TEXT         NOT NULL,
    -- The public address WITHOUT its leading slash and without the .md suffix,
    -- so '' is the homepage and 'shop/products/task-chair' is a product. This is
    -- what the .md route looks the document up by.
    "path"              TEXT         NOT NULL,
    "title"             TEXT         NOT NULL,
    -- One line for the entity's line in llms.txt. Not the whole document.
    "summary"           TEXT,
    "markdown"          TEXT         NOT NULL,
    "byte_size"         INTEGER      NOT NULL DEFAULT 0,
    -- When the SOURCE content last changed, so a rebuild can skip what has not
    -- moved and Last-Modified can tell the truth.
    "source_updated_at" TIMESTAMP(3),
    "built_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seo_llm_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "seo_llm_documents_entity_unique" UNIQUE ("entity_type", "entity_id")
);

-- One document per address. A product moved to the site root and an info page
-- claiming the same slug cannot both answer at it, and the twin must not be the
-- place that ambiguity first shows up.
CREATE UNIQUE INDEX IF NOT EXISTS "seo_llm_documents_path_key" ON "seo_llm_documents" ("path");
CREATE INDEX IF NOT EXISTS "seo_llm_documents_type_idx" ON "seo_llm_documents" ("entity_type");

-- AI crawler visits and AI-assistant referrals, counted per day.
--
-- Deliberately a running count rather than a row per request: a busy site would
-- otherwise write a million rows a month to answer a question ("is anything
-- citing us?") that only ever gets asked by the day. The unique key is what
-- makes the upsert an increment.
CREATE TABLE IF NOT EXISTS "seo_ai_hits" (
    "id"        TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "day"       DATE         NOT NULL,
    -- 'crawler' - a bot fetched a page; 'referral' - a person arrived from an
    -- AI assistant's answer. The second is the one owners actually want.
    "kind"      TEXT         NOT NULL,
    -- The bot key or the referring assistant: 'gptbot', 'claudebot', 'chatgpt', …
    "agent"     TEXT         NOT NULL,
    "path"      TEXT         NOT NULL,
    "hits"      INTEGER      NOT NULL DEFAULT 0,
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seo_ai_hits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "seo_ai_hits_kind_check" CHECK ("kind" IN ('crawler','referral')),
    CONSTRAINT "seo_ai_hits_unique" UNIQUE ("day", "kind", "agent", "path")
);

CREATE INDEX IF NOT EXISTS "seo_ai_hits_day_idx" ON "seo_ai_hits" ("day" DESC);
