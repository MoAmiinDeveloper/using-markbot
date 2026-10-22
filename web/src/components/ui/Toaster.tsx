import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { useToasts } from '@/store/toast'
import { cn } from '@/lib/cn'

export function Toaster() {
  const { toasts, dismiss } = useToasts()
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-3 sm:inset-x-auto sm:right-4 sm:top-4 sm:items-end"
    >
      {toasts.map((t) => {
        const Icon = t.kind === 'error' ? CircleAlert : t.kind === 'success' ? CircleCheck : Info
        return (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className="glass pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3 rounded-xl px-3.5 py-3"
          >
            <Icon
              className={cn(
                'mt-0.5 h-[18px] w-[18px] shrink-0',
                t.kind === 'error' ? 'text-rose-500' : t.kind === 'success' ? 'text-emerald-500' : 'text-brand-500',
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-900 dark:text-white">{t.title}</p>
              {t.message && <p className="mt-0.5 text-[12.5px] text-slate-500 dark:text-slate-400">{t.message}</p>}
            </div>
            <button
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
              className="rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
