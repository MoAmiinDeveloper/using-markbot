import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useToasts, type Toast } from '@/store/toast'
import { eventDetail, eventMeta } from '@/lib/events'
import { fmtTime } from '@/lib/format'
import { cn } from '@/lib/cn'

function EventToast({ t, onDismiss }: { t: Toast; onDismiss: () => void }) {
  const nav = useNavigate()
  const e = t.event!
  const m = eventMeta(e.type)
  const Icon = m.icon
  const alarm = e.type === 'alarm'
  const detail = eventDetail(e)
  const open = () => {
    nav(`/live?device=${e.deviceId}`)
    onDismiss()
  }
  return (
    <div
      role={alarm ? 'alert' : 'status'}
      className={cn(
        'glass pointer-events-auto relative flex w-full max-w-sm animate-slide-up items-start gap-3 overflow-hidden rounded-xl py-3 pl-3 pr-2.5',
        alarm && '!border-rose-500/50 !bg-rose-50/95 ring-1 ring-rose-500/40 dark:!bg-[#2a0f17]/95',
      )}
    >
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: m.color }} aria-hidden />
      <button
        type="button"
        onClick={open}
        className="flex min-w-0 flex-1 items-start gap-3 text-left"
        aria-label={`${e.message} — show on map`}
      >
        <span className={cn('relative grid h-9 w-9 shrink-0 place-items-center rounded-xl', m.chip, alarm && '!bg-rose-500 !text-white')}>
          {alarm && <span className="absolute inset-0 animate-pulse-ring rounded-xl bg-rose-500" aria-hidden />}
          <Icon className="relative h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('label-xs !text-[10.5px]', alarm && '!text-rose-600 dark:!text-rose-300')}>
            {m.label}
            {t.deviceName ? <span className="normal-case tracking-normal"> · {t.deviceName}</span> : null}
          </span>
          <span className={cn('mt-0.5 block font-medium leading-snug text-slate-900 dark:text-white', alarm && '!font-semibold')}>
            {e.message}
          </span>
          <span className="mt-0.5 block text-[12px] text-slate-500 dark:text-slate-400">
            {detail ? `${detail} · ` : ''}
            {fmtTime(e.time)}
          </span>
        </span>
      </button>
      <button
        aria-label="Dismiss"
        onClick={onDismiss}
        className="rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

export function Toaster() {
  const { toasts, dismiss } = useToasts()
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-3 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:top-auto sm:items-end"
    >
      {toasts.map((t) => {
        if (t.kind === 'event' && t.event) return <EventToast key={t.id} t={t} onDismiss={() => dismiss(t.id)} />
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
                t.kind === 'error' ? 'text-rose-500' : t.kind === 'success' ? 'text-emerald-500' : 'text-navy-600',
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
