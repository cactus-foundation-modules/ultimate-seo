-- Ultimate SEO module - initial schema.
-- All DDL idempotent: run-module-migrations.mjs may re-apply after a DB restore.

-- Singleton settings row (mirrors the core SiteConfig singleton pattern).
CREATE TABLE IF NOT EXISTS "seo_settings" (
    "id"                    TEXT         NOT NULL DEFAULT 'singleton',
    -- Organisation structured data emitted by the SeoStructuredData block presets
    -- and used as suggestion context: { name, legalName, logoUrl, sameAs: string[] }
    "organization"          JSONB,
    -- Social identity: { twitterHandle }
    "social"                JSONB,
    -- Analysis targets and crawler limits:
    -- { titleMin, titleMax, descMin, descMax, densityMin, densityMax, auditMaxPages }
    "targets"               JSONB,
    "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seo_settings_pkey" PRIMARY KEY ("id")
);

-- Per-entity SEO working data (focus keyword, latest analysis result).
-- entity_type: 'core-page' | 'gazette-post' | 'shop-product' | 'directory-entry'
-- entity_id:   the source row's id in its own table (no FK - source tables
--              belong to other modules/core and may not exist on this install).
CREATE TABLE IF NOT EXISTS "seo_page_meta" (
    "id"                    TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "entity_type"           TEXT         NOT NULL,
    "entity_id"             TEXT         NOT NULL,
    "focus_keyword"         TEXT,
    "notes"                 TEXT,
    "score"                 INTEGER,
    -- Latest analysis checks: [{ key, status: 'pass'|'warn'|'fail', message, suggestion? }]
    "checks"                JSONB,
    "analyzed_at"           TIMESTAMP(3),
    CONSTRAINT "seo_page_meta_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "seo_page_meta_entity_unique" UNIQUE ("entity_type", "entity_id")
);

-- Site crawl audit runs.
CREATE TABLE IF NOT EXISTS "seo_audit_runs" (
    "id"                    TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    -- 'manual' | 'cron'
    "trigger"               TEXT         NOT NULL DEFAULT 'manual',
    -- 'running' | 'complete' | 'partial' | 'failed'
    "status"                TEXT         NOT NULL DEFAULT 'running',
    "started_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at"           TIMESTAMP(3),
    "pages_total"           INTEGER      NOT NULL DEFAULT 0,
    "pages_crawled"         INTEGER      NOT NULL DEFAULT 0,
    -- { errors, warnings, passes, avgResponseMs }
    "summary"               JSONB,
    CONSTRAINT "seo_audit_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "seo_audit_runs_status_check" CHECK ("status" IN ('running','complete','partial','failed'))
);

CREATE TABLE IF NOT EXISTS "seo_audit_issues" (
    "id"                    TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "run_id"                TEXT         NOT NULL,
    "url"                   TEXT         NOT NULL,
    -- 'error' | 'warning' | 'notice'
    "severity"              TEXT         NOT NULL,
    "check_key"             TEXT         NOT NULL,
    "message"               TEXT         NOT NULL,
    "detail"                JSONB,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seo_audit_issues_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "seo_audit_issues_run_fk" FOREIGN KEY ("run_id") REFERENCES "seo_audit_runs" ("id") ON DELETE CASCADE,
    CONSTRAINT "seo_audit_issues_severity_check" CHECK ("severity" IN ('error','warning','notice'))
);

CREATE INDEX IF NOT EXISTS "seo_audit_issues_run_idx" ON "seo_audit_issues" ("run_id");

-- Admin-managed robots.txt disallow rules, served through the module's
-- getPublicRobotsDisallow() hook into core /robots.txt.
CREATE TABLE IF NOT EXISTS "seo_robots_rules" (
    "id"                    TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "path"                  TEXT         NOT NULL,
    "note"                  TEXT,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seo_robots_rules_pkey" PRIMARY KEY ("id")
);

-- Admin-managed extra sitemap entries, served through the module's
-- getPublicSitemapEntries() hook into core /sitemap.xml.
CREATE TABLE IF NOT EXISTS "seo_sitemap_entries" (
    "id"                    TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "path"                  TEXT         NOT NULL,
    -- 0.0 - 1.0
    "priority"              NUMERIC(2,1),
    -- 'always'|'hourly'|'daily'|'weekly'|'monthly'|'yearly'|'never'
    "change_freq"           TEXT,
    "note"                  TEXT,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seo_sitemap_entries_pkey" PRIMARY KEY ("id")
);
