import type { ReactNode } from 'react'
import type { DeviceStatus } from '@/api/types'
import { STATUS_META } from '@/lib/status'
import { cn } from '@/lib/cn'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />
}

export function StatusDot({ status, pulse, className }: { status: DeviceStatus; pulse?: boolean; className?: string }) {
  const m = STATUS_META[status] ?? STATUS_META.offline
  return (
    <span className={cn('relative inline-flex h-2 w-2 shrink-0', className)} aria-hidden>
      {pulse && status === 'moving' && (
        <span className={cn('absolute inset-0 rounded-full animate-pulse-ring', m.dot)} />
      )}
      <span className={cn('relative inline-block h-2 w-2 rounded-full', m.dot)} />
    </span>
  )
}

export function StatusPill({ status, className }: { status: DeviceStatus; className?: string }) {
  const m = STATUS_META[status] ?? STATUS_META.offline
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        m.pill,
        className,
      )}
    >
      <StatusDot status={status} />
      {status === 'never' ? 'Never' : m.label}
    </span>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400 ring-1 ring-inset ring-slate-200 dark:bg-white/[0.04] dark:text-slate-500 dark:ring-white/[0.06]">
        {icon}
      </div>
      <p className="font-medium text-slate-900 dark:text-slate-100">{title}</p>
      {description && <p className="mt-1 max-w-xs text-[12.5px] text-slate-500 dark:text-slate-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-px font-sans text-[10.5px] font-medium text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
      {children}
    </kbd>
  )
}
