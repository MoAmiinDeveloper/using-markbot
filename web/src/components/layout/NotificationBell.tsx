import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Bell, BellOff, CheckCheck, Volume2, VolumeX } from 'lucide-react'
import { useAlerts, useUnreadCount } from '@/store/alerts'
import { useLive } from '@/store/live'
import { useNow } from '@/store/now'
import { IconButton } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Misc'
import { eventDetail, eventMeta } from '@/lib/events'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const nav = useNavigate()
  const now = useNow()
  const unread = useUnreadCount()
  const { recent, lastSeenId, muted, markAllRead, toggleMuted } = useAlerts()
  const byId = useLive((s) => s.byId)

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

  const items = recent.slice(0, 30)

  return (
    <div ref={ref} className="sm:relative">
      <IconButton
        label={unread ? `Notifications (${unread} unread)` : 'Notifications'}
        aria-haspopup="dialog"
        aria-expanded={open}
        active={open}
        onClick={() => setOpen((o) => !o)}
        className="relative"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="tabular absolute -right-0.5 -top-0.5 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-white dark:ring-ink-950">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </IconButton>
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="fixed inset-x-2 top-[60px] border border-slate-200 bg-white shadow-panel dark:border-white/10 dark:bg-ink-900 z-50 flex max-h-[min(560px,calc(100dvh-140px))] animate-fade-in flex-col overflow-hidden rounded-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[392px]"
        >
          <div className="flex items-center gap-1 border-b border-slate-200/80 py-2 pl-4 pr-2 dark:border-white/[0.07]">
            <div className="min-w-0 flex-1">
              <h2 className="text-[14px] font-semibold text-slate-900 dark:text-white">Notifications</h2>
              <p className="text-[11.5px] text-slate-500 dark:text-slate-400">
                {unread ? `${unread} unread` : 'You’re all caught up'}
              </p>
            </div>
            <IconButton size="sm" label={muted ? 'Unmute alert sounds' : 'Mute alert sounds'} onClick={toggleMuted} active={muted}>
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </IconButton>
            <IconButton size="sm" label="Mark all as read" onClick={markAllRead} disabled={!unread}>
              <CheckCheck className="h-4 w-4" />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {items.length === 0 ? (
              <EmptyState
                icon={<BellOff className="h-5 w-5" />}
                title="No alerts yet"
                description="Geofence, overspeed, ignition and alarm events will appear here in real time."
              />
            ) : (
              <ul>
                {items.map((e) => {
                  const m = eventMeta(e.type)
                  const Icon = m.icon
                  const isNew = e.id > lastSeenId
                  const detail = eventDetail(e)
                  const dev = byId[e.deviceId]
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false)
                          nav(`/live?device=${e.deviceId}`)
                        }}
                        className={cn(
                          'flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-slate-900/[0.04] dark:hover:bg-white/[0.05]',
                          e.type === 'alarm' && isNew && 'bg-rose-500/[0.06]',
                        )}
                      >
                        <span className={cn('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg', m.chip)}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn('block leading-snug text-slate-800 dark:text-slate-200', isNew && 'font-medium text-slate-950 dark:text-white')}>
                            {e.message}
                          </span>
                          <span className="mt-0.5 block truncate text-[11.5px] text-slate-500 dark:text-slate-400">
                            {m.label}
                            {detail ? ` · ${detail}` : ''}
                            {dev && !e.message.includes(dev.name) ? ` · ${dev.name}` : ''}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
                          <span className="tabular whitespace-nowrap text-[11px] text-slate-400">{timeAgo(e.time, now)}</span>
                          {isNew && <span className="h-2 w-2 rounded-full bg-brand-500" aria-label="unread" />}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              markAllRead()
              nav('/alerts')
            }}
            className="flex items-center justify-center gap-1.5 border-t border-slate-200/80 py-2.5 text-[12.5px] font-medium text-navy-600 hover:bg-slate-900/[0.03] dark:border-white/[0.07] dark:text-brand-300 dark:hover:bg-white/[0.04]"
          >
            View all alerts <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
