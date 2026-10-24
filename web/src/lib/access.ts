import type { Device, Role } from '@/api/types'
import { useAuth } from '@/store/auth'

export type EffectiveRole = 'admin' | 'manager' | 'viewer'

/** Legacy `user` rows are managers (server migrates them; older servers still send `user`). */
export function normRole(r: Role | string | undefined | null): EffectiveRole {
  if (r === 'admin') return 'admin'
  // Phase 4a drivers can't use the web console's APIs; treat them as read-only if they get here
  if (r === 'viewer' || r === 'driver') return 'viewer'
  return 'manager'
}

export const ROLE_META: Record<EffectiveRole, { label: string; description: string; pill: string }> = {
  admin: {
    label: 'Admin',
    description: 'Everything, all vehicles, users & settings',
    pill: 'bg-brand-500 text-navy-900 ring-brand-600/40',
  },
  manager: {
    label: 'Manager',
    description: 'Manages vehicles, drivers, maintenance & expenses of their groups',
    pill: 'bg-navy-600/10 text-navy-700 ring-navy-600/25 dark:bg-navy-300/15 dark:text-navy-100 dark:ring-navy-200/25',
  },
  viewer: {
    label: 'Viewer',
    description: 'Read-only access to the vehicles of their groups',
    pill: 'bg-slate-500/10 text-slate-600 ring-slate-500/25 dark:text-slate-300',
  },
}

export interface Access {
  role: EffectiveRole
  isAdmin: boolean
  /** admin or manager: may create/edit operational records (drivers, maintenance, expenses, geofences, places, shares) */
  canManage: boolean
  readOnly: boolean
  groupIds: number[]
  /** managers only manage vehicles in their groups */
  canManageDevice: (d: Pick<Device, 'groupIds'> | null | undefined) => boolean
}

export function useAccess(): Access {
  const user = useAuth((s) => s.user)
  const role = normRole(user?.role)
  const groupIds = user?.groupIds ?? []
  const isAdmin = role === 'admin'
  const canManage = role !== 'viewer'
  return {
    role,
    isAdmin,
    canManage,
    readOnly: !canManage,
    groupIds,
    canManageDevice: (d) => {
      if (isAdmin) return true
      if (role !== 'manager') return false
      // older servers don't send groupIds: the server already scopes what a manager can see
      if (!d?.groupIds || !user?.groupIds) return true
      return d.groupIds.some((g) => groupIds.includes(g))
    },
  }
}
