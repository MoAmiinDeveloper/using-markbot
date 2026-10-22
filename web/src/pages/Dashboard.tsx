import { useMemo, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Activity, ArrowRight, CircleParking, Gauge, CirclePause, Truck, WifiOff } from 'lucide-react'
import { api } from '@/api/client'
import type { Device, DeviceStatus, Summary } from '@/api/types'
import { MapCanvas } from '@/components/map/MapCanvas'
import { VehicleLayer } from '@/components/map/VehicleLayer'
import { FitDevices } from '@/components/map/FitDevices'
import { EmptyState, Skeleton, StatusPill } from '@/components/ui/Misc'
import { useDeviceList, useLive } from '@/store/live'
import { useNow } from '@/store/now'
import { CategoryIcon } from '@/lib/category'
import { STATUS_META, countByStatus } from '@/lib/status'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'

function Kpi({
  label,
  value,
  total,
  icon,
  color,
  loading,
}: {
  label: string
  value: number
  total: number
  icon: ReactNode
  color: string
  loading: boolean
}) {
  const pct = total ? Math.round((value / total) * 100) : 0
  return (
    <div className="card relative overflow-hidden p-4">
      <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-[0.12] blur-xl" style={{ background: color }} />
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-slate-500 dark:text-slate-400">{label}</span>
        <span className="grid h-8 w-8 place-items-center rounded-lg [&>svg]:h-4 [&>svg]:w-4" style={{ background: `${color}1a`, color }}>
          {icon}
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-16" />
      ) : (
        <div className="tabular mt-2 text-[28px] font-semibold leading-none tracking-tight text-slate-900 dark:text-white">{value}</div>
      )}
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="tabular mt-1.5 text-[11.5px] text-slate-400">{total ? `${pct}% of fleet` : '—'}</div>
    </div>
  )
}

function Donut({ counts, total }: { counts: Record<DeviceStatus, number>; total: number }) {
  const r = 52
  const c = 2 * Math.PI * r
  let offset = 0
  const order: DeviceStatus[] = ['moving', 'idle', 'stopped', 'offline', 'never']
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <svg viewBox="0 0 140 140" className="h-40 w-40 shrink-0 -rotate-90" role="img" aria-label="Fleet status breakdown">
        <circle cx="70" cy="70" r={r} fill="none" strokeWidth="16" className="stroke-slate-100 dark:stroke-white/[0.05]" />
        {total > 0 &&
          order.map((s) => {
            const len = (counts[s] / total) * c
            const el = (
              <circle
                key={s}
                cx="70"
                cy="70"
                r={r}
                fill="none"
                stroke={STATUS_META[s].color}
                strokeWidth="16"
                strokeDasharray={`${Math.max(0, len - (counts[s] && len > 3 ? 2 : 0))} ${c}`}
                strokeDashoffset={-offset}
                className="transition-all duration-700"
              />
            )
            offset += len
            return counts[s] ? el : null
          })}
        <g className="rotate-90" style={{ transformOrigin: '70px 70px' }}>
          <text x="70" y="68" textAnchor="middle" className="fill-slate-900 text-[26px] font-semibold dark:fill-white">
            {total}
          </text>
          <text x="70" y="86" textAnchor="middle" className="fill-slate-400 text-[10px] font-medium uppercase tracking-wider">
            vehicles
          </text>
        </g>
      </svg>
      <ul className="w-full space-y-2">
        {order.map((s) => (
          <li key={s} className="flex items-center gap-2.5 text-[13px]">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_META[s].color }} />
            <span className="text-slate-600 dark:text-slate-300">{STATUS_META[s].label}</span>
            <span className="tabular ml-auto font-semibold text-slate-900 dark:text-white">{counts[s]}</span>
            <span className="tabular w-10 text-right text-[12px] text-slate-400">{total ? Math.round((counts[s] / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function VehicleRow({ d, right, now }: { d: Device; right: ReactNode; now: number }) {
  const nav = useNavigate()
  const m = STATUS_META[d.status]
  return (
    <li>
      <button
        type="button"
        onClick={() => nav(`/live?device=${d.id}`)}
        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-slate-900/[0.035] dark:hover:bg-white/[0.04]"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: `${m.color}1a`, color: m.color }}>
          <CategoryIcon category={d.category} className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-slate-900 dark:text-white">{d.name}</span>
          <span className="block truncate text-[12px] text-slate-500 dark:text-slate-400">
            {d.plate ? `${d.plate} · ` : ''}
            {timeAgo(d.lastSeen, now)}
          </span>
        </span>
        {right}
      </button>
    </li>
  )
}

function Panel({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('card flex flex-col p-4', className)}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[14px] font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export default function DashboardPage() {
  const devices = useDeviceList()
  const loaded = useLive((s) => s.loaded)
  const now = useNow()
  const summaryQ = useQuery({ queryKey: ['summary'], queryFn: api.summary, enabled: !loaded })

  // live counts once the device stream is loaded, /summary before that
  const counts: Summary = useMemo(() => {
    if (loaded) return { total: devices.length, ...countByStatus(devices) }
    return summaryQ.data ?? { total: 0, moving: 0, idle: 0, stopped: 0, offline: 0, never: 0 }
  }, [loaded, devices, summaryQ.data])
  const loading = !loaded && !summaryQ.data

  const fastest = useMemo(
    () => devices.filter((d) => d.status === 'moving' && d.position).sort((a, b) => b.position!.speed - a.position!.speed).slice(0, 6),
    [devices],
  )
  const recent = useMemo(
    () =>
      devices
        .filter((d) => d.lastSeen)
        .sort((a, b) => Date.parse(b.lastSeen!) - Date.parse(a.lastSeen!))
        .slice(0, 6),
    [devices],
  )

  const kpis: Array<{ key: keyof Summary; label: string; icon: ReactNode; color: string }> = [
    { key: 'total', label: 'Total vehicles', icon: <Truck />, color: '#e6c200' },
    { key: 'moving', label: 'Moving', icon: <Activity />, color: STATUS_META.moving.color },
    { key: 'idle', label: 'Idle', icon: <CirclePause />, color: STATUS_META.idle.color },
    { key: 'stopped', label: 'Stopped', icon: <CircleParking />, color: STATUS_META.stopped.color },
    { key: 'offline', label: 'Offline', icon: <WifiOff />, color: STATUS_META.offline.color },
  ]

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 p-3 sm:p-5 lg:p-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight text-slate-900 dark:text-white">Fleet overview</h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400">Live status across all vehicles · updates in real time</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
          {kpis.map((k, i) => (
            <div key={k.key} className={cn(i === 0 && 'col-span-2 md:col-span-1')}>
              <Kpi
                label={k.label}
                value={counts[k.key]}
                total={counts.total}
                icon={k.icon}
                color={k.color}
                loading={loading}
              />
            </div>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Status breakdown">
            <div className="flex flex-1 items-center">
              {loading ? <Skeleton className="h-40 w-full rounded-xl" /> : <Donut counts={counts} total={counts.total} />}
            </div>
          </Panel>
          <Panel
            title="Live map"
            className="lg:col-span-2"
            action={
              <Link to="/live" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-navy-600 hover:text-navy-500 dark:text-brand-300">
                Open map <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          >
            <div className="relative h-[260px] overflow-hidden rounded-xl border border-slate-200/80 dark:border-white/[0.06]">
              <MapCanvas className="absolute inset-0" zoom={9.6} attribution={false}>
                <VehicleLayer devices={devices} hover cluster={false} />
                <FitDevices devices={devices} />
              </MapCanvas>
            </div>
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Fastest right now" action={<Gauge className="h-4 w-4 text-slate-400" />}>
            {!loaded ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-xl" />
                ))}
              </div>
            ) : fastest.length === 0 ? (
              <EmptyState icon={<Activity className="h-5 w-5" />} title="No vehicles moving" description="Moving vehicles will appear here, ranked by speed." className="py-6" />
            ) : (
              <ul className="-mx-2">
                {fastest.map((d) => {
                  const pct = Math.min(100, (d.position!.speed / 140) * 100)
                  return (
                    <VehicleRow
                      key={d.id}
                      d={d}
                      now={now}
                      right={
                        <span className="flex w-36 shrink-0 items-center gap-2">
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]">
                            <span
                              className="block h-full rounded-full bg-gradient-to-r from-emerald-500 to-amber-400 transition-all duration-700"
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                          <span className="tabular w-[62px] text-right text-[13px] font-semibold text-slate-900 dark:text-white">
                            {Math.round(d.position!.speed)}
                            <span className="text-[10.5px] font-medium text-slate-400"> km/h</span>
                          </span>
                        </span>
                      }
                    />
                  )
                })}
              </ul>
            )}
          </Panel>
          <Panel title="Recently active">
            {!loaded ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-xl" />
                ))}
              </div>
            ) : recent.length === 0 ? (
              <EmptyState icon={<WifiOff className="h-5 w-5" />} title="No activity yet" className="py-6" />
            ) : (
              <ul className="-mx-2">
                {recent.map((d) => (
                  <VehicleRow key={d.id} d={d} now={now} right={<StatusPill status={d.status} />} />
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
