import { useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import type { Track } from './track'

type SeriesId = 'speed' | 'power' | 'fuel'
const SERIES: Record<SeriesId, { label: string; unit: string; color: string; attr?: string }> = {
  speed: { label: 'Speed', unit: 'km/h', color: '#ffd700' },
  power: { label: 'Voltage', unit: 'V', color: '#38bdf8', attr: 'power' },
  fuel: { label: 'Fuel', unit: '%', color: '#10b981', attr: 'fuel' },
}
const MAX_PTS = 480
const W = 1000

/**
 * Speed (and voltage / fuel when reported) over the playback timeline. X is the same
 * virtual time as the scrubber, so the cursor and click-to-seek stay in sync with it.
 */
export function SpeedChart({ track, v, onSeek, className }: { track: Track; v: number; onSeek: (v: number) => void; className?: string }) {
  const available = useMemo(() => {
    const ids: SeriesId[] = ['speed']
    for (const id of ['power', 'fuel'] as const) if (track.positions.some((p) => typeof p.attributes?.[SERIES[id].attr!] === 'number')) ids.push(id)
    return ids
  }, [track])
  const [on, setOn] = useState<SeriesId[]>(['speed'])
  const svg = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState(false)
  const H = 64
  const dur = track.duration || 1

  const paths = useMemo(() => {
    const n = track.positions.length
    const step = Math.max(1, Math.ceil(n / MAX_PTS))
    const out: Partial<Record<SeriesId, { line: string; area: string; max: number; min: number }>> = {}
    for (const id of available) {
      const val = (i: number): number | null => {
        const p = track.positions[i]
        if (id === 'speed') return p.speed
        const a = p.attributes?.[SERIES[id].attr!]
        return typeof a === 'number' ? a : null
      }
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
  }, [track, available, dur])

  const seekAt = (clientX: number) => {
    const r = svg.current?.getBoundingClientRect()
    if (!r) return
    onSeek(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * dur)
  }
  const cx = (v / dur) * W
  const speedMax = paths.speed?.max

  return (
    <div className={cn('relative', className)}>
      <div className="mb-1 flex items-center gap-1.5">
        {available.map((id) => {
          const s = SERIES[id]
          const active = on.includes(id)
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              disabled={id === 'speed'}
              onClick={() => setOn((o) => (active ? o.filter((x) => x !== id) : [...o, id]))}
              className={cn(
                'inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[10.5px] font-semibold transition-colors disabled:cursor-default',
                active ? 'bg-slate-900/[0.06] text-slate-700 dark:bg-white/10 dark:text-slate-200' : 'text-slate-400 hover:text-slate-600',
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
              {s.label}
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
        {(['power', 'fuel'] as const).map((id) =>
          on.includes(id) && paths[id] ? (
            <path key={id} d={paths[id]!.line} fill="none" stroke={SERIES[id].color} strokeWidth="1.4" vectorEffect="non-scaling-stroke" strokeDasharray="4 3" />
          ) : null,
        )}
        <line x1={cx} x2={cx} y1="0" y2={H} className="stroke-navy-700 dark:stroke-white" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  )
}
