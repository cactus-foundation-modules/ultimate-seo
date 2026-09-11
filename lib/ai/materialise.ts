// Building every Markdown twin, and keeping the set honest afterwards.
//
// Run by the weekly job and by the "rebuild now" button. Deliberately NOT run
// on a page request: a catalogue of twenty thousand products rendered on demand
// is a bill rather than a feature, which is the whole reason the twins are a
// table and not a render.

import { getInventory, getActiveModuleNames, gazettePostsAtRoot, shopProductsAtRoot } from '../inventory'
import { getAiSettings } from '../settings'
import type { EntityType, InventoryItem } from '../types'
import { getAbstracts, listDocumentFingerprints, pruneDocuments, upsertDocuments } from './db'
import { buildDocuments } from './documents'

export type RebuildResult = {
  built: number
  /** Already up to date, and therefore not rebuilt. */
  skipped: number
  removed: number
  /** Paths two entities both claim. The second one is not published. */
  clashes: string[]
  /** Milliseconds, so the screen can say what the job costs before it is scheduled. */
  tookMs: number
  /** True when the time budget ran out. The next run picks up where this one stopped. */
  incomplete: boolean
}

// One batch's worth of products carries its variations, its attributes and its
// categories, so the batch is what decides peak memory. A hundred is a few
// megabytes and about a dozen queries.
const BATCH_SIZE = 100

/**
 * How long a rebuild may run before it stops and leaves the rest for next time.
 *
 * Measured on a real catalogue: a hundred products, with their variations,
 * attributes and 3D models, take about a second and a half.
 *
 * Sized to fit inside a slice of core's cron dispatcher, NOT inside some ceiling
 * of this module's own choosing. A module route file cannot set its own
 * maxDuration - core's catch-all at app/api/m/[module]/[...path] sets one ceiling
 * of 60 seconds for every module route, and the nightly dispatcher then gives a
 * job whatever is left of its own 60s tick. This budget was four minutes, which
 * is a number no module route has ever been able to reach: every scheduled
 * rebuild was aborted mid-flight, recorded as a failure, and the whole AI half of
 * the module - llms.txt, the Markdown twins, the agent endpoint, every page's
 * breadcrumbs - stayed empty on a live site for as long as that lasted.
 *
 * Stopping early is safe because the next run skips everything already built:
 * a catalogue too big for one pass finishes over several, and every pass after
 * that is nearly free because almost nothing has changed.
 */
const TIME_BUDGET_MS = 40_000

/** Whether this entity is published and therefore has any business being copied. */
function isPublic(item: InventoryItem): boolean {
  return item.status === 'published'
}

export async function rebuildLlmDocuments(options?: { types?: EntityType[]; force?: boolean }): Promise<RebuildResult> {
  const startedAt = Date.now()
  const settings = await getAiSettings()

  // Nothing switched on: the table is emptied rather than left holding a copy
  // of a site that has since said it does not want copying.
  if (!settings.llmsTxt && !settings.markdown) {
    const removed = await pruneDocuments([])
    return { built: 0, skipped: 0, removed, clashes: [], tookMs: Date.now() - startedAt, incomplete: false }
  }

  const wanted = new Set<string>(options?.types ?? settings.markdownTypes)

  const [inventory, moduleNames, abstracts, productsAtRoot, postsAtRoot, fingerprints] = await Promise.all([
    getInventory(),
    getActiveModuleNames(),
    getAbstracts(),
    shopProductsAtRoot(),
    gazettePostsAtRoot(),
    options?.force ? Promise.resolve(new Map<string, number | null>()) : listDocumentFingerprints(),
  ])

  const items = inventory.filter((item) => wanted.has(item.entityType) && isPublic(item))

  // Split into what has changed and what has not. The unchanged half still
  // counts as present, so the prune below does not delete it.
  const stale = items.filter((item) => {
    const key = `${item.entityType}:${item.entityId}`
    if (!fingerprints.has(key)) return true
    const built = fingerprints.get(key) ?? null
    const source = item.updatedAt ? Date.parse(item.updatedAt) : null
    // Either side unknown means "cannot tell", and cannot tell means rebuild.
    if (built === null || source === null) return true
    return source > built
  })

  // Built with an empty site URL, so every address inside a stored document is
  // a path rather than an absolute link.
  //
  // A hostname baked into twenty thousand rows is a hostname that has to be
  // rebuilt out of them: this platform's one live site moved domain in its
  // first year, and the same table is read on a preview deployment under an
  // entirely different name. Paths are right wherever the site is served from.
  // /llms.txt builds its links at request time, where the current host is known.
  const ctx = {
    siteUrl: '',
    hasModule: (name: string) => moduleNames.has(name),
    abstracts,
    productsAtRoot,
    postsAtRoot,
  }

  let built = 0
  const clashes: string[] = []
  let incomplete = false

  for (let i = 0; i < stale.length; i += BATCH_SIZE) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      incomplete = true
      break
    }
    const batch = stale.slice(i, i + BATCH_SIZE)
    const docs = await buildDocuments(batch, ctx)
    const result = await upsertDocuments(docs)
    built += result.written
    clashes.push(...result.clashes)
  }

  // Anything whose entity has gone, been unpublished, or whose type the owner
  // has since switched off. Scoped to a complete full rebuild: a partial one -
  // by type, or one that ran out of time - has no way of knowing what the parts
  // it did not look at should still hold, and would delete them.
  const removed = options?.types || incomplete
    ? 0
    : await pruneDocuments(items.map((i) => ({ entityType: i.entityType, entityId: i.entityId })))

  return {
    built,
    skipped: items.length - stale.length,
    removed,
    clashes,
    tookMs: Date.now() - startedAt,
    incomplete,
  }
}

/**
 * Rebuilds the twin for one entity, after its content was edited.
 *
 * Cheap enough to run inline: it is one entity's worth of queries. Returns
 * false when there is nothing to build - the entity is unpublished, its type is
 * switched off, or the whole feature is.
 */
export async function rebuildOneDocument(entityType: EntityType, entityId: string): Promise<boolean> {
  const settings = await getAiSettings()
  if (!settings.llmsTxt && !settings.markdown) return false
  if (!settings.markdownTypes.includes(entityType)) return false

  const [inventory, moduleNames, abstracts, productsAtRoot, postsAtRoot] = await Promise.all([
    getInventory(),
    getActiveModuleNames(),
    getAbstracts(),
    shopProductsAtRoot(),
    gazettePostsAtRoot(),
  ])

  const item = inventory.find((i) => i.entityType === entityType && i.entityId === entityId)
  if (!item || !isPublic(item)) return false

  const docs = await buildDocuments([item], {
    siteUrl: '',
    hasModule: (name: string) => moduleNames.has(name),
    abstracts,
    productsAtRoot,
    postsAtRoot,
  })
  const result = await upsertDocuments(docs)
  return result.written > 0
}
