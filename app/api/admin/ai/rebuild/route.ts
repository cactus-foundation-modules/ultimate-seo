import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { rebuildLlmDocuments } from '@/modules/ultimate-seo/lib/ai/materialise'
import { requireSeoPermission } from '@/modules/ultimate-seo/lib/auth'

// A full rebuild of every Markdown twin. On a large catalogue this is the most
// expensive thing this module does, which is why it is a button and a nightly
// job rather than anything that happens on a page request.
//
// No maxDuration: a module route file cannot set one, because core's catch-all
// at app/api/m/[module]/[...path] sets the ceiling for every module route. The
// 300 that used to sit here was ignored. The rebuild bounds itself instead - see
// TIME_BUDGET_MS in lib/ai/materialise.ts - and returns `incomplete: true` when
// there is more to do, so pressing the button again picks up where it stopped.

export async function POST(request: NextRequest) {
  const auth = await requireSeoPermission('seo.manage')
  if ('error' in auth) return auth.error

  // ?force=1 rebuilds pages that have not changed as well. Wanted after a
  // change to how a document is BUILT rather than to what it says - a new
  // module, a corrected description - which no timestamp on the content records.
  const force = request.nextUrl.searchParams.get('force') === '1'

  try {
    return NextResponse.json({ ok: true, ...await rebuildLlmDocuments({ force }) })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'the rebuild failed', 500)
  }
}
