import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, BellRing } from 'lucide-react'
import { api, qk } from '@/api/client'
import type { EventQuery } from '@/api/types'
import { useNow } from '@/store/now'
import { Skeleton } from '@/components/ui/Misc'
import { eventDetail, eventMeta } from '@/lib/events'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'

/** "Recent alerts" for one vehicle in the Live Map detail panel. */
export function RecentAlerts({ deviceId }: { deviceId: number }) {
  const nav = useNavigate()
  const now = useNow()
  const q: EventQuery = { deviceId, limit: 5 }
  const events = useQuery({
    queryKey: qk.events(q),
    queryFn: () => api.events(q),
    meta: { silent: true },
  })
  const list = events.data ?? []

  return (
    <section aria-label="Recent alerts" className="mt-3 overflow-hidden rounded-xl border border-slate-200/80 bg-white/60 dark:border-white/[0.06] dark:bg-white/[0.025]">
      <header className="flex items-center gap-2 px-3 pb-1.5 pt-2.5">
        <BellRing className="h-4 w-4 text-slate-400" />
        <h3 className="flex-1 text-[12.5px] font-semibold text-slate-900 dark:text-white">Recent alerts</h3>
        <button
          type="button"
          onClick={() => nav(`/alerts?device=${deviceId}`)}
          className="inline-flex items-center gap-1 rounded text-[11.5px] font-medium text-navy-600 hover:text-navy-500 dark:text-brand-300"
        >
          View all <ArrowRight className="h-3 w-3" />
        </button>
      </header>
      {events.isLoading ? (
        <div className="space-y-1.5 px-3 pb-3 pt-1">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : list.length === 0 ? (
        <p className="px-3 pb-3 pt-1 text-[12px] text-slate-500 dark:text-slate-400">
          {events.isError ? 'Alerts unavailable.' : 'No alerts in the last 7 days.'}
        </p>
      ) : (
        <ul className="px-1.5 pb-1.5">
          {list.map((e) => {
            const m = eventMeta(e.type)
            const Icon = m.icon
            const detail = eventDetail(e)
            return (
              <li key={e.id}>
                <button
                  type="button"
                  title="Show where it happened"
                  onClick={() => nav(`/live?device=${deviceId}&at=${e.lat.toFixed(6)},${e.lng.toFixed(6)}&evt=${e.type}`)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-slate-900/[0.04] dark:hover:bg-white/[0.05]"
                >
                  <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg', m.chip)}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-slate-800 dark:text-slate-100">{m.label}</span>
                    {detail && <span className="block truncate text-[11.5px] text-slate-500 dark:text-slate-400">{detail}</span>}
                  </span>
                  <span className="tabular shrink-0 text-[11px] text-slate-400">{timeAgo(e.time, now)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
