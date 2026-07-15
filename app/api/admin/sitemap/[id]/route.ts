import { NextResponse } from 'next/server'
import { requireSeoPermission } from '@/modules/ultimate-seo/lib/auth'
import { deleteSitemapEntry, listSitemapEntries } from '@/modules/ultimate-seo/lib/db'

export async function DELETE(_request: Request, { params }: { params: Promise<Record<string, string>> }) {
  const auth = await requireSeoPermission('seo.manage')
  if ('error' in auth) return auth.error

  const { id } = await params
  if (id) await deleteSitemapEntry(id)
  const entries = await listSitemapEntries()
  return NextResponse.json({ entries: entries.map((e) => ({ ...e, priority: e.priority === null ? null : Number(e.priority) })) })
}
