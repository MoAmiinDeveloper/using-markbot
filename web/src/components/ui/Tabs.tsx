import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Underlined page tabs (Maintenance, Admin…). */
export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  className,
}: {
  value: T
  onChange: (v: T) => void
  tabs: Array<{ id: T; label: string; icon?: ReactNode; count?: number; alert?: boolean }>
  className?: string
}) {
  return (
    <div role="tablist" className={cn('-mx-3 flex gap-1 overflow-x-auto border-b border-slate-200/80 px-3 dark:border-white/[0.07] sm:mx-0 sm:px-0', className)}>
      {tabs.map((t) => {
        const on = t.id === value
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={cn(
              'relative inline-flex h-10 shrink-0 items-center gap-1.5 px-2 text-[13px] sm:gap-2 sm:px-3 font-medium transition-colors [&>svg]:h-4 [&>svg]:w-4',
              on ? 'text-navy-700 dark:text-white' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
            )}
          >
            {t.icon}
            {t.label}
            {t.count != null && (
              <span
                className={cn(
                  'tabular rounded-full px-1.5 text-[11px] font-semibold',
                  t.alert ? 'bg-rose-500 text-white' : on ? 'bg-brand-500 text-navy-900' : 'bg-slate-100 text-slate-500 dark:bg-white/[0.08] dark:text-slate-300',
                )}
              >
                {t.count}
              </span>
            )}
            {on && <span className="absolute inset-x-2 -bottom-px h-[2.5px] rounded-full bg-brand-500" />}
          </button>
        )
      })}
    </div>
  )
}

/** Compact segmented control. */
export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  label,
  className,
  size = 'md',
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ id: T; label: ReactNode; title?: string }>
  label: string
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="group" aria-label={label} className={cn('flex gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-white/[0.05]', className)}>
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          title={o.title}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'flex-1 whitespace-nowrap rounded-md font-medium transition-colors',
            size === 'sm' ? 'h-6 px-2 text-[11.5px]' : 'h-8 px-2.5 text-[12.5px]',
            value === o.id
              ? 'bg-white text-slate-900 shadow-sm dark:bg-white/15 dark:text-white'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
