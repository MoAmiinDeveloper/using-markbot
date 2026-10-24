import { useQuery } from '@tanstack/react-query'
import { ClockAlert, Pencil, CircleCheck, ClipboardList, FilePlus2, ListChecks, LogIn, LogOut, MapPinCheck, MessageSquareText, Paperclip, RefreshCw, UserCheck, type LucideIcon } from 'lucide-react'
import { format } from 'date-fns'
import { api, qk } from '@/api/client'
import type { Job, JobEvent } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { EmptyState, Skeleton } from '@/components/ui/Misc'
import { useDrivers } from '@/features/common/queries'
import { useLive } from '@/store/live'
import { cn } from '@/lib/cn'
import { jobStatusMeta } from './meta'
import { useUsersLookup } from './queries'

interface Line {
  icon: LucideIcon
  color: string
  title: string
  detail?: string
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
const num = (v: unknown) => (typeof v === 'number' ? v : null)

export function JobTimeline({ job }: { job: Job }) {
  const tl = useQuery({ queryKey: qk.jobTimeline(job.id), queryFn: () => api.jobTimeline(job.id), staleTime: 10_000 })
  const users = useUsersLookup()
  const drivers = useDrivers()
  const byId = useLive((s) => s.byId)

  const who = (uid: number | null) => {
    if (uid == null) return 'System'
    const d = drivers.data?.find((x) => x.userId === uid)
    if (d) return d.name
    return users.data?.find((u) => u.id === uid)?.name ?? `User #${uid}`
  }
  const stop = (data: Record<string, unknown>) => {
    const id = num(data.stopId)
    const s = id != null ? job.stops.find((x) => x.id === id) : undefined
    return str(data.stopName) ?? str(data.name) ?? (s ? `${s.seq}. ${s.name}` : id != null ? `Stop #${id}` : 'a stop')
  }

  const describe = (e: JobEvent): Line => {
    const d = e.data ?? {}
    switch (e.kind) {
      case 'created':
        return { icon: FilePlus2, color: '#64748b', title: `Created by ${who(e.userId)}` }
      case 'assigned': {
        const drv = num(d.driverId)
        const dev = num(d.deviceId)
        const parts = [drv != null ? (drivers.data?.find((x) => x.id === drv)?.name ?? `Driver #${drv}`) : null, dev != null ? (byId[dev]?.name ?? `Vehicle #${dev}`) : null].filter(Boolean)
        const prev = num(d.previousDriverId)
        const prevName = prev != null ? (drivers.data?.find((x) => x.id === prev)?.name ?? `Driver #${prev}`) : null
        return { icon: UserCheck, color: '#3b82f6', title: parts.length ? `Assigned to ${parts.join(' · ')}` : 'Unassigned', detail: [prevName ? `was ${prevName}` : null, `by ${who(e.userId)}`].filter(Boolean).join(' · ') }
      }
      case 'status': {
        const to = str(d.status) ?? str(d.to) ?? ''
        const m = jobStatusMeta(to)
        const from = str(d.from)
        const reason = str(d.reason)
        return {
          icon: m.icon,
          color: m.color,
          title: `${m.label}${from ? ` (was ${jobStatusMeta(from).label.toLowerCase()})` : ''}`,
          detail: [reason ? `“${reason}”` : null, d.auto ? 'Detected from GPS' : `by ${who(e.userId)}`].filter(Boolean).join(' · '),
        }
      }
      case 'stopArrived':
        return { icon: LogIn, color: '#0ea5e9', title: `Arrived at ${stop(d)}`, detail: e.userId == null ? 'Detected from GPS' : `by ${who(e.userId)}` }
      case 'stopDeparted':
        return { icon: LogOut, color: '#8b5cf6', title: `Left ${stop(d)}`, detail: e.userId == null ? 'Detected from GPS' : undefined }
      case 'stopCompleted': {
        const st = str(d.status)
        return {
          icon: st === 'skipped' ? MapPinCheck : CircleCheck,
          color: st === 'skipped' ? '#f59e0b' : '#10b981',
          title: `${st === 'skipped' ? 'Skipped' : 'Completed'} ${stop(d)}`,
          detail: [str(d.notes) ? `“${str(d.notes)}”` : null, `by ${who(e.userId)}`].filter(Boolean).join(' · '),
        }
      }
      case 'stopSkipped':
        return { icon: MapPinCheck, color: '#f59e0b', title: `Skipped ${stop(d)}`, detail: [str(d.notes) ? `“${str(d.notes)}”` : null, `by ${who(e.userId)}`].filter(Boolean).join(' · ') }
      case 'checklist':
        return { icon: ListChecks, color: '#14b8a6', title: `${d.done === false ? 'Unchecked' : 'Checked'} “${str(d.text) ?? 'item'}”`, detail: `by ${who(e.userId)}` }
      case 'updated':
        return { icon: Pencil, color: '#64748b', title: 'Job edited', detail: `by ${who(e.userId)}` }
      case 'late':
        return { icon: ClockAlert, color: '#dc2626', title: 'Job is late', detail: str(d.dueBy) ? `Was due ${format(Date.parse(str(d.dueBy)!), 'd MMM, HH:mm')}` : undefined }
      case 'attachment':
        return { icon: Paperclip, color: '#a855f7', title: `Added ${str(d.kind) ?? 'a file'}${str(d.name) ? ` · ${str(d.name)}` : ''}`, detail: `by ${who(e.userId)}` }
      case 'note':
        return { icon: MessageSquareText, color: '#e6c200', title: str(d.text) ?? 'Note', detail: who(e.userId) }
      default:
        return { icon: ClipboardList, color: '#64748b', title: e.kind }
    }
  }

  if (tl.isLoading)
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    )
  if (tl.isError)
    return (
      <EmptyState
        icon={<RefreshCw className="h-5 w-5" />}
        title="Couldn’t load the timeline"
        action={
          <Button size="sm" onClick={() => void tl.refetch()}>
            Retry
          </Button>
        }
      />
    )
  const events = [...(tl.data ?? [])].sort((a, b) => b.time.localeCompare(a.time))
  if (!events.length) return <EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No activity yet" className="py-6" />

  return (
    <ol className="relative">
      {events.map((e, i) => {
        const l = describe(e)
        const Icon = l.icon
        const day = format(Date.parse(e.time), 'EEE d MMM')
        const showDay = i === 0 || format(Date.parse(events[i - 1].time), 'EEE d MMM') !== day
        return (
          <li key={e.id}>
            {showDay && <p className="label-xs mb-2 mt-1 !text-[10px]">{day}</p>}
            <div className="relative flex gap-3 pb-4">
              {i < events.length - 1 && <span className="absolute bottom-0 left-[13px] top-7 w-px bg-slate-200 dark:bg-white/10" aria-hidden />}
              <span className="relative grid h-7 w-7 shrink-0 place-items-center rounded-full" style={{ background: `${l.color}1f`, color: l.color }}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-start gap-2">
                  <p className={cn('min-w-0 flex-1 text-[12.5px] font-medium leading-snug text-slate-900 dark:text-white')}>{l.title}</p>
                  <span className="tabular shrink-0 text-[11px] text-slate-400">{format(Date.parse(e.time), 'HH:mm')}</span>
                </div>
                {l.detail && <p className="mt-0.5 text-[11.5px] text-slate-500 dark:text-slate-400">{l.detail}</p>}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
