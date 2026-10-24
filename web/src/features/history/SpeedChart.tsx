import { useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import type { Position, Sensor } from '@/api/types'
import { sensorMeta } from '@/features/sensors/sensor'
import type { Track } from './track'

type SeriesId = string
interface SeriesDef {
  label: string
  unit: string
  color: string
  get: (p: Position) => number | null
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const BASE: Record<string, SeriesDef> = {
  speed: { label: 'Speed', unit: 'km/h', color: '#ffd700', get: (p) => p.speed },
  power: { label: 'Voltage', unit: 'V', color: '#94a3b8', get: (p) => num(p.attributes?.power) },
  fuel: { label: 'Fuel', unit: '%', color: '#10b981', get: (p) => num(p.attributes?.fuel) },
}
const EXTRA_COLORS = ['#f97316', '#0ea5e9', '#a855f7', '#14b8a6', '#ec4899', '#84cc16']
const MAX_PTS = 480
const W = 1000

/**
 * Speed (and voltage / fuel when reported) over the playback timeline. X is the same
 * virtual time as the scrubber, so the cursor and click-to-seek stay in sync with it.
 */
export function SpeedChart({ track, v, onSeek, className, sensors }: { track: Track; v: number; onSeek: (v: number) => void; className?: string; sensors?: Sensor[] }) {
  const SERIES = useMemo(() => {
    const out: Record<string, SeriesDef> = { ...BASE }
    // calibrated sensors (?sensors=1) replace the raw fuel attribute
    if (sensors?.length) delete out.fuel
    sensors?.forEach((s, i) => {
      const m = sensorMeta(s.type)
      const sameType = sensors.filter((x) => x.type === s.type).length > 1
      out[`sensor:${s.id}`] = { label: s.name, unit: s.unit, color: sameType ? EXTRA_COLORS[i % EXTRA_COLORS.length] : m.color, get: (p) => num(p.sensors?.[String(s.id)]) }
    })
    return out
  }, [sensors])
  const available = useMemo(() => {
    const ids: SeriesId[] = ['speed']
    for (const id of Object.keys(SERIES)) if (id !== 'speed' && track.positions.some((p) => SERIES[id].get(p) != null)) ids.push(id)
    return ids
  }, [track, SERIES])
  const [on, setOn] = useState<SeriesId[]>(() => ['speed'])
  const [touched, setTouched] = useState(false)
  // show the first sensor series by default when present
  const firstSensor = available.find((x) => x.startsWith('sensor:'))
  const shown = on.length === 1 && on[0] === 'speed' && firstSensor && !touched ? ['speed', firstSensor] : on
  const svg = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState(false)
  const H = 64
  const dur = track.duration || 1

  const paths = useMemo(() => {
    const n = track.positions.length
    const step = Math.max(1, Math.ceil(n / MAX_PTS))
    const out: Partial<Record<SeriesId, { line: string; area: string; max: number; min: number }>> = {}
    for (const id of available) {
      const val = (i: number): number | null => SERIES[id].get(track.positions[i])
      const pts: Array<[number, number]> = []
      for (let i = 0; i < n; i += step) {
        // keep peaks when downsampling
        let best: number | null = null
        for (let j = i; j < Math.min(n, i + step); j++) {
          const x = val(j)
          if (x != null && (best == null || (id === 'speed' ? x > best : true))) best = x
        }
        if (best != null) pts.push([track.vt[i], best])
      }
      if (!pts.length) continue
      let max = Math.max(...pts.map((p) => p[1]))
      let min = id === 'speed' ? 0 : Math.min(...pts.map((p) => p[1]))
      if (id === 'speed') max = Math.max(40, Math.ceil(max / 20) * 20)
      if (max === min) (max += 1), (min -= 1)
      const y = (x: number) => H - 4 - ((x - min) / (max - min)) * (H - 10)
      const line = pts.map(([t, x], k) => `${k ? 'L' : 'M'}${((t / dur) * W).toFixed(1)},${y(x).toFixed(1)}`).join('')
      const area = `${line}L${((pts[pts.length - 1][0] / dur) * W).toFixed(1)},${H}L${((pts[0][0] / dur) * W).toFixed(1)},${H}Z`
      out[id] = { line, area, max, min }
    }
    return out
  }, [track, available, dur, SERIES])

  const seekAt = (clientX: number) => {
    const r = svg.current?.getBoundingClientRect()
    if (!r) return
    onSeek(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * dur)
  }
  const cx = (v / dur) * W
  function valueAt(id: string): number | null {
    // nearest sample to the playback cursor
    let lo = 0
    let hi = track.vt.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (track.vt[mid] < v) lo = mid + 1
      else hi = mid
    }
    return track.positions[lo] ? SERIES[id].get(track.positions[lo]) : null
  }
  const speedMax = paths.speed?.max

  return (
    <div className={cn('relative', className)}>
      <div className="mb-1 flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {available.map((id) => {
          const s = SERIES[id]
          const active = shown.includes(id)
          const cur = id !== 'speed' && active ? valueAt(id) : null
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              disabled={id === 'speed'}
              title={`${s.label} (${s.unit})`}
              onClick={() => {
                setTouched(true)
                setOn(active ? shown.filter((x) => x !== id) : [...shown, id])
              }}
              className={cn(
                'inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 text-[10.5px] font-semibold transition-colors disabled:cursor-default',
                active ? 'bg-slate-900/[0.06] text-slate-700 dark:bg-white/10 dark:text-slate-200' : 'text-slate-400 hover:text-slate-600',
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
              <span className="max-w-[110px] truncate">{s.label}</span>
              {cur != null && <span className="tabular font-medium opacity-70">{Math.round(cur * 10) / 10}{s.unit ? ` ${s.unit}` : ''}</span>}
            </button>
          )
        })}
        {speedMax != null && <span className="tabular ml-auto text-[10px] text-slate-400">max {speedMax} km/h</span>}
      </div>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-12 w-full cursor-pointer touch-none select-none sm:h-14"
        role="slider"
        aria-label="Speed over time — click to seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(dur)}
        aria-valuenow={Math.round(v)}
        onPointerDown={(e) => {
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          setDragging(true)
          seekAt(e.clientX)
        }}
        onPointerMove={(e) => dragging && seekAt(e.clientX)}
        onPointerUp={() => setDragging(false)}
      >
        <defs>
          <linearGradient id="spd-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#ffd700" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#ffd700" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((k) => (
          <line key={k} x1="0" x2={W} y1={H * k} y2={H * k} className="stroke-slate-900/[0.06] dark:stroke-white/[0.06]" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        {paths.speed && (
          <>
            <path d={paths.speed.area} fill="url(#spd-fill)" />
            <path d={paths.speed.line} fill="none" stroke="#e6c200" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </>
        )}
        {available
          .filter((id) => id !== 'speed')
          .map((id) =>
            shown.includes(id) && paths[id] ? (
              <path key={id} d={paths[id]!.line} fill="none" stroke={SERIES[id].color} strokeWidth={id.startsWith('sensor:') ? 1.8 : 1.4} vectorEffect="non-scaling-stroke" strokeDasharray={id.startsWith('sensor:') ? undefined : '4 3'} />
            ) : null,
          )}
        <line x1={cx} x2={cx} y1="0" y2={H} className="stroke-navy-700 dark:stroke-white" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  )
}
