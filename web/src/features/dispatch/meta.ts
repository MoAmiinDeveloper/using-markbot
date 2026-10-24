import {
  Ban,
  CircleCheck,
  CircleDashed,
  CircleX,
  Navigation,
  PackageCheck,
  Play,
  UserCheck,
  Wrench,
  MapPinCheck,
  ClipboardList,
  type LucideIcon,
} from 'lucide-react'
import type { Job, JobPriority, JobStatus, StopStatus } from '@/api/types'

export interface StatusMeta {
  label: string
  /** action wording when moving a job *to* this status */
  action: string
  color: string
  pill: string
  dot: string
  icon: LucideIcon
}

export const JOB_STATUS_META: Record<JobStatus, StatusMeta> = {
  unassigned: { label: 'Unassigned', action: 'Unassign', color: '#94a3b8', pill: 'bg-slate-500/10 text-slate-600 ring-slate-500/25 dark:text-slate-300', dot: 'bg-slate-400', icon: CircleDashed },
  assigned: { label: 'Assigned', action: 'Assign', color: '#3b82f6', pill: 'bg-blue-500/12 text-blue-700 ring-blue-500/25 dark:text-blue-300', dot: 'bg-blue-500', icon: ClipboardList },
  accepted: { label: 'Accepted', action: 'Mark accepted', color: '#6366f1', pill: 'bg-indigo-500/12 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300', dot: 'bg-indigo-500', icon: UserCheck },
  enRoute: { label: 'En route', action: 'Mark en route', color: '#0ea5e9', pill: 'bg-sky-500/12 text-sky-700 ring-sky-500/25 dark:text-sky-300', dot: 'bg-sky-500', icon: Navigation },
  arrived: { label: 'Arrived', action: 'Mark arrived', color: '#14b8a6', pill: 'bg-teal-500/12 text-teal-700 ring-teal-500/25 dark:text-teal-300', dot: 'bg-teal-500', icon: MapPinCheck },
  inProgress: { label: 'In progress', action: 'Start work', color: '#e6c200', pill: 'bg-brand-500/15 text-navy-700 ring-brand-500/40 dark:text-brand-200', dot: 'bg-brand-500', icon: Wrench },
  completed: { label: 'Completed', action: 'Complete', color: '#10b981', pill: 'bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300', dot: 'bg-emerald-500', icon: CircleCheck },
  failed: { label: 'Failed', action: 'Mark failed', color: '#f43f5e', pill: 'bg-rose-500/12 text-rose-700 ring-rose-500/30 dark:text-rose-300', dot: 'bg-rose-500', icon: CircleX },
  cancelled: { label: 'Cancelled', action: 'Cancel job', color: '#64748b', pill: 'bg-slate-500/10 text-slate-500 ring-slate-500/20 dark:text-slate-400', dot: 'bg-slate-500', icon: Ban },
}
export const jobStatusMeta = (s: string) => JOB_STATUS_META[s as JobStatus] ?? JOB_STATUS_META.unassigned

export type BoardColumnId = 'unassigned' | 'assigned' | 'active' | 'completed' | 'closed'
export const BOARD_COLUMNS: Array<{ id: BoardColumnId; label: string; statuses: JobStatus[]; color: string; empty: string }> = [
  { id: 'unassigned', label: 'Unassigned', statuses: ['unassigned'], color: '#94a3b8', empty: 'Every job has a driver' },
  { id: 'assigned', label: 'Assigned', statuses: ['assigned'], color: '#3b82f6', empty: 'Nothing waiting for a driver' },
  { id: 'active', label: 'In progress', statuses: ['accepted', 'enRoute', 'arrived', 'inProgress'], color: '#e6c200', empty: 'No job on the road' },
  { id: 'completed', label: 'Completed', statuses: ['completed'], color: '#10b981', empty: 'No completed jobs yet' },
  { id: 'closed', label: 'Failed / Cancelled', statuses: ['failed', 'cancelled'], color: '#f43f5e', empty: 'Nothing failed or cancelled' },
]
export const columnOf = (s: JobStatus): BoardColumnId => BOARD_COLUMNS.find((c) => c.statuses.includes(s))?.id ?? 'unassigned'

export const TERMINAL: JobStatus[] = ['completed', 'failed', 'cancelled']
export const isTerminal = (s: JobStatus) => TERMINAL.includes(s)

/**
 * Transitions offered to dispatchers via POST /jobs/{id}/status, in display order (docs/API.md Phase 4a
 * implementation notes; the server still answers 409 for anything invalid). The first entries are the
 * forward steps; failed/cancelled ask for a reason.
 */
export const DISPATCH_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  unassigned: ['assigned', 'cancelled'],
  assigned: ['enRoute', 'accepted', 'unassigned', 'cancelled'],
  accepted: ['enRoute', 'arrived', 'unassigned', 'failed', 'cancelled'],
  enRoute: ['arrived', 'completed', 'failed', 'cancelled'],
  arrived: ['inProgress', 'completed', 'enRoute', 'failed', 'cancelled'],
  inProgress: ['completed', 'enRoute', 'failed', 'cancelled'],
  completed: [],
  failed: ['assigned', 'unassigned'],
  cancelled: ['assigned', 'unassigned'],
}
/** Which transitions need a reason. */
export const NEEDS_REASON: JobStatus[] = ['failed', 'cancelled']

export const PRIORITY_META: Record<JobPriority, { label: string; pill: string; dot: string; rank: number }> = {
  normal: { label: 'Normal', pill: 'bg-slate-500/10 text-slate-600 ring-slate-500/20 dark:text-slate-300', dot: 'bg-slate-400', rank: 0 },
  high: { label: 'High', pill: 'bg-amber-500/14 text-amber-700 ring-amber-500/30 dark:text-amber-300', dot: 'bg-amber-500', rank: 1 },
  urgent: { label: 'Urgent', pill: 'bg-rose-500/12 text-rose-700 ring-rose-500/30 dark:text-rose-300', dot: 'bg-rose-500', rank: 2 },
}
export const priorityMeta = (p: string) => PRIORITY_META[p as JobPriority] ?? PRIORITY_META.normal

export const STOP_STATUS_META: Record<StopStatus, { label: string; color: string; fg: string }> = {
  pending: { label: 'Pending', color: '#64748b', fg: '#ffffff' },
  arrived: { label: 'Arrived', color: '#0ea5e9', fg: '#ffffff' },
  completed: { label: 'Completed', color: '#10b981', fg: '#ffffff' },
  skipped: { label: 'Skipped', color: '#f59e0b', fg: '#141b37' },
}
export const stopMeta = (s: string) => STOP_STATUS_META[s as StopStatus] ?? STOP_STATUS_META.pending

/** Minutes past the due time for an open job, else null. */
export function lateBy(j: Pick<Job, 'dueBy' | 'status' | 'late'>, now = Date.now()): number | null {
  if (j.late === false && (!j.dueBy || Date.parse(j.dueBy) > now - 60_000)) return null
  if (!j.dueBy || isTerminal(j.status)) return null
  const t = Date.parse(j.dueBy)
  if (Number.isNaN(t) || (now <= t && j.late !== true)) return null
  return Math.max(0, Math.round((now - t) / 60000))
}

export function fmtLate(min: number): string {
  if (min < 60) return `${min}m late`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ${min % 60 ? `${min % 60}m ` : ''}late`
  return `${Math.floor(h / 24)}d late`
}

export function stopProgress(j: Pick<Job, 'stops'>): { done: number; total: number } {
  const total = j.stops?.length ?? 0
  const done = j.stops?.filter((s) => s.status === 'completed' || s.status === 'skipped').length ?? 0
  return { done, total }
}

export const JobDoneIcon = PackageCheck
export const JobStartIcon = Play

export function initials(name: string | undefined | null) {
  return (
    (name ?? '')
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  )
}
