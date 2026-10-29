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

/** Smooth curve through points (Catmull-Rom as cubic Béziers). */
function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    // control points stay between the two ends so the curve never overshoots (no dips below 0)
    const lo = Math.min(p1[1], p2[1])
    const hi = Math.max(p1[1], p2[1])
    const clamp = (y: number) => Math.min(hi, Math.max(lo, y))
    const c1: [number, number] = [p1[0] + (p2[0] - p0[0]) / 6, clamp(p1[1] + (p2[1] - p0[1]) / 6)]
    const c2: [number, number] = [p2[0] - (p3[0] - p1[0]) / 6, clamp(p2[1] - (p3[1] - p1[1]) / 6)]
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`
  }
  return d
}

/** Distance per day: smooth area chart (navy line, gold fill) with a hover read-out. */
export function DistanceBars({ data }: { data: DashboardData['distanceByDay'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = niceMax(Math.max(...data.map((d) => d.distance), 0))
  const n = data.length
  const W = 600
  const H = 180
  const total = data.reduce((s, d) => s + d.distance, 0)
  const avg = n ? total / n : 0
  const h = hover != null ? data[hover] : null
  const xOf = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W)
  const yOf = (v: number) => H - (v / max) * (H - 6)
  const pts = data.map((d, i) => [xOf(i), yOf(d.distance)] as [number, number])
  const line = smoothPath(pts)
  const area = pts.length ? `${line} L${xOf(n - 1)},${H} L${xOf(0)},${H} Z` : ''
  return (
    <div>
      <div className="mb-3 flex items-end gap-6">
        <div>
          <div className="tabular text-[26px] font-semibold leading-none tracking-tight text-navy-800 dark:text-white">
            {Math.round(total).toLocaleString()} <span className="text-[13px] font-medium text-slate-400">km</span>
          </div>
          <div className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">total · {Math.round(avg).toLocaleString()} km/day average</div>
        </div>
        <div className="tabular ml-auto min-h-[34px] text-right text-[12px]" aria-live="polite">
          {h && (
            <>
              <div className="font-semibold text-navy-800 dark:text-white">{Math.round(h.distance).toLocaleString()} km</div>
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
        <div className="ml-8">
          <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-[180px] w-full overflow-visible" preserveAspectRatio="none" role="img" aria-label="Distance by day" onMouseLeave={() => setHover(null)}>
            <defs>
              <linearGradient id="dist-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffd700" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#ffd700" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {[0, 0.5, 1].map((k) => (
              <line key={k} x1="0" x2={W} y1={H * k} y2={H * k} className="stroke-slate-200 dark:stroke-white/[0.07]" strokeDasharray={k === 1 ? undefined : '3 4'} vectorEffect="non-scaling-stroke" />
            ))}
            {hover != null && <line x1={xOf(hover)} x2={xOf(hover)} y1={0} y2={H} className="stroke-navy-200 dark:stroke-white/20" vectorEffect="non-scaling-stroke" />}
            <path d={area} fill="url(#dist-fill)" />
            <path d={line} fill="none" strokeWidth="2.5" strokeLinejoin="round" className="stroke-navy-700 dark:stroke-brand-400" vectorEffect="non-scaling-stroke" />
            {data.map((d, i) => {
              const x0 = n <= 1 ? 0 : xOf(i) - W / (n - 1) / 2
              return <rect key={d.date} x={x0} y={0} width={n <= 1 ? W : W / (n - 1)} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
            })}
          </svg>
          {/* point markers in HTML so they stay round whatever the aspect ratio */}
          {data.map((d, i) => (
            <span
              key={d.date}
              className={cn(
                'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow dark:border-ink-900',
                hover === i ? 'h-3.5 w-3.5 bg-brand-500' : i === n - 1 ? 'h-2.5 w-2.5 bg-brand-500' : 'h-2 w-2 bg-navy-700 dark:bg-brand-400',
                n > 14 && hover !== i && i !== n - 1 && 'hidden',
              )}
              style={{ left: `${(xOf(i) / W) * 100}%`, top: `${(yOf(d.distance) / H) * 100}%` }}
            />
          ))}
          </div>
          <div className="pointer-events-none mt-2 flex justify-between text-[11px] text-slate-400">
            {data.map((d, i) => (
              <span key={d.date} className={cn('w-0 whitespace-nowrap text-center [&>*]:-translate-x-1/2 [&>*]:inline-block', i === n - 1 && 'font-semibold text-slate-600 dark:text-slate-200')}>
                <span>{n <= 10 || i % Math.ceil(n / 8) === 0 || i === n - 1 ? format(new Date(`${d.date}T00:00:00`), n <= 10 ? 'EEE' : 'd/M') : ''}</span>
              </span>
            ))}
          </div>
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
