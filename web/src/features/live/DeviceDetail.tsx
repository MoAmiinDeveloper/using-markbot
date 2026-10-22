import { useState, type ReactNode } from 'react'
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
  X,
} from 'lucide-react'
import type { Device } from '@/api/types'
import { CategoryIcon, categoryMeta } from '@/lib/category'
import { STATUS_META } from '@/lib/status'
import { fmtCoord, fmtDateTime, fmtOdometer, fmtVoltage, headingLabel, timeAgo } from '@/lib/format'
import { useNow } from '@/store/now'
import { Button, IconButton } from '@/components/ui/Button'
import { StatusPill } from '@/components/ui/Misc'
import { cn } from '@/lib/cn'
import { SignalBars, SpeedGauge } from './SpeedGauge'
import { SourceBadge } from '@/components/ui/SourceBadge'
import { CommandsSection } from './Commands'
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

function fmtAttr(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
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
  const p = device.position
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
          <CategoryIcon category={device.category} className="h-5 w-5" />
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
      </div>

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
              <Metric icon={<Milestone />} label="Odometer" value={fmtOdometer(a.odometer)} />
              <Metric icon={<Mountain />} label="Altitude" value={`${Math.round(p.altitude)} m`} />
              <Metric icon={<Clock />} label="Device time" value={new Date(p.time).toLocaleTimeString()} />
            </div>

            <div className="mt-3 rounded-xl border border-slate-200/80 bg-white/60 dark:border-white/[0.06] dark:bg-white/[0.025]">
              <div className="flex items-center gap-3 px-3 py-2.5">
                <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="label-xs">Location</div>
                  <div className="tabular mt-0.5 truncate font-mono text-[12.5px] text-slate-900 dark:text-white">{fmtCoord(p.lat, p.lng)}</div>
                  <div className="mt-0.5 truncate text-[12px] text-slate-400 dark:text-slate-500">Address lookup not configured</div>
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
                All attributes <span className="ml-1 text-slate-400">({attrs.length})</span>
                <ChevronDown className={cn('ml-auto h-4 w-4 text-slate-400 transition-transform', rawOpen && 'rotate-180')} />
              </button>
              {rawOpen && (
                <dl className="grid animate-fade-in grid-cols-2 gap-x-3 gap-y-1 border-t border-slate-200/80 px-3 py-2.5 font-mono text-[11.5px] dark:border-white/[0.06]">
                  {attrs.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="truncate text-slate-500 dark:text-slate-400">{k}</dt>
                      <dd className="truncate text-right text-slate-900 dark:text-slate-100">{fmtAttr(v)}</dd>
                    </div>
                  ))}
                  {(['priority', 'eventId', 'serverTime'] as const).map((k) => (
                    <div key={k} className="contents">
                      <dt className="truncate text-slate-400 dark:text-slate-500">{k}</dt>
                      <dd className="truncate text-right text-slate-500 dark:text-slate-400">{String(p[k])}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
