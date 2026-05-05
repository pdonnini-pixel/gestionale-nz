import { useMemo } from 'react'
import { useAuth } from './useAuth'

// Il ruolo nel JWT può essere stringa singola o array (multi-role).
// Mantenere allineato al backend: vedi public.has_jwt_role in DB.
export interface UseRoleResult {
  roles: string[]
  hasRole: (roleName: string) => boolean
  isAuthenticated: boolean
}

function normalizeRoles(raw: unknown): string[] {
  if (raw == null) return []
  if (typeof raw === 'string') return [raw]
  if (Array.isArray(raw)) {
    return raw.filter((r): r is string => typeof r === 'string')
  }
  return []
}

export function useRole(): UseRoleResult {
  const { session } = useAuth()

  return useMemo(() => {
    const appMetadata = (session?.user?.app_metadata ?? {}) as Record<string, unknown>
    const roles = normalizeRoles(appMetadata.role)
    return {
      roles,
      hasRole: (roleName: string) => roles.includes(roleName),
      isAuthenticated: !!session,
    }
  }, [session])
}
