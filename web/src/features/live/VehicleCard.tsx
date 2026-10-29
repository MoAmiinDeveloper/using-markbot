import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellRing, ChevronRight, History, MapPin, Share2, UserRound } from 'lucide-react'
import type { Device } from '@/api/types'
import { CategoryIcon } from '@/lib/category'
import { STATUS_META } from '@/lib/status'
import { fmtSince, timeAgo } from '@/lib/format'
import { useAddress } from '@/lib/geocode'
import { cn } from '@/lib/cn'

/** Fixed card height (the list is virtualised). */
export const CARD_H = 196

export interface Tile {
  value: string
  label: string
  tone?: 'on' | 'off'
}

/** Up to a handful of at-a-glance values: sensors first, then ignition, speed and voltages. */
export function vehicleTiles(d: Device): Tile[] {
  const tiles: Tile[] = []
  for (const s of d.sensors ?? []) {
    if (s.value == null) continue
    const v = Math.abs(s.value) >= 100 ? Math.round(s.value).toLocaleString() : (Math.round(s.value * 10) / 10).toString()
    tiles.push({ value: `${v}${s.unit ? ` ${s.unit}` : ''}`, label: s.name })
  }
  const a = d.position?.attributes ?? {}
  if (typeof a.ignition === 'boolean') tiles.push({ value: a.ignition ? 'ON' : 'OFF', label: 'Ignition', tone: a.ignition ? 'on' : 'off' })
  if (d.position) tiles.push({ value: `${Math.round(d.position.speed)} km/h`, label: 'Speed' })
  if (typeof a.power === 'number') tiles.push({ value: `${a.power.toFixed(1)} V`, label: 'Ext. voltage' })
  if (typeof a.battery === 'number') tiles.push({ value: `${a.battery.toFixed(1)} V`, label: 'Battery' })
  return tiles
}

/** Address of a card, looked up only while the card is on screen (and at most every 30 s while moving). */
export function CardAddress({ d, className }: { d: Device; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '120px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  const geo = useAddress(visible ? d.position?.lat : null, visible ? d.position?.lng : null, 30_000)
  const text = geo.data?.place ? `At ${geo.data.place.name}` : geo.data?.address
  return (
    <p ref={ref} className={cn('flex min-w-0 items-center gap-1.5 text-[12px] text-slate-600 dark:text-slate-300', className)}>
      <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      <span className={cn('truncate', !text && 'text-slate-400')} title={text}>
        {text ?? (d.position ? `${d.position.lat.toFixed(5)}, ${d.position.lng.toFixed(5)}` : 'No location yet')}
      </span>
    </p>
  )
}

function Action({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-navy-50 hover:text-navy-700 dark:hover:bg-white/10 dark:hover:text-white"
    >
      {children}
    </button>
  )
}

/** Vehicle card of the live list: status & duration, today's distance, address, driver and key values. */
export function VehicleCard({
  d,
  selected,
  onSelect,
  onShare,
  driverName,
  now,
}: {
  d: Device
  selected: boolean
  onSelect: () => void
  onShare?: () => void
  driverName?: string
  now: number
}) {
  const nav = useNavigate()
  const m = STATUS_META[d.status] ?? STATUS_META.offline
  const tiles = vehicleTiles(d)
  const since = fmtSince(d.statusSince, now)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect())}
      aria-current={selected || undefined}
      className={cn(
        'group relative flex h-[188px] cursor-pointer flex-col gap-1.5 overflow-hidden rounded-xl border bg-white p-3 text-left transition-all dark:bg-white/[0.03]',
        selected
          ? 'border-brand-500 shadow-[0_0_0_3px_rgb(255_215_0/0.25)]'
          : 'border-slate-200/80 hover:border-navy-200 hover:shadow-card dark:border-white/[0.06] dark:hover:border-white/15',
      )}
    >
      {/* status accent */}
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: m.color }} aria-hidden />
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: `${m.color}1a`, color: m.color }}>
          <CategoryIcon category={d.category} icon={d.icon} className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13.5px] font-semibold text-navy-800 dark:text-white">{d.name}</span>
            {d.plate && (
              <span className="shrink-0 rounded border border-slate-200 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:border-white/10 dark:text-slate-400">
                {d.plate}
              </span>
            )}
          </div>
          <p className="truncate text-[12px]">
            <span className={cn('font-semibold', m.text)}>
              {m.label}
              {since && `: ${since}`}
            </span>
            {d.todayKm != null && (
              <span className="text-slate-500 dark:text-slate-400">
                {' '}
                <span className="text-slate-300 dark:text-slate-600">|</span> Today: {d.todayKm.toLocaleString(undefined, { maximumFractionDigits: 1 })} km
              </span>
            )}
          </p>
        </div>
        <div className="-mr-1 flex shrink-0 items-center opacity-80 group-hover:opacity-100">
          {onShare && (
            <Action label={`Share ${d.name}’s live location`} onClick={onShare}>
              <Share2 className="h-3.5 w-3.5" />
            </Action>
          )}
          <Action label={`History of ${d.name}`} onClick={() => nav(`/history?device=${d.id}`)}>
            <History className="h-3.5 w-3.5" />
          </Action>
          <Action label={`Alerts of ${d.name}`} onClick={() => nav(`/alerts?device=${d.id}`)}>
            <BellRing className="h-3.5 w-3.5" />
          </Action>
        </div>
      </div>
      <p className="text-[11px] text-slate-400">Last data received {timeAgo(d.lastSeen, now)}</p>
      <CardAddress d={d} />
      <p className="flex min-w-0 items-center gap-1.5 text-[12px] text-slate-600 dark:text-slate-300">
        <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span className={cn('truncate', !driverName && 'text-slate-400')}>{driverName ?? 'No driver assigned'}</span>
      </p>
      <div className="mt-auto flex items-stretch gap-1.5">
        {tiles.slice(0, 3).map((t) => (
          <div key={t.label} className="min-w-0 flex-1 rounded-lg border border-slate-200/80 bg-navy-50/40 px-2 py-1 text-center dark:border-white/[0.06] dark:bg-white/[0.03]">
            <div
              className={cn(
                'tabular truncate text-[12.5px] font-semibold',
                t.tone === 'on' ? 'text-emerald-600 dark:text-emerald-400' : t.tone === 'off' ? 'text-slate-500' : 'text-navy-800 dark:text-white',
              )}
            >
              {t.value}
            </div>
            <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">{t.label}</div>
          </div>
        ))}
        {tiles.length === 0 && <div className="flex-1 rounded-lg border border-dashed border-slate-200 py-2 text-center text-[11px] text-slate-400 dark:border-white/10">No data yet</div>}
        <span className="grid w-5 shrink-0 place-items-center text-slate-300 group-hover:text-navy-500" aria-hidden>
          <ChevronRight className="h-4 w-4" />
        </span>
      </div>
    </div>
  )
}
