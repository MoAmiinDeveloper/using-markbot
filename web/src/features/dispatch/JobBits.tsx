import { CalendarClock, ClockAlert, MapPin, Truck } from 'lucide-react'
import type { Device, Driver, Job } from '@/api/types'
import { StatusDot } from '@/components/ui/Misc'
import { cn } from '@/lib/cn'
import { format, isToday, isTomorrow } from 'date-fns'
import { fmtLate, initials, jobStatusMeta, lateBy, priorityMeta, stopProgress } from './meta'

export function JobStatusPill({ status, className }: { status: string; className?: string }) {
  const m = jobStatusMeta(status)
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', m.pill, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', m.dot)} />
      {m.label}
    </span>
  )
}

export function PriorityPill({ priority, className, hideNormal }: { priority: string; className?: string; hideNormal?: boolean }) {
  if (hideNormal && priority === 'normal') return null
  const m = priorityMeta(priority)
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide ring-1 ring-inset', m.pill, className)}>
      {m.label}
    </span>
  )
}

export function LateBadge({ minutes, className }: { minutes: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-rose-500 px-1.5 py-px text-[10.5px] font-semibold text-white shadow-sm', className)}>
      <ClockAlert className="h-3 w-3" />
      {fmtLate(minutes)}
    </span>
  )
}

export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  if (isToday(t)) return `Today ${format(t, 'HH:mm')}`
  if (isTomorrow(t)) return `Tomorrow ${format(t, 'HH:mm')}`
  return format(t, 'd MMM, HH:mm')
}

export function DriverAvatar({ name, className }: { name: string | null | undefined; className?: string }) {
  return (
    <span
      className={cn(
        'grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9.5px] font-semibold',
        name ? 'bg-navy-700 text-brand-400 dark:bg-white/[0.1] dark:text-brand-300' : 'border border-dashed border-slate-300 text-slate-400 dark:border-white/20',
        className,
      )}
      aria-hidden
    >
      {name ? initials(name) : '?'}
    </span>
  )
}

export function StopProgress({ job, className }: { job: Job; className?: string }) {
  const { done, total } = stopProgress(job)
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} title={`${done} of ${total} stops done`}>
      <span className="flex gap-[3px]">
        {job.stops.slice(0, 8).map((s, i) => (
          <span
            key={s.id ?? i}
            className={cn(
              'h-1.5 w-3 rounded-full',
              s.status === 'completed' ? 'bg-emerald-500' : s.status === 'skipped' ? 'bg-amber-400' : s.status === 'arrived' ? 'bg-sky-500' : 'bg-slate-200 dark:bg-white/15',
            )}
          />
        ))}
      </span>
      <span className="tabular text-[11px] text-slate-500 dark:text-slate-400">
        {done}/{total}
      </span>
    </span>
  )
}

/** Board / list card. */
export function JobCard({
  job,
  driver,
  device,
  selected,
  now,
  onClick,
  showStatus,
}: {
  job: Job
  driver?: Driver
  device?: Device
  selected?: boolean
  now: number
  onClick: () => void
  showStatus?: boolean
}) {
  const late = lateBy(job, now)
  const next = job.stops.find((s) => s.status === 'pending' || s.status === 'arrived') ?? job.stops[job.stops.length - 1]
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected || undefined}
      className={cn(
        'group relative w-full overflow-hidden rounded-xl border bg-white p-3 text-left shadow-soft transition-all hover:-translate-y-px hover:shadow-md dark:bg-ink-850',
        selected
          ? 'border-brand-500 ring-2 ring-brand-500/40 dark:border-brand-400'
          : late != null
            ? 'border-rose-400/70 ring-1 ring-rose-500/30 dark:border-rose-500/50'
            : 'border-slate-200/90 hover:border-slate-300 dark:border-white/[0.07] dark:hover:border-white/15',
      )}
    >
      {late != null && <span className="absolute inset-y-0 left-0 w-[3px] bg-rose-500" aria-hidden />}
      {job.priority !== 'normal' && late == null && (
        <span className={cn('absolute inset-y-0 left-0 w-[3px]', priorityMeta(job.priority).dot)} aria-hidden />
      )}
      <div className="flex items-center gap-1.5">
        <span className="whitespace-nowrap font-mono text-[10.5px] font-semibold tracking-wide text-slate-400">{job.reference}</span>
        <PriorityPill priority={job.priority} hideNormal />
        <span className="ml-auto flex items-center gap-1">
          {late != null ? <LateBadge minutes={late} /> : showStatus ? <JobStatusPill status={job.status} className="!px-1.5 !text-[10.5px]" /> : null}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-[13px] font-semibold leading-snug text-slate-900 dark:text-white">{job.title}</p>
      {job.customerName && <p className="mt-0.5 truncate text-[12px] text-slate-500 dark:text-slate-400">{job.customerName}</p>}
      {next && (
        <p className="mt-1.5 flex min-w-0 items-center gap-1 text-[11.5px] text-slate-500 dark:text-slate-400">
          <MapPin className="h-3 w-3 shrink-0 text-slate-400" />
          <span className="truncate">{next.name || next.address || 'Stop'}</span>
        </p>
      )}
      {showStatus && late != null && (
        <div className="mt-1.5">
          <JobStatusPill status={job.status} className="!px-1.5 !text-[10.5px]" />
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-2 border-t border-slate-100 pt-2 dark:border-white/[0.05]">
        <DriverAvatar name={driver?.name} />
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-slate-600 dark:text-slate-300">
          {driver?.name ?? <span className="text-slate-400">No driver</span>}
        </span>
        <StopProgress job={job} />
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
        {device ? (
          <span className="inline-flex min-w-0 items-center gap-1">
            <StatusDot status={device.status} />
            <Truck className="h-3 w-3 shrink-0 text-slate-400" />
            <span className="truncate">{device.name}</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-slate-400">
            <Truck className="h-3 w-3" /> No vehicle
          </span>
        )}
        {(job.dueBy || job.scheduledStart) && (
          <span className={cn('tabular ml-auto inline-flex shrink-0 items-center gap-1', late != null && 'font-semibold text-rose-600 dark:text-rose-400')}>
            <CalendarClock className="h-3 w-3" />
            {job.dueBy ? `Due ${fmtWhen(job.dueBy)}` : fmtWhen(job.scheduledStart)}
          </span>
        )}
      </div>
    </button>
  )
}
