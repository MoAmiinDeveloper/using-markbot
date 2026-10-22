import { cn } from '@/lib/cn'

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  size = 'md',
  className,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  /** accessible name */
  label: string
  disabled?: boolean
  size?: 'sm' | 'md'
  className?: string
}) {
  const sm = size === 'sm'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40',
        sm ? 'h-[18px] w-8' : 'h-5 w-9',
        checked ? 'bg-brand-600 dark:bg-brand-500' : 'bg-slate-300 dark:bg-white/15',
        className,
      )}
    >
      <span
        className={cn(
          'inline-block rounded-full bg-white shadow-sm transition-transform duration-150',
          sm ? 'h-3.5 w-3.5' : 'h-4 w-4',
          checked ? (sm ? 'translate-x-[16px]' : 'translate-x-[18px]') : 'translate-x-0.5',
        )}
      />
    </button>
  )
}
