import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from './Button'

function useDialogBehaviour(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  // parents often pass an inline onClose; keep the effect from re-running (and stealing focus) on every render
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        )
        if (f.length === 0) return
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    const t = window.setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current
      el?.focus()
    }, 30)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
      prev?.focus?.()
    }
  }, [open])
  return ref
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  bare,
  phoneFull,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  className?: string
  /** render only children (title stays as the accessible name) */
  bare?: boolean
  /** full-screen sheet on phones */
  phoneFull?: boolean
}) {
  const ref = useDialogBehaviour(open, onClose)
  if (!open) return null
  return createPortal(
    <div className={cn('fixed inset-0 z-50 grid grid-cols-[minmax(0,1fr)] place-items-center', phoneFull ? 'p-0 sm:p-4' : 'p-4')}>
      <div className="absolute inset-0 animate-fade-in bg-slate-950/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'relative w-full max-w-md animate-slide-up rounded-2xl border border-slate-200 bg-white p-5 shadow-panel focus:outline-none dark:border-white/10 dark:bg-ink-850',
          phoneFull && 'max-sm:h-full max-sm:max-w-none max-sm:rounded-none max-sm:border-0',
          className,
        )}
      >
        {!bare && <h2 className="text-[15px] font-semibold text-slate-900 dark:text-white">{title}</h2>}
        {!bare && description && <p className="mt-1.5 text-[13px] text-slate-500 dark:text-slate-400">{description}</p>}
        {children}
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide,
  bodyClassName,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  /** 560 px instead of 440 px */
  wide?: boolean
  bodyClassName?: string
}) {
  const ref = useDialogBehaviour(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 animate-fade-in bg-slate-950/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn('relative flex h-full w-full animate-slide-in-right', wide ? 'max-w-[560px]' : 'max-w-[440px]', ' flex-col border-l border-slate-200 bg-white shadow-panel focus:outline-none dark:border-white/10 dark:bg-ink-900')}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4 dark:border-white/[0.06]">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900 dark:text-white">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[12.5px] text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          <IconButton label="Close" onClick={onClose} size="sm">
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className={cn('flex-1 overflow-y-auto px-5 py-5', bodyClassName)}>{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-slate-200/80 px-5 py-3.5 dark:border-white/[0.06]">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
