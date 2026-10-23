import { useState } from 'react'
import { format } from 'date-fns'
import type { DashboardData } from '@/api/types'
import { scoreTone } from '@/components/ui/Badges'
import { eventMeta } from '@/lib/events'
import { cn } from '@/lib/cn'

const kmFmt = (km: number) => (km >= 10000 ? `${Math.round(km / 1000)}k` : km >= 1000 ? `${(km / 1000).toFixed(1)}k` : `${Math.round(km)}`)

function niceMax(v: number) {
  if (v <= 0) return 10
  const p = 10 ** Math.floor(Math.log10(v))
  const n = v / p
  return ([1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => n <= s) ?? 10) * p
}

/** Distance per day, gold bars with a hover read-out. */
export function DistanceBars({ data }: { data: DashboardData['distanceByDay'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = niceMax(Math.max(...data.map((d) => d.distance), 0))
  const n = data.length
  const W = 600
  const H = 180
  const gap = n > 14 ? 3 : 8
  const bw = (W - gap * (n - 1)) / Math.max(1, n)
  const total = data.reduce((s, d) => s + d.distance, 0)
  const avg = n ? total / n : 0
  const h = hover != null ? data[hover] : null
  return (
    <div>
      <div className="mb-3 flex items-end gap-6">
        <div>
          <div className="tabular text-[26px] font-semibold leading-none tracking-tight text-slate-900 dark:text-white">
            {Math.round(total).toLocaleString()} <span className="text-[13px] font-medium text-slate-400">km</span>
          </div>
          <div className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">total · {Math.round(avg).toLocaleString()} km/day average</div>
        </div>
        <div className="tabular ml-auto min-h-[34px] text-right text-[12px]" aria-live="polite">
          {h && (
            <>
              <div className="font-semibold text-slate-900 dark:text-white">{Math.round(h.distance).toLocaleString()} km</div>
              <div className="text-slate-500">{format(new Date(`${h.date}T00:00:00`), 'EEE d MMM')}</div>
            </>
          )}
        </div>
      </div>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex flex-col justify-between pb-5 text-[10px] text-slate-400">
          <span className="tabular">{kmFmt(max)}</span>
          <span className="tabular">{kmFmt(max / 2)}</span>
          <span className="tabular">0</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H + 20}`} className="ml-8 block h-[200px] w-[calc(100%-32px)]" preserveAspectRatio="none" role="img" aria-label="Distance by day" onMouseLeave={() => setHover(null)}>
          {[0, 0.5, 1].map((k) => (
            <line key={k} x1="0" x2={W} y1={H * k + 0.5} y2={H * k + 0.5} className="stroke-slate-200 dark:stroke-white/[0.07]" strokeDasharray={k === 1 ? undefined : '3 4'} vectorEffect="non-scaling-stroke" />
          ))}
          {data.map((d, i) => {
            const bh = (d.distance / max) * H
            const x = i * (bw + gap)
            const on = hover === i
            const today = i === n - 1
            return (
              <g key={d.date} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
                <rect x={x} y={0} width={bw} height={H} fill="transparent" />
                <rect
                  x={x}
                  y={H - bh}
                  width={bw}
                  height={Math.max(bh, d.distance > 0 ? 2 : 0)}
                  rx={Math.min(4, bw / 3)}
                  className={cn('transition-[fill,opacity]', on ? 'fill-brand-300' : today ? 'fill-brand-500' : 'fill-navy-600 dark:fill-brand-600')}
                />
              </g>
            )
          })}
        </svg>
        <div className="pointer-events-none absolute bottom-0 left-8 right-0 flex text-[11px] text-slate-400" style={{ gap: `${(gap / W) * 100}%` }}>
          {data.map((d, i) => (
            <span key={d.date} className={cn('flex-1 text-center', i === n - 1 && 'font-semibold text-slate-600 dark:text-slate-200')}>
              {n <= 10 || i % Math.ceil(n / 8) === 0 || i === n - 1 ? format(new Date(`${d.date}T00:00:00`), n <= 10 ? 'EEE' : 'd/M') : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Semicircle gauge 0..1. */
export function Gauge01({ value, label, sub }: { value: number; label: string; sub?: string }) {
  const v = Math.min(1, Math.max(0, value))
  const r = 52
  const c = Math.PI * r
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 140 80" className="h-[84px] w-[150px]" role="img" aria-label={`${label}: ${Math.round(v * 100)}%`}>
        <path d="M18 72 A52 52 0 0 1 122 72" fill="none" strokeWidth="12" strokeLinecap="round" className="stroke-slate-100 dark:stroke-white/[0.07]" />
        <path d="M18 72 A52 52 0 0 1 122 72" fill="none" strokeWidth="12" strokeLinecap="round" stroke="#ffd700" strokeDasharray={`${c * v} ${c}`} className="transition-all duration-700" />
        <text x="70" y="66" textAnchor="middle" className="fill-slate-900 font-semibold dark:fill-white" style={{ fontSize: 24 }}>
          {Math.round(v * 100)}%
        </text>
      </svg>
      <div className="-mt-1 text-[12.5px] font-medium text-slate-700 dark:text-slate-200">{label}</div>
      {sub && <div className="text-[11.5px] text-slate-500 dark:text-slate-400">{sub}</div>}
    </div>
  )
}

export function AlertsByType({ data, onPick }: { data: DashboardData['alertsByType']; onPick?: (type: string) => void }) {
  const rows = Object.entries(data)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
  const max = Math.max(1, ...rows.map(([, n]) => n))
  const total = rows.reduce((s, [, n]) => s + n, 0)
  if (!rows.length) return <p className="py-6 text-center text-[12.5px] text-slate-500">No alerts in this period</p>
  return (
    <div>
      <div className="mb-2 text-[12px] text-slate-500 dark:text-slate-400">
        <span className="tabular font-semibold text-slate-900 dark:text-white">{total.toLocaleString()}</span> alerts
      </div>
      <ul className="space-y-1.5">
        {rows.slice(0, 7).map(([t, n]) => {
          const m = eventMeta(t)
          const Icon = m.icon
          return (
            <li key={t}>
              <button type="button" onClick={() => onPick?.(t)} className="group flex w-full items-center gap-2.5 rounded-lg py-0.5 text-left">
                <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg', m.chip)}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2 text-[12.5px]">
                    <span className="truncate text-slate-700 group-hover:text-slate-900 dark:text-slate-200 dark:group-hover:text-white">{m.label}</span>
                    <span className="tabular font-semibold text-slate-900 dark:text-white">{n}</span>
                  </span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]">
                    <span className="block h-full rounded-full transition-all duration-700" style={{ width: `${(n / max) * 100}%`, background: m.color }} />
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function TopVehicles({ data, onPick }: { data: DashboardData['topVehicles']; onPick?: (id: number) => void }) {
  const max = Math.max(1, ...data.map((d) => d.distance))
  if (!data.length) return <p className="py-6 text-center text-[12.5px] text-slate-500">No driving in this period</p>
  return (
    <ol className="space-y-1">
      {data.slice(0, 6).map((d, i) => (
        <li key={d.deviceId}>
          <button type="button" onClick={() => onPick?.(d.deviceId)} className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left hover:bg-slate-900/[0.035] dark:hover:bg-white/[0.04]">
            <span
              className={cn(
                'tabular grid h-6 w-6 shrink-0 place-items-center rounded-md text-[11px] font-bold',
                i === 0 ? 'bg-brand-500 text-navy-900' : 'bg-slate-100 text-slate-500 dark:bg-white/[0.07] dark:text-slate-300',
              )}
            >
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2 text-[12.5px]">
                <span className="truncate font-medium text-slate-800 dark:text-slate-100">{d.name}</span>
                <span className="tabular shrink-0 font-semibold text-slate-900 dark:text-white">
                  {Math.round(d.distance).toLocaleString()} <span className="text-[10.5px] font-medium text-slate-400">km</span>
                </span>
              </span>
              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]">
                <span className="block h-full rounded-full bg-navy-600 transition-all duration-700 dark:bg-brand-500/80" style={{ width: `${(d.distance / max) * 100}%` }} />
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}

/** Ranked driver scores with a small ring per driver. */
export function DriverScores({ data, onPick }: { data: DashboardData['driverScores']; onPick?: (driverId: number | null) => void }) {
  if (!data.length) return <p className="py-6 text-center text-[12.5px] text-slate-500">No driver data yet</p>
  const sorted = [...data].sort((a, b) => b.score - a.score)
  const avg = sorted.reduce((s, d) => s + d.score, 0) / sorted.length
  const t = scoreTone(avg)
  const r = 15
  const c = 2 * Math.PI * r
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-[12px] text-slate-500 dark:text-slate-400">
        Fleet average
        <span className={cn('tabular rounded-full px-2 py-0.5 text-[12px] font-semibold ring-1 ring-inset', t.bg, t.text)}>
          {Math.round(avg)} · {t.label}
        </span>
      </div>
      <ol className="space-y-0.5">
        {sorted.slice(0, 6).map((d, i) => {
          const tone = scoreTone(d.score)
          return (
            <li key={`${d.driverId ?? 'x'}-${d.name}-${i}`}>
              <button type="button" onClick={() => onPick?.(d.driverId)} className="flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left hover:bg-slate-900/[0.035] dark:hover:bg-white/[0.04]">
                <svg viewBox="0 0 40 40" className="h-9 w-9 shrink-0 -rotate-90">
                  <circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" className="stroke-slate-100 dark:stroke-white/[0.07]" />
                  <circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" strokeLinecap="round" stroke={tone.color} strokeDasharray={`${(c * d.score) / 100} ${c}`} />
                  <text x="20" y="24" textAnchor="middle" transform="rotate(90 20 20)" className="fill-slate-900 font-semibold dark:fill-white" style={{ fontSize: 11 }}>
                    {Math.round(d.score)}
                  </text>
                </svg>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-slate-800 dark:text-slate-100">{d.name}</span>
                  <span className="tabular block text-[11.5px] text-slate-500 dark:text-slate-400">{Math.round(d.distance).toLocaleString()} km driven</span>
                </span>
                <span className={cn('text-[11px] font-semibold', tone.text)}>{tone.label}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
