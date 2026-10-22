import type { Device, DeviceStatus, Position } from '@/api/types'

export const STATUSES: DeviceStatus[] = ['moving', 'idle', 'stopped', 'offline', 'never']

export const STATUS_META: Record<
  DeviceStatus,
  { label: string; color: string; pill: string; dot: string; text: string; ring: string }
> = {
  moving: {
    label: 'Moving',
    color: '#10b981',
    pill: 'bg-emerald-500/12 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    ring: 'ring-emerald-500/40',
  },
  idle: {
    label: 'Idle',
    color: '#f59e0b',
    pill: 'bg-amber-500/12 text-amber-600 ring-amber-500/25 dark:text-amber-400',
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
    ring: 'ring-amber-500/40',
  },
  stopped: {
    label: 'Stopped',
    color: '#0ea5e9',
    pill: 'bg-sky-500/12 text-sky-600 ring-sky-500/25 dark:text-sky-400',
    dot: 'bg-sky-500',
    text: 'text-sky-600 dark:text-sky-400',
    ring: 'ring-sky-500/40',
  },
  offline: {
    label: 'Offline',
    color: '#64748b',
    pill: 'bg-slate-500/12 text-slate-600 ring-slate-500/25 dark:text-slate-400',
    dot: 'bg-slate-500',
    text: 'text-slate-600 dark:text-slate-400',
    ring: 'ring-slate-500/40',
  },
  never: {
    label: 'Never connected',
    color: '#a1a1aa',
    pill: 'bg-zinc-500/12 text-zinc-600 ring-zinc-500/25 dark:text-zinc-400',
    dot: 'bg-zinc-400',
    text: 'text-zinc-500 dark:text-zinc-400',
    ring: 'ring-zinc-500/40',
  },
}

/** Mirror of the server's status rules for optimistic updates on a position frame. */
export function statusFromPosition(p: Position): DeviceStatus {
  if (p.speed > 3) return 'moving'
  return p.attributes?.ignition === true ? 'idle' : 'stopped'
}

export function countByStatus(devices: Device[]): Record<DeviceStatus, number> {
  const c: Record<DeviceStatus, number> = { moving: 0, idle: 0, stopped: 0, offline: 0, never: 0 }
  for (const d of devices) c[d.status in c ? d.status : 'offline']++
  return c
}
