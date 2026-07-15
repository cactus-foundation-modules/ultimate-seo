// One-click fixes write through to CORE pages only. Module-owned content
// (gazette, shop, directory) is never written from here - their schema and
// editors belong to them; the Pages screen deep-links out instead.

import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'

export type CorePageEdits = {
  title?: string
  metaDescription?: string | null
}

type PuckData = { root?: { props?: Record<string, unknown> }; [k: string]: unknown }

function withRootProps(data: unknown, edits: CorePageEdits): PuckData | null {
  if (!data || typeof data !== 'object') return null
  const d = structuredClone(data) as PuckData
  d.root = d.root && typeof d.root === 'object' ? d.root : {}
  d.root.props = d.root.props && typeof d.root.props === 'object' ? d.root.props : {}
  if (edits.title !== undefined) d.root.props.title = edits.title
  if (edits.metaDescription !== undefined) d.root.props.metaDescription = edits.metaDescription
  return d
}

/**
 * Applies title/metaDescription to an InfoPage. Writes the DB columns (what
 * generateMetadata reads) AND mirrors into builderData/publishedData root
 * props, so the next open of the Puck editor - and the next publish, which
 * re-extracts root.props into the columns - both see the same values instead
 * of silently reverting the fix.
 */
export async function applyCorePageEdits(pageId: string, edits: CorePageEdits): Promise<boolean> {
  const page = await prisma.infoPage.findUnique({
    where: { id: pageId },
    select: { builderData: true, publishedData: true },
  })
  if (!page) return false

  const data: Prisma.InfoPageUpdateInput = {}
  if (edits.title !== undefined) data.title = edits.title
  if (edits.metaDescription !== undefined) data.metaDescription = edits.metaDescription

  const builderData = withRootProps(page.builderData, edits)
  const publishedData = withRootProps(page.publishedData, edits)
  if (builderData) data.builderData = builderData as Prisma.InputJsonValue
  if (publishedData) data.publishedData = publishedData as Prisma.InputJsonValue

  await prisma.infoPage.update({ where: { id: pageId }, data })
  return true
}
