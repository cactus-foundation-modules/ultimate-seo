import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireSeoPermission } from '@/modules/ultimate-seo/lib/auth'

// Which entities have a Markdown twin, and which have an abstract written for
// them. Read by the Pages screen's "Ready for AI" column, which needs one small
// answer about several hundred rows rather than several hundred answers.
export async function GET() {
  const auth = await requireSeoPermission('seo.view')
  if ('error' in auth) return auth.error

  try {
    const [documents, abstracts] = await Promise.all([
      prisma.$queryRaw<Array<{ entity_type: string; entity_id: string }>>`
        SELECT "entity_type", "entity_id" FROM "seo_llm_documents"
      `,
      prisma.$queryRaw<Array<{ entity_type: string; entity_id: string; ai_abstract: string }>>`
        SELECT "entity_type", "entity_id", "ai_abstract" FROM "seo_page_meta"
        WHERE "ai_abstract" IS NOT NULL AND "ai_abstract" <> ''
      `,
    ])
    return NextResponse.json({
      twins: documents.map((d) => `${d.entity_type}:${d.entity_id}`),
      abstracts: Object.fromEntries(abstracts.map((a) => [`${a.entity_type}:${a.entity_id}`, a.ai_abstract])),
    })
  } catch {
    // Before the migration has run there is nothing to report, which is not an
    // error - the column simply is not there yet.
    return NextResponse.json({ twins: [], abstracts: {} })
  }
}
