import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Click-to-open dropdown menu anchored to its trigger. */
export function Menu({
  trigger,
  children,
  align = 'right',
  className,
}: {
  trigger: (p: { open: boolean; toggle: () => void }) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          role="menu"
          className={cn(
            'glass absolute top-full z-40 mt-1.5 min-w-[200px] animate-fade-in rounded-xl p-1.5',
            align === 'right' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({
  icon,
  title,
  text,
  onClick,
  disabled,
  right,
}: {
  icon?: ReactNode
  title: string
  text?: string
  onClick: () => void
  disabled?: boolean
  right?: ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-slate-900/5 disabled:opacity-50 dark:hover:bg-white/[0.07]"
    >
      {icon && <span className="shrink-0 [&>svg]:h-[18px] [&>svg]:w-[18px]">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-slate-900 dark:text-white">{title}</span>
        {text && <span className="block text-[11.5px] text-slate-500 dark:text-slate-400">{text}</span>}
      </span>
      {right}
    </button>
  )
}
