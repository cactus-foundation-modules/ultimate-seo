import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type {
  AuditIssue,
  AuditRun,
  PageMetaRow,
  RobotsRule,
  SeoCheck,
  SitemapEntry,
} from './types'

// ---------------------------------------------------------------------------
// Page meta (focus keyword + latest analysis per entity)
// ---------------------------------------------------------------------------

export async function getAllPageMeta(): Promise<PageMetaRow[]> {
  return prisma.$queryRaw<PageMetaRow[]>`
    SELECT "id", "entity_type", "entity_id", "focus_keyword", "notes", "score", "checks", "analyzed_at"
    FROM "seo_page_meta"
  `
}

export async function upsertPageMeta(params: {
  entityType: string
  entityId: string
  focusKeyword?: string | null
  score?: number | null
  checks?: SeoCheck[] | null
}): Promise<void> {
  const { entityType, entityId } = params
  const hasKeyword = params.focusKeyword !== undefined
  const hasAnalysis = params.score !== undefined

  const checksJson = params.checks !== undefined && params.checks !== null ? JSON.stringify(params.checks) : null

  await prisma.$executeRaw`
    INSERT INTO "seo_page_meta" ("entity_type", "entity_id", "focus_keyword", "score", "checks", "analyzed_at")
    VALUES (
      ${entityType}, ${entityId},
      ${params.focusKeyword ?? null},
      ${params.score ?? null},
      ${checksJson}::jsonb,
      CASE WHEN ${hasAnalysis} THEN CURRENT_TIMESTAMP ELSE NULL END
    )
    ON CONFLICT ("entity_type", "entity_id") DO UPDATE SET
      "focus_keyword" = CASE WHEN ${hasKeyword} THEN EXCLUDED."focus_keyword" ELSE "seo_page_meta"."focus_keyword" END,
      "score"         = CASE WHEN ${hasAnalysis} THEN EXCLUDED."score" ELSE "seo_page_meta"."score" END,
      "checks"        = CASE WHEN ${hasAnalysis} THEN EXCLUDED."checks" ELSE "seo_page_meta"."checks" END,
      "analyzed_at"   = CASE WHEN ${hasAnalysis} THEN CURRENT_TIMESTAMP ELSE "seo_page_meta"."analyzed_at" END
  `
}

/**
 * Write a whole batch of analysis results in one statement. Focus keywords are
 * deliberately left alone - a bulk sweep re-scores pages, it never re-keywords
 * them. Callers must dedupe by (entityType, entityId): Postgres refuses to let
 * one INSERT touch the same conflicting row twice.
 */
export async function bulkUpsertPageMeta(rows: Array<{
  entityType: string
  entityId: string
  score: number
  checks: SeoCheck[]
}>): Promise<void> {
  if (rows.length === 0) return
  const values = rows.map((r) => Prisma.sql`(${r.entityType}, ${r.entityId}, ${r.score}, ${JSON.stringify(r.checks)}::jsonb, CURRENT_TIMESTAMP)`)
  await prisma.$executeRaw`
    INSERT INTO "seo_page_meta" ("entity_type", "entity_id", "score", "checks", "analyzed_at")
    VALUES ${Prisma.join(values, ', ')}
    ON CONFLICT ("entity_type", "entity_id") DO UPDATE SET
      "score"       = EXCLUDED."score",
      "checks"      = EXCLUDED."checks",
      "analyzed_at" = CURRENT_TIMESTAMP
  `
}

// ---------------------------------------------------------------------------
// Audit runs + issues
// ---------------------------------------------------------------------------

export async function createAuditRun(trigger: 'manual' | 'cron', pagesTotal: number): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "seo_audit_runs" ("trigger", "pages_total")
    VALUES (${trigger}, ${pagesTotal})
    RETURNING "id"
  `
  const row = rows[0]
  if (!row) throw new Error('Failed to create audit run')
  return row.id
}

export async function finishAuditRun(params: {
  id: string
  status: 'complete' | 'partial' | 'failed'
  pagesCrawled: number
  summary: { errors: number; warnings: number; notices: number; avgResponseMs: number }
}): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "seo_audit_runs" SET
      "status" = ${params.status},
      "finished_at" = CURRENT_TIMESTAMP,
      "pages_crawled" = ${params.pagesCrawled},
      "summary" = ${JSON.stringify(params.summary)}::jsonb
    WHERE "id" = ${params.id}
  `
}

export async function insertAuditIssues(
  runId: string,
  issues: Array<{ url: string; severity: string; checkKey: string; message: string; detail?: Record<string, unknown> }>,
): Promise<void> {
  for (const issue of issues) {
    await prisma.$executeRaw`
      INSERT INTO "seo_audit_issues" ("run_id", "url", "severity", "check_key", "message", "detail")
      VALUES (${runId}, ${issue.url}, ${issue.severity}, ${issue.checkKey}, ${issue.message}, ${issue.detail ? JSON.stringify(issue.detail) : null}::jsonb)
    `
  }
}

export async function listAuditRuns(limit = 20): Promise<AuditRun[]> {
  return prisma.$queryRaw<AuditRun[]>`
    SELECT * FROM "seo_audit_runs" ORDER BY "started_at" DESC LIMIT ${limit}
  `
}

export async function getAuditRun(id: string): Promise<AuditRun | null> {
  const rows = await prisma.$queryRaw<AuditRun[]>`
    SELECT * FROM "seo_audit_runs" WHERE "id" = ${id}
  `
  return rows[0] ?? null
}

export async function getAuditIssues(runId: string): Promise<AuditIssue[]> {
  return prisma.$queryRaw<AuditIssue[]>`
    SELECT * FROM "seo_audit_issues"
    WHERE "run_id" = ${runId}
    ORDER BY CASE "severity" WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, "url"
  `
}

export async function hasRunningAudit(): Promise<boolean> {
  // Stale guard: a serverless crash can strand a run in 'running'; ignore runs older than 10 minutes.
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "seo_audit_runs"
    WHERE "status" = 'running' AND "started_at" > CURRENT_TIMESTAMP - INTERVAL '10 minutes'
    LIMIT 1
  `
  return rows.length > 0
}

// ---------------------------------------------------------------------------
// Robots rules
// ---------------------------------------------------------------------------

export async function listRobotsRules(): Promise<RobotsRule[]> {
  return prisma.$queryRaw<RobotsRule[]>`
    SELECT * FROM "seo_robots_rules" ORDER BY "created_at" ASC
  `
}

export async function addRobotsRule(path: string, note: string | null): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "seo_robots_rules" ("path", "note") VALUES (${path}, ${note})
  `
}

export async function deleteRobotsRule(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "seo_robots_rules" WHERE "id" = ${id}`
}

// ---------------------------------------------------------------------------
// Custom sitemap entries
// ---------------------------------------------------------------------------

export async function listSitemapEntries(): Promise<SitemapEntry[]> {
  return prisma.$queryRaw<SitemapEntry[]>`
    SELECT * FROM "seo_sitemap_entries" ORDER BY "created_at" ASC
  `
}

export async function addSitemapEntry(params: {
  path: string
  priority: number | null
  changeFreq: string | null
  note: string | null
}): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "seo_sitemap_entries" ("path", "priority", "change_freq", "note")
    VALUES (${params.path}, ${params.priority}, ${params.changeFreq}, ${params.note})
  `
}

export async function deleteSitemapEntry(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "seo_sitemap_entries" WHERE "id" = ${id}`
}
