import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/utils'
import { AI_CRAWLERS } from '@/modules/ultimate-seo/lib/ai/crawlers'
import { documentStats } from '@/modules/ultimate-seo/lib/ai/db'
import { requireSeoPermission } from '@/modules/ultimate-seo/lib/auth'
import { getAiSettings, saveAiSettings } from '@/modules/ultimate-seo/lib/settings'
import { ENTITY_TYPES } from '@/modules/ultimate-seo/lib/types'

export async function GET() {
  const auth = await requireSeoPermission('seo.view')
  if ('error' in auth) return auth.error

  const [settings, stats] = await Promise.all([getAiSettings(), documentStats().catch(() => null)])
  return NextResponse.json({
    settings,
    stats: stats ?? { count: 0, bytes: 0, builtAt: null },
    // Sent with the settings so the screen never carries its own copy of the
    // crawler list: a crawler added to the module appears on the screen without
    // the screen being touched.
    crawlers: AI_CRAWLERS,
  })
}

const Signal = z.enum(['yes', 'no', 'unset'])

const Body = z.object({
  siteSummary: z.string().max(2000),
  llmsTxt: z.boolean(),
  llmsFull: z.boolean(),
  businessFacts: z.boolean(),
  markdown: z.boolean(),
  markdownTypes: z.array(z.enum(ENTITY_TYPES)).max(ENTITY_TYPES.length),
  abstracts: z.boolean(),
  pageStructuredData: z.boolean(),
  pageMarkdownLink: z.boolean(),
  analytics: z.boolean(),
  analyticsRetentionDays: z.number().int().min(7).max(730),
  publishSupplier: z.boolean(),
  mcp: z.boolean(),
  mcpMaxResults: z.number().int().min(1).max(100),
  crawlerPolicy: z.record(z.string(), z.enum(['allow', 'block'])),
  contentSignals: z.object({ search: Signal, aiInput: Signal, aiTrain: Signal }),
})

export async function PUT(request: NextRequest) {
  const auth = await requireSeoPermission('seo.manage')
  if ('error' in auth) return auth.error

  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Invalid input')

  // saveAiSettings normalises again on the way in, which is where an unknown
  // crawler key gets dropped - Zod cannot know the list.
  await saveAiSettings(parsed.data)
  return NextResponse.json({ ok: true })
}
