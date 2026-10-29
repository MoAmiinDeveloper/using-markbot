import { lazy, Suspense, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Battery,
  Check,
  ChevronDown,
  Clock,
  Compass,
  Copy,
  Crosshair,
  History,
  Key,
  MapPin,
  Mountain,
  Plug,
  Satellite,
  Signal,
  Milestone,
  Share2,
  Timer,
  UserRound,
  X,
} from 'lucide-react'
import { useDrivers } from '@/features/common/queries'
import { useAddress } from '@/lib/geocode'
import { useAccess } from '@/lib/access'
import { placeMeta } from '@/lib/ops'
const SensorTiles = lazy(() => import('@/features/sensors/SensorTiles').then((m) => ({ default: m.SensorTiles })))
const ShareDialog = lazy(() => import('./ShareDialog').then((m) => ({ default: m.ShareDialog })))
import type { Device } from '@/api/types'
import { CategoryIcon, categoryMeta } from '@/lib/category'
import { STATUS_META } from '@/lib/status'
import { fmtCoord, fmtDateTime, fmtHours, fmtKm, fmtOdometer, fmtVoltage, headingLabel, timeAgo } from '@/lib/format'
import { useNow } from '@/store/now'
import { Button, IconButton } from '@/components/ui/Button'
import { StatusPill } from '@/components/ui/Misc'
import { cn } from '@/lib/cn'
import { SignalBars, SpeedGauge } from './SpeedGauge'
import { SourceBadge } from '@/components/ui/SourceBadge'
import { CommandsSection } from './Commands'
import { ParamsTable } from '@/features/params/ParamsTable'
import { RecentAlerts } from './RecentAlerts'

function Metric({ icon, label, value, accent }: { icon: ReactNode; label: string; value: ReactNode; accent?: string }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white/60 px-3 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.025]">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
        <span className="text-slate-400 dark:text-slate-500 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
        {label}
      </div>
      <div className={cn('tabular mt-1 truncate text-[14px] font-semibold text-slate-900 dark:text-white', accent)}>{value}</div>
    </div>
  )
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <IconButton
      size="sm"
      label={done ? 'Copied' : label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true)
          window.setTimeout(() => setDone(false), 1400)
        })
      }}
    >
      {done ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </IconButton>
  )
}

export function DeviceDetail({
  device,
  following,
  onToggleFollow,
  onClose,
}: {
  device: Device
  following: boolean
  onToggleFollow: () => void
  onClose: () => void
}) {
  const now = useNow()
  const nav = useNavigate()
  const [rawOpen, setRawOpen] = useState(false)
  const [sharing, setSharing] = useState(false)
  const { canManageDevice } = useAccess()
  const canShare = canManageDevice(device)
  const p = device.position
  const geo = useAddress(p?.lat, p?.lng)
  const drivers = useDrivers()
  const tag = typeof p?.attributes?.driverId === 'string' ? (p.attributes.driverId as string).toLowerCase() : null
  const driver =
    (tag ? drivers.data?.find((d) => d.tag && d.tag.toLowerCase() === tag) : undefined) ??
    (device.driverId != null ? drivers.data?.find((d) => d.id === device.driverId) : undefined) ??
    drivers.data?.find((d) => d.deviceId === device.id)
  const a = p?.attributes ?? {}
  const m = STATUS_META[device.status] ?? STATUS_META.offline
  const ignition = typeof a.ignition === 'boolean' ? a.ignition : null
  const rssi = typeof a.rssi === 'number' ? a.rssi : null
  const attrs = Object.entries(a).sort(([x], [y]) => x.localeCompare(y, undefined, { numeric: true }))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex justify-center pt-2 md:hidden">
        <span className="h-1 w-10 rounded-full bg-slate-300 dark:bg-white/20" />
      </div>
      {/* header */}
      <div className="flex items-start gap-3 px-4 pb-3 pt-3 md:pt-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ background: `${m.color}1f`, color: m.color }}>
          <CategoryIcon category={device.category} icon={device.icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] font-semibold tracking-tight text-slate-900 dark:text-white">{device.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-slate-500 dark:text-slate-400">
            <StatusPill status={device.status} />
            {device.plate && (
              <span className="rounded border border-slate-200 px-1.5 text-[11px] font-medium uppercase tracking-wide dark:border-white/10">
                {device.plate}
              </span>
            )}
            <span>{categoryMeta(device.category).label}</span>
            <SourceBadge source={device.source} />
          </div>
        </div>
        <IconButton label="Close details" onClick={onClose} size="sm">
          <X className="h-4 w-4" />
        </IconButton>
      </div>

      <div className="flex gap-2 px-4 pb-3">
        <Button
          size="sm"
          variant={following ? 'primary' : 'secondary'}
          icon={<Crosshair className="h-3.5 w-3.5" />}
          onClick={onToggleFollow}
          disabled={!p}
          aria-pressed={following}
          className="flex-1"
        >
          {following ? 'Following' : 'Follow'}
        </Button>
        <Button
          size="sm"
          icon={<History className="h-3.5 w-3.5" />}
          onClick={() => nav(`/history?device=${device.id}`)}
          className="flex-1"
        >
          History
        </Button>
        {canShare && (
          <Button size="sm" icon={<Share2 className="h-3.5 w-3.5" />} onClick={() => setSharing(true)} className="flex-1">
            Share
          </Button>
        )}
      </div>
      {canShare && sharing && (
        <Suspense fallback={null}>
          <ShareDialog device={device} open={sharing} onClose={() => setSharing(false)} />
        </Suspense>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {!p ? (
          <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-[12.5px] text-slate-500 dark:border-white/10 dark:text-slate-400">
            This device hasn’t reported a position yet.
            <div className="mt-1 font-mono text-[11.5px]">IMEI {device.imei}</div>
          </div>
        ) : null}
        {!p && <CommandsSection device={device} />}
        {p && (
          <>
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/60 py-1 pl-1 pr-4 dark:border-white/[0.06] dark:bg-white/[0.025]">
              <SpeedGauge speed={p.speed} />
              <div className="min-w-0 flex-1 space-y-2.5 text-[12.5px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Heading</span>
                  <span className="tabular inline-flex items-center gap-1 font-medium text-slate-900 dark:text-white">
                    <Compass className="h-3.5 w-3.5 text-slate-400" style={{ transform: `rotate(${p.course - 45}deg)` }} />
                    {Math.round(p.course)}° {headingLabel(p.course)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Updated</span>
                  <span className="font-medium text-slate-900 dark:text-white">{timeAgo(device.lastSeen, now)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">GPS fix</span>
                  <span className={cn('font-medium', p.valid ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                    {p.valid ? 'Valid' : 'Invalid'}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white/60 px-3 py-2 dark:border-white/[0.06] dark:bg-white/[0.025]">
              <span
                className={cn(
                  'grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
                  driver ? 'bg-navy-700 text-brand-400 dark:bg-white/[0.08] dark:text-brand-300' : 'bg-slate-100 text-slate-400 dark:bg-white/[0.05]',
                )}
              >
                {driver ? driver.name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase() : <UserRound className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="label-xs !text-[10px]">Driver{driver && tag && driver.tag?.toLowerCase() === tag ? ' · identified by tag' : ''}</div>
                <div className="truncate text-[13px] font-medium text-slate-900 dark:text-white">{driver ? driver.name : <span className="font-normal text-slate-400">No driver assigned</span>}</div>
              </div>
              {driver?.phone && (
                <a href={`tel:${driver.phone.replace(/\s/g, '')}`} className="shrink-0 text-[12px] font-medium text-navy-600 hover:underline dark:text-brand-300">
                  {driver.phone}
                </a>
              )}
            </div>

            {!!device.sensors?.length && (
              <Suspense fallback={<div className="skeleton mt-3 h-24 rounded-xl" />}>
                <SensorTiles device={device} canConfigure={canShare} />
              </Suspense>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Metric
                icon={<Key />}
                label="Ignition"
                value={ignition == null ? '—' : ignition ? 'On' : 'Off'}
                accent={ignition ? 'text-emerald-600 dark:text-emerald-400' : undefined}
              />
              <Metric icon={<Plug />} label="Power" value={fmtVoltage(a.power)} />
              <Metric icon={<Battery />} label="Battery" value={fmtVoltage(a.battery)} />
              <Metric icon={<Satellite />} label="Satellites" value={p.satellites} />
              <Metric
                icon={<Signal />}
                label="GSM signal"
                value={
                  <span className="inline-flex items-center gap-2">
                    <SignalBars level={rssi} /> {rssi == null ? '—' : `${rssi}/5`}
                  </span>
                }
              />
              <Metric icon={<Milestone />} label="Odometer" value={device.odometer != null ? fmtKm(device.odometer) : fmtOdometer(a.odometer)} />
              <Metric icon={<Timer />} label="Engine hours" value={fmtHours(device.engineHours)} />
              <Metric icon={<Mountain />} label="Altitude" value={`${Math.round(p.altitude)} m`} />
              <Metric icon={<Clock />} label="Device time" value={new Date(p.time).toLocaleTimeString()} />
            </div>

            <div className="mt-3 rounded-xl border border-slate-200/80 bg-white/60 dark:border-white/[0.06] dark:bg-white/[0.025]">
              <div className="flex items-center gap-3 px-3 py-2.5">
                <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="label-xs">Location</div>
                  {geo.data?.place && (
                    <div className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full bg-brand-500/12 px-2 py-0.5 text-[11.5px] font-semibold text-navy-700 dark:text-brand-200">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: geo.data.place.color || placeMeta(geo.data.place.category).color }} />
                      <span className="truncate">At {geo.data.place.name}</span>
                    </div>
                  )}
                  {geo.isLoading ? (
                    <div className="skeleton mt-1 h-4 w-3/4" />
                  ) : geo.data?.address ? (
                    <div className="mt-0.5 line-clamp-2 text-[13px] font-medium leading-snug text-slate-900 dark:text-white" title={geo.data.address}>
                      {geo.data.address}
                    </div>
                  ) : null}
                  <div className={cn('tabular mt-0.5 truncate font-mono', geo.data?.address ? 'text-[11.5px] text-slate-500 dark:text-slate-400' : 'text-[12.5px] text-slate-900 dark:text-white')}>
                    {fmtCoord(p.lat, p.lng)}
                  </div>
                </div>
                <CopyButton text={fmtCoord(p.lat, p.lng)} label="Copy coordinates" />
              </div>
              <div className="h-px bg-slate-200/80 dark:bg-white/[0.06]" />
              <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 px-3 py-2.5 text-[12.5px]">
                <dt className="text-slate-500 dark:text-slate-400">Last update</dt>
                <dd className="tabular text-right text-slate-900 dark:text-white">{device.lastSeen ? fmtDateTime(device.lastSeen) : '—'}</dd>
                <dt className="text-slate-500 dark:text-slate-400">IMEI</dt>
                <dd className="tabular text-right font-mono text-[12px] text-slate-900 dark:text-white">{device.imei}</dd>
                <dt className="text-slate-500 dark:text-slate-400">Model</dt>
                <dd className="text-right text-slate-900 dark:text-white">
                  {device.model || '—'} <span className="text-slate-400">· {device.protocol}</span>
                </dd>
                {device.phone && (
                  <>
                    <dt className="text-slate-500 dark:text-slate-400">SIM</dt>
                    <dd className="tabular text-right text-slate-900 dark:text-white">{device.phone}</dd>
                  </>
                )}
                {device.details?.owner.name && (
                  <>
                    <dt className="text-slate-500 dark:text-slate-400">Owner</dt>
                    <dd className="truncate text-right text-slate-900 dark:text-white">
                      {device.details.owner.name}
                      {device.details.owner.phone && (
                        <a href={`tel:${device.details.owner.phone.replace(/\s/g, '')}`} className="ml-1.5 text-navy-700 hover:underline dark:text-brand-300">
                          {device.details.owner.phone}
                        </a>
                      )}
                    </dd>
                  </>
                )}
                {(device.details?.vehicle.make || device.details?.vehicle.model) && (
                  <>
                    <dt className="text-slate-500 dark:text-slate-400">Vehicle</dt>
                    <dd className="truncate text-right text-slate-900 dark:text-white">
                      {[device.details.vehicle.make, device.details.vehicle.model, device.details.vehicle.year || ''].filter(Boolean).join(' ')}
                    </dd>
                  </>
                )}
              </dl>
            </div>

            <RecentAlerts deviceId={device.id} />
            <CommandsSection device={device} />

            <div className="mt-3 overflow-hidden rounded-xl border border-slate-200/80 dark:border-white/[0.06]">
              <button
                type="button"
                onClick={() => setRawOpen((o) => !o)}
                aria-expanded={rawOpen}
                className="flex w-full items-center justify-between bg-white/60 px-3 py-2.5 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50 dark:bg-white/[0.025] dark:text-slate-300 dark:hover:bg-white/[0.05]"
              >
                All parameters <span className="ml-1 text-slate-400">({attrs.length + 7})</span>
                <ChevronDown className={cn('ml-auto h-4 w-4 text-slate-400 transition-transform', rawOpen && 'rotate-180')} />
              </button>
              {rawOpen && (
                <div className="animate-fade-in border-t border-slate-200/80 p-2 dark:border-white/[0.06]">
                  <ParamsTable device={device} compact />
                  <button type="button" onClick={() => nav(`/parameters?device=${device.id}`)} className="mt-2 w-full text-center text-[12px] font-medium text-navy-700 hover:underline dark:text-brand-300">
                    Open full table, formulas & custom events
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
