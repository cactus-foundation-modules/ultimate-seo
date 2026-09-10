// Reads and writes for the three things the AI half stores: the materialised
// Markdown twins, the per-entity abstracts, and the daily AI hit counts.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type { AiHitRow, LlmDocumentRow } from '../types'
import type { BuiltDocument } from './documents'

// ---------------------------------------------------------------------------
// Materialised documents
// ---------------------------------------------------------------------------

/** One document by its public path. The .md route's only query. */
export async function getDocumentByPath(path: string): Promise<Pick<LlmDocumentRow, 'markdown' | 'source_updated_at'> | null> {
  const rows = await prisma.$queryRaw<Array<Pick<LlmDocumentRow, 'markdown' | 'source_updated_at'>>>`
    SELECT "markdown", "source_updated_at" FROM "seo_llm_documents" WHERE "path" = ${path} LIMIT 1
  `
  return rows[0] ?? null
}

export type DocumentIndexRow = {
  entity_type: string
  path: string
  title: string
  summary: string | null
  byte_size: number
}

/** Every document's index line, in the order llms.txt lists them. */
export async function listDocumentIndex(types: string[]): Promise<DocumentIndexRow[]> {
  if (types.length === 0) return []
  return prisma.$queryRaw<DocumentIndexRow[]>`
    SELECT "entity_type", "path", "title", "summary", "byte_size"
    FROM "seo_llm_documents"
    WHERE "entity_type" IN (${Prisma.join(types)})
    ORDER BY "entity_type" ASC, "title" ASC
  `
}

/** Whole documents, for llms-full.txt. Capped by the caller, never unbounded. */
export async function listDocumentBodies(types: string[], limit: number): Promise<Array<{ path: string; markdown: string }>> {
  if (types.length === 0 || limit <= 0) return []
  return prisma.$queryRaw<Array<{ path: string; markdown: string }>>`
    SELECT "path", "markdown" FROM "seo_llm_documents"
    WHERE "entity_type" IN (${Prisma.join(types)})
    ORDER BY "entity_type" ASC, "title" ASC
    LIMIT ${limit}
  `
}

/**
 * What is already built, and how fresh it is.
 *
 * The key to not rebuilding a twenty-thousand-product catalogue from scratch
 * every week: an entity whose content has not been touched since its twin was
 * built does not need a new twin.
 */
export async function listDocumentFingerprints(): Promise<Map<string, number | null>> {
  const rows = await prisma.$queryRaw<Array<{ entity_type: string; entity_id: string; source_updated_at: Date | null }>>`
    SELECT "entity_type", "entity_id", "source_updated_at" FROM "seo_llm_documents"
  `
  return new Map(rows.map((r) => [
    `${r.entity_type}:${r.entity_id}`,
    r.source_updated_at ? r.source_updated_at.getTime() : null,
  ]))
}

/**
 * What one public page publishes about itself: where its Markdown twin is, and
 * the facts its structured data is built from.
 *
 * The single query the public head makes, and the only one - which is why the
 * facts live on the same row as the twin rather than in a table of their own.
 */
export async function getPageFacts(path: string): Promise<{ path: string; page_facts: unknown } | null> {
  const rows = await prisma.$queryRaw<Array<{ path: string; page_facts: unknown }>>`
    SELECT "path", "page_facts" FROM "seo_llm_documents" WHERE "path" = ${path} LIMIT 1
  `
  return rows[0] ?? null
}

export async function documentStats(): Promise<{ count: number; bytes: number; builtAt: Date | null }> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint; bytes: bigint | null; built_at: Date | null }>>`
    SELECT COUNT(*) AS count, SUM("byte_size") AS bytes, MAX("built_at") AS built_at FROM "seo_llm_documents"
  `
  const row = rows[0]
  return {
    count: Number(row?.count ?? 0),
    bytes: Number(row?.bytes ?? 0),
    builtAt: row?.built_at ?? null,
  }
}

/**
 * Writes a batch of documents.
 *
 * Conflicts are resolved on (entity_type, entity_id) - the entity is the thing
 * that exists, the path is only where it currently answers. A product moved to
 * a new slug must UPDATE its row rather than insert a second one, or the old
 * address goes on serving the old copy for ever.
 *
 * The unique index on "path" is what stops two entities claiming one address,
 * so a batch carrying such a clash is retried one row at a time and the loser
 * is reported rather than taking the whole rebuild down.
 */
export async function upsertDocuments(docs: BuiltDocument[]): Promise<{ written: number; clashes: string[] }> {
  if (docs.length === 0) return { written: 0, clashes: [] }

  const values = docs.map((d) => Prisma.sql`(
    ${d.entityType}, ${d.entityId}, ${d.path}, ${d.title}, ${d.summary},
    ${d.markdown}, ${Buffer.byteLength(d.markdown, 'utf8')}, ${d.sourceUpdatedAt},
    ${JSON.stringify(d.pageFacts)}::jsonb, CURRENT_TIMESTAMP
  )`)

  const statement = (rows: Prisma.Sql[]) => prisma.$executeRaw`
    INSERT INTO "seo_llm_documents"
      ("entity_type", "entity_id", "path", "title", "summary", "markdown", "byte_size", "source_updated_at", "page_facts", "built_at")
    VALUES ${Prisma.join(rows, ', ')}
    ON CONFLICT ("entity_type", "entity_id") DO UPDATE SET
      "path" = EXCLUDED."path",
      "title" = EXCLUDED."title",
      "summary" = EXCLUDED."summary",
      "markdown" = EXCLUDED."markdown",
      "byte_size" = EXCLUDED."byte_size",
      "source_updated_at" = EXCLUDED."source_updated_at",
      "page_facts" = EXCLUDED."page_facts",
      "built_at" = CURRENT_TIMESTAMP
  `

  try {
    await statement(values)
    return { written: docs.length, clashes: [] }
  } catch {
    const clashes: string[] = []
    let written = 0
    for (let i = 0; i < docs.length; i++) {
      try {
        await statement([values[i]!])
        written++
      } catch {
        clashes.push(docs[i]!.path)
      }
    }
    return { written, clashes }
  }
}

/** Drops twins for entities that no longer exist, or types no longer wanted. */
export async function pruneDocuments(keep: Array<{ entityType: string; entityId: string }>): Promise<number> {
  if (keep.length === 0) {
    return prisma.$executeRaw`DELETE FROM "seo_llm_documents"`
  }
  const keys = keep.map((k) => `${k.entityType}:${k.entityId}`)
  return prisma.$executeRaw`
    DELETE FROM "seo_llm_documents"
    WHERE ("entity_type" || ':' || "entity_id") <> ALL (${keys}::text[])
  `
}

export async function deleteDocumentsOfType(types: string[]): Promise<number> {
  if (types.length === 0) return 0
  return prisma.$executeRaw`DELETE FROM "seo_llm_documents" WHERE "entity_type" IN (${Prisma.join(types)})`
}

// ---------------------------------------------------------------------------
// Abstracts
// ---------------------------------------------------------------------------

export async function getAbstracts(): Promise<Map<string, string>> {
  const rows = await prisma.$queryRaw<Array<{ entity_type: string; entity_id: string; ai_abstract: string | null }>>`
    SELECT "entity_type", "entity_id", "ai_abstract" FROM "seo_page_meta" WHERE "ai_abstract" IS NOT NULL AND "ai_abstract" <> ''
  `
  return new Map(rows.map((r) => [`${r.entity_type}:${r.entity_id}`, r.ai_abstract ?? '']))
}

export async function setAbstract(entityType: string, entityId: string, abstract: string | null): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "seo_page_meta" ("entity_type", "entity_id", "ai_abstract")
    VALUES (${entityType}, ${entityId}, ${abstract})
    ON CONFLICT ("entity_type", "entity_id") DO UPDATE SET "ai_abstract" = EXCLUDED."ai_abstract"
  `
}

// ---------------------------------------------------------------------------
// AI hit counts
// ---------------------------------------------------------------------------

/**
 * One visit, counted.
 *
 * An upsert onto (day, kind, agent, path) rather than an insert per request:
 * the row count then grows with how many DIFFERENT pages the crawlers ask for,
 * not with how often they ask.
 */
export async function recordAiHit(kind: 'crawler' | 'referral', agent: string, path: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "seo_ai_hits" ("day", "kind", "agent", "path", "hits", "last_seen")
    VALUES (CURRENT_DATE, ${kind}, ${agent}, ${path}, 1, CURRENT_TIMESTAMP)
    ON CONFLICT ("day", "kind", "agent", "path") DO UPDATE SET
      "hits" = "seo_ai_hits"."hits" + 1,
      "last_seen" = CURRENT_TIMESTAMP
  `
}

export async function listAiHits(sinceDays: number): Promise<AiHitRow[]> {
  return prisma.$queryRaw<AiHitRow[]>`
    SELECT "day", "kind", "agent", "path", "hits", "last_seen"
    FROM "seo_ai_hits"
    WHERE "day" >= CURRENT_DATE - ${sinceDays}::integer
    ORDER BY "day" DESC, "hits" DESC
  `
}

export async function pruneAiHits(retentionDays: number): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM "seo_ai_hits" WHERE "day" < CURRENT_DATE - ${retentionDays}::integer
  `
}
