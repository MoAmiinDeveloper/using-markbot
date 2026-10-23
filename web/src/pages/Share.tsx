import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Clock, Gauge, Link2Off, LoaderCircle, MapPinOff, Navigation, TimerOff } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import type { Device, PublicShare } from '@/api/types'
import { MapCanvas, useMapCtx } from '@/components/map/MapCanvas'
import { MapControls } from '@/components/map/MapControls'
import { VehicleLayer } from '@/components/map/VehicleLayer'
import { Logo } from '@/components/layout/Logo'
import { StatusPill } from '@/components/ui/Misc'
import { CategoryIcon } from '@/lib/category'
import { STATUS_META } from '@/lib/status'
import { headingLabel, timeAgo } from '@/lib/format'
import { APP_NAME } from '@/config'
import { cn } from '@/lib/cn'

const POLL_MS = 5000

function useTicker(ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(t)
  }, [ms])
  return now
}

function fmtLeft(ms: number) {
  if (ms <= 0) return 'expired'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m ${String(s % 60).padStart(2, '0')}s`
}

/** Centres on the vehicle once; afterwards the VehicleLayer follows it. */
function CenterOnce({ lng, lat }: { lng: number; lat: number }) {
  const { map } = useMapCtx()
  const done = useRef(false)
  useEffect(() => {
    if (!map || done.current) return
    done.current = true
    map.jumpTo({ center: [lng, lat], zoom: 14.5 })
  }, [map, lng, lat])
  return null
}

function toDevice(s: PublicShare): Device {
  return {
    id: 1,
    name: s.name,
    imei: '',
    protocol: '',
    plate: '',
    model: '',
    category: s.category,
    phone: '',
    status: s.status,
    lastSeen: s.position?.serverTime ?? s.position?.time ?? null,
    position: s.position,
    createdAt: '',
    speedLimit: 0,
    source: 'direct',
    commands: false,
  }
}

function Shell({ children, live = true }: { children: React.ReactNode; live?: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <header className="dark z-20 flex h-14 shrink-0 items-center gap-3 border-b-2 border-brand-500 bg-navy-700 px-3 text-white sm:px-4">
        <Logo size="h-10" className="text-white" />
        {live && <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11.5px] font-medium text-white/80">
          <span className="relative inline-flex h-2 w-2">
            <span className="absolute inset-0 animate-pulse-ring rounded-full bg-brand-500" />
            <span className="relative h-2 w-2 rounded-full bg-brand-500" />
          </span>
          Live location
        </span>}
      </header>
      <main className="relative min-h-0 flex-1">{children}</main>
    </div>
  )
}

function Message({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <Shell live={false}>
      <div className="grid h-full place-items-center bg-[var(--app-bg)] p-6">
        <div className="card w-full max-w-sm px-6 py-8 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-500/15 text-navy-700 dark:text-brand-300 [&>svg]:h-6 [&>svg]:w-6">{icon}</div>
          <h1 className="text-[17px] font-semibold text-slate-900 dark:text-white">{title}</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">{text}</p>
          <p className="mt-6 text-[11.5px] text-slate-400">Shared via {APP_NAME}</p>
        </div>
      </div>
    </Shell>
  )
}

/** Public, unauthenticated live-location page for a share link. */
export default function SharePage() {
  const { token = '' } = useParams()
  const now = useTicker()
  const q = useQuery({
    queryKey: ['publicShare', token],
    queryFn: () => api.publicShare(token),
    refetchInterval: (query) => (query.state.error instanceof ApiError && [404, 410].includes(query.state.error.status) ? false : POLL_MS),
    refetchIntervalInBackground: false,
    retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 3,
    meta: { silent: true },
  })
  const s = q.data
  const device = useMemo(() => (s ? toDevice(s) : null), [s])
  const devices = useMemo(() => (device ? [device] : []), [device])

  useEffect(() => {
    document.title = s ? `${s.name} · Live location · ${APP_NAME}` : `Live location · ${APP_NAME}`
  }, [s])

  const err = q.error instanceof ApiError ? q.error : null
  const left = s ? Date.parse(s.expiresAt) - now : 1
  if (err?.status === 410 || (s && left <= 0))
    return <Message icon={<TimerOff />} title="This link has expired" text="The owner stopped sharing this vehicle’s location, or the time limit was reached. Ask them for a new link." />
  if (err?.status === 404) return <Message icon={<Link2Off />} title="Link not found" text="Check that the link was copied completely. Share links look like …/share/abc123." />
  if (q.isLoading)
    return (
      <Shell>
        <div className="grid h-full place-items-center">
          <LoaderCircle className="h-6 w-6 animate-spin text-brand-500" />
        </div>
      </Shell>
    )
  if (!s || !device) return <Message icon={<Link2Off />} title="Can’t load this location" text={err?.message ?? 'Please try again in a moment.'} />

  const p = s.position
  const m = STATUS_META[s.status] ?? STATUS_META.offline
  const soon = left < 15 * 60_000
  return (
    <Shell>
      <MapCanvas className="absolute inset-0">
        <VehicleLayer devices={devices} selectedId={1} followId={1} cluster={false} hover={false} />
        {p && <CenterOnce lng={p.lng} lat={p.lat} />}
        <MapControls className="absolute right-2 top-2 z-10 sm:right-3 sm:top-3" />
        <section
          aria-label="Vehicle"
          className="glass absolute inset-x-2 bottom-2 z-10 rounded-2xl p-3.5 sm:inset-x-auto sm:bottom-4 sm:left-4 sm:w-[340px] sm:p-4"
        >
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ background: `${m.color}1f`, color: m.color }}>
              <CategoryIcon category={s.category} className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[16px] font-semibold tracking-tight text-slate-900 dark:text-white">{s.name}</h1>
              <div className="mt-1 flex items-center gap-2">
                <StatusPill status={s.status} />
                <span className="text-[12px] text-slate-500 dark:text-slate-400">{p ? `updated ${timeAgo(p.serverTime || p.time, now)}` : 'no position yet'}</span>
              </div>
            </div>
          </div>
          {p ? (
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-slate-200/80 bg-white/60 px-2.5 py-2 dark:border-white/[0.06] dark:bg-white/[0.025]">
                <div className="flex items-center gap-1 text-[10.5px] font-medium text-slate-500 dark:text-slate-400">
                  <Gauge className="h-3 w-3" /> Speed
                </div>
                <div className="tabular mt-0.5 text-[15px] font-semibold text-slate-900 dark:text-white">
                  {Math.round(p.speed)} <span className="text-[10.5px] font-medium text-slate-400">km/h</span>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200/80 bg-white/60 px-2.5 py-2 dark:border-white/[0.06] dark:bg-white/[0.025]">
                <div className="flex items-center gap-1 text-[10.5px] font-medium text-slate-500 dark:text-slate-400">
                  <Navigation className="h-3 w-3" /> Heading
                </div>
                <div className="tabular mt-0.5 text-[15px] font-semibold text-slate-900 dark:text-white">{headingLabel(p.course)}</div>
              </div>
              <div
                className={cn(
                  'rounded-xl border px-2.5 py-2',
                  soon ? 'border-amber-500/40 bg-amber-500/10' : 'border-slate-200/80 bg-white/60 dark:border-white/[0.06] dark:bg-white/[0.025]',
                )}
              >
                <div className="flex items-center gap-1 text-[10.5px] font-medium text-slate-500 dark:text-slate-400">
                  <Clock className="h-3 w-3" /> Expires in
                </div>
                <div className={cn('tabular mt-0.5 text-[15px] font-semibold', soon ? 'text-amber-700 dark:text-amber-300' : 'text-slate-900 dark:text-white')}>{fmtLeft(left)}</div>
              </div>
            </div>
          ) : (
            <p className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-3 text-[12.5px] text-slate-500 dark:border-white/10">
              <MapPinOff className="h-4 w-4" /> Waiting for the first position…
            </p>
          )}
          <p className="mt-2.5 text-center text-[11px] text-slate-400">Refreshes every 5 seconds · shared via {APP_NAME}</p>
        </section>
      </MapCanvas>
    </Shell>
  )
}
