import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'

type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionFromCookie>>>

/** Returns the user when authenticated with the permission, else a ready error Response. */
export async function requireSeoPermission(permission: 'seo.view' | 'seo.manage'): Promise<{ user: SessionUser } | { error: Response }> {
  const user = await getSessionFromCookie()
  if (!user) return { error: errorResponse('Not authenticated', 401) }
  if (!await hasPermission(user, permission)) return { error: errorResponse('Forbidden', 403) }
  return { user }
}
