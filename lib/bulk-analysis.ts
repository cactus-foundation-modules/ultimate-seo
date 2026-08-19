// Whole-site analysis: score many pages in one pass.
//
// The single-page path reloads the entire inventory per page, which is fine for
// one click and ruinous for several hundred. This module pays that cost once per
// batch, batch-loads the content, scores in memory and writes back in a single
// statement. The caller chunks the work so no request goes near the 60s
// serverless ceiling.

import { analyzePage } from './analyze'
import { bulkUpsertPageMeta } from './db'
import { DuplicateIndex } from './duplicates'
import { getInventory } from './inventory'
import { loadEntities, type EntityDetail } from './run-analysis'
import { getSeoSettings } from './settings'
import type { EntityType, SeoCheck } from './types'

export type BulkKey = { entityType: EntityType; entityId: string }

export type BulkAnalysisResult = {
  /** Pages scored and saved, in request order. */
  analysed: Array<BulkKey & { score: number }>
  /** Pages that vanished between listing and analysing (deleted, unpublished away). */
  missing: BulkKey[]
}

const keyOf = (k: BulkKey) => `${k.entityType}:${k.entityId}`

export async function analyzeBatch(keys: BulkKey[]): Promise<BulkAnalysisResult> {
  const unique = new Map<string, BulkKey>()
  // Postgres refuses an INSERT that hits the same conflicting row twice, so the
  // batch is deduped before anything else happens.
  for (const key of keys) unique.set(keyOf(key), key)
  const wanted = [...unique.values()]
  if (wanted.length === 0) return { analysed: [], missing: [] }

  const [settings, inventory] = await Promise.all([getSeoSettings(), getInventory()])

  // Duplicate detection needs the whole site; the index answers it in constant
  // time per page, so the sweep stays linear.
  const duplicates = new DuplicateIndex(inventory.map((i) => ({
    key: keyOf(i),
    title: i.title,
    metaDescription: i.metaDescription,
  })))
  const keywordByKey = new Map(inventory.map((i) => [keyOf(i), i.focusKeyword]))

  const idsByType = new Map<EntityType, string[]>()
  for (const key of wanted) {
    const ids = idsByType.get(key.entityType)
    if (ids) ids.push(key.entityId)
    else idsByType.set(key.entityType, [key.entityId])
  }

  const details = new Map<string, EntityDetail>()
  await Promise.all([...idsByType].map(async ([entityType, ids]) => {
    const loaded = await loadEntities(entityType, ids)
    for (const [entityId, detail] of loaded) details.set(`${entityType}:${entityId}`, detail)
  }))

  const analysed: BulkAnalysisResult['analysed'] = []
  const missing: BulkKey[] = []
  const writes: Array<{ entityType: string; entityId: string; score: number; checks: SeoCheck[] }> = []

  for (const key of wanted) {
    const k = keyOf(key)
    const entity = details.get(k)
    if (!entity) {
      missing.push(key)
      continue
    }

    // analyzePage takes corpora and asks "does anything in here match?", so a
    // one-element answer from the index is as truthful as the full site list.
    const titleDuplicated = duplicates.isDuplicateTitle(k, entity.title)
    const descDuplicated = duplicates.isDuplicateDescription(k, entity.metaDescription)

    const result = analyzePage({
      title: entity.title,
      slug: entity.slug,
      metaDescription: entity.metaDescription,
      hasOgImage: entity.hasOgImage,
      focusKeyword: keywordByKey.get(k) ?? null,
      content: entity.content,
      targets: settings.targets,
      otherTitles: titleDuplicated ? [entity.title] : [],
      otherDescriptions: descDuplicated && entity.metaDescription ? [entity.metaDescription] : [],
      isPublished: entity.isPublished,
      titleIsH1: entity.titleIsH1,
    })

    analysed.push({ ...key, score: result.score })
    writes.push({ entityType: key.entityType, entityId: key.entityId, score: result.score, checks: result.checks })
  }

  await bulkUpsertPageMeta(writes)
  return { analysed, missing }
}
