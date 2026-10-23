import type { DueStatus } from '@/api/types'
import { ROLE_META, normRole } from '@/lib/access'
import { cn } from '@/lib/cn'

export const DUE_META: Record<DueStatus, { label: string; pill: string; bar: string; color: string; dot: string }> = {
  ok: {
    label: 'OK',
    pill: 'bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300',
    bar: 'bg-emerald-500',
    color: '#10b981',
    dot: 'bg-emerald-500',
  },
  dueSoon: {
    label: 'Due soon',
    pill: 'bg-amber-500/14 text-amber-700 ring-amber-500/30 dark:text-amber-300',
    bar: 'bg-amber-500',
    color: '#f59e0b',
    dot: 'bg-amber-500',
  },
  overdue: {
    label: 'Overdue',
    pill: 'bg-rose-500/12 text-rose-700 ring-rose-500/30 dark:text-rose-300',
    bar: 'bg-rose-500',
    color: '#f43f5e',
    dot: 'bg-rose-500',
  },
}

export function DueStatusPill({ status, className }: { status: DueStatus | string; className?: string }) {
  const m = DUE_META[status as DueStatus] ?? DUE_META.ok
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
        m.pill,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', m.dot)} />
      {m.label}
    </span>
  )
}

export function scoreTone(score: number) {
  if (score >= 80) return { label: 'Good', text: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-500/12 ring-emerald-500/25', color: '#10b981' }
  if (score >= 60) return { label: 'Fair', text: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-500/14 ring-amber-500/30', color: '#f59e0b' }
  return { label: 'Risky', text: 'text-rose-700 dark:text-rose-300', bg: 'bg-rose-500/12 ring-rose-500/30', color: '#f43f5e' }
}

/** Driver behaviour score 0–100. */
export function ScoreBadge({ score, className, showLabel }: { score: number | null | undefined; className?: string; showLabel?: boolean }) {
  if (score == null || !Number.isFinite(score)) return <span className="text-slate-400">—</span>
  const t = scoreTone(score)
  return (
    <span
      title={`Behaviour score ${Math.round(score)}/100`}
      className={cn('tabular inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset', t.bg, t.text, className)}
    >
      {Math.round(score)}
      {showLabel && <span className="font-medium opacity-80">· {t.label}</span>}
    </span>
  )
}

export function RoleBadge({ role, className }: { role: string | undefined; className?: string }) {
  const m = ROLE_META[normRole(role)]
  return (
    <span
      title={m.description}
      className={cn('inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ring-1 ring-inset', m.pill, className)}
    >
      {m.label}
    </span>
  )
}

/** Small coloured dot + name, used for groups. */
export function GroupChip({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-[160px] items-center gap-1.5 whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-0.5 text-[11.5px] font-medium text-slate-700 dark:bg-white/[0.07] dark:text-slate-200',
        className,
      )}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{name}</span>
    </span>
  )
}
