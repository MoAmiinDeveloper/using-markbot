import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

const base =
  'w-full rounded-lg border bg-white text-[13px] text-slate-900 placeholder:text-slate-400 shadow-soft transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/40 dark:bg-white/[0.03] dark:text-slate-100 dark:placeholder:text-slate-500'
const borderOk = 'border-slate-200 focus:border-brand-500 dark:border-white/10 dark:focus:border-brand-400'
const borderErr = 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/30 dark:border-rose-500/60'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode
  invalid?: boolean
  trailing?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { icon, invalid, trailing, className, ...rest },
  ref,
) {
  return (
    <div className={cn('relative', className)}>
      {icon && (
        <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-slate-400">{icon}</span>
      )}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(base, invalid ? borderErr : borderOk, 'h-9 px-3', icon && 'pl-9', trailing && 'pr-9')}
        {...rest}
      />
      {trailing && <span className="absolute inset-y-0 right-1.5 grid place-items-center">{trailing}</span>}
    </div>
  )
})

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, children, ...rest },
  ref,
) {
  return (
    <div className={cn('relative', className)}>
      <select
        ref={ref}
        className={cn(base, invalid ? borderErr : borderOk, 'h-9 appearance-none pl-3 pr-9 dark:[color-scheme:dark]')}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  )
})

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string
  hint?: string
  error?: string | null
  required?: boolean
  children: (id: string, describedBy: string | undefined) => ReactNode
}) {
  const id = useId()
  const descId = `${id}-desc`
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      {children(id, error || hint ? descId : undefined)}
      {(error || hint) && (
        <p id={descId} className={cn('text-[12px]', error ? 'text-rose-500' : 'text-slate-500 dark:text-slate-400')}>
          {error || hint}
        </p>
      )}
    </div>
  )
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ invalid, className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(base, invalid ? borderErr : borderOk, 'min-h-[72px] resize-y px-3 py-2 leading-relaxed', className)}
        {...rest}
      />
    )
  },
)
