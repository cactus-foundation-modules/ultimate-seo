import { NextResponse } from 'next/server'
import { requireSeoPermission } from '@/modules/ultimate-seo/lib/auth'
import { getInventory } from '@/modules/ultimate-seo/lib/inventory'

export async function GET() {
  const auth = await requireSeoPermission('seo.view')
  if ('error' in auth) return auth.error

  const items = await getInventory()
  return NextResponse.json({ items })
}
