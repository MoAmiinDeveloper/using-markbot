import { useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import type { GeoJSONSource } from 'maplibre-gl'
import { useMapCtx } from '@/components/map/MapCanvas'
import { vehicleIconName } from '@/components/map/icons'
import { fmtDateTime, fmtTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import { sampleAt, type Track } from './track'

const SRC = 'playback'
const RATES = [1, 2, 4, 8, 16, 32]
/** virtual track-seconds advanced per real second at 1x */
const BASE = 10

export function Playback({ track, seek }: { track: Track; seek: { v: number; n: number } | null }) {
  const { map, styleVersion } = useMapCtx()
  const [v, setV] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(4)
  const vRef = useRef(0)
  vRef.current = v
  const sample = sampleAt(track, v)

  // reset on new track
  useEffect(() => {
    setV(0)
    setPlaying(false)
  }, [track])

  useEffect(() => {
    if (seek) {
      setV(Math.min(seek.v, track.duration))
    }
  }, [seek, track])

  // marker layer
  useEffect(() => {
    if (!map || styleVersion === 0) return
    try {
      if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      if (!map.getLayer(SRC))
        map.addLayer({
          id: SRC,
          type: 'symbol',
          source: SRC,
          layout: {
            'icon-image': ['get', 'icon'],
            'icon-rotate': ['get', 'rot'],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
        })
    } catch {
      /* style not ready */
    }
    return () => {
      if (map.getLayer(SRC)) map.removeLayer(SRC)
      if (map.getSource(SRC)) map.removeSource(SRC)
    }
  }, [map, styleVersion])

  useEffect(() => {
    if (!map || !sample) return
    const src = map.getSource(SRC) as GeoJSONSource | undefined
    const moving = sample.speed > 3
    src?.setData({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [sample.lng, sample.lat] },
      properties: { icon: vehicleIconName(moving ? 'moving' : 'stopped', true), rot: moving ? sample.course : 0 },
    })
    if (playing) {
      // keep the marker in view
      const pt = map.project([sample.lng, sample.lat])
      const c = map.getContainer()
      const m = 80
      if (pt.x < m || pt.y < m || pt.x > c.clientWidth - m || pt.y > c.clientHeight - m) {
        map.easeTo({ center: [sample.lng, sample.lat], duration: 500 })
      }
    }
  }, [map, sample?.lng, sample?.lat, sample?.course, playing, styleVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  // animation loop
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const next = vRef.current + dt * BASE * rate
      if (next >= track.duration) {
        setV(track.duration)
        setPlaying(false)
        return
      }
      setV(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, rate, track])

  // keyboard: space toggles
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(t.tagName)) return
      if (e.code === 'Space') {
        e.preventDefault()
        setPlaying((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const atEnd = v >= track.duration && track.duration > 0
  const pct = track.duration ? (v / track.duration) * 100 : 0

  return (
    <div className="glass pointer-events-auto flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 sm:gap-4 sm:px-4">
      <button
        type="button"
        onClick={() => {
          if (atEnd) setV(0)
          setPlaying((p) => !p || atEnd)
        }}
        aria-label={playing ? 'Pause' : atEnd ? 'Replay' : 'Play'}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-500 text-navy-900 shadow-md shadow-brand-900/30 transition-colors hover:bg-brand-400"
      >
        {playing ? <Pause className="h-4 w-4" fill="currentColor" /> : atEnd ? <RotateCcw className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" fill="currentColor" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[12px]">
          <span className="tabular truncate font-medium text-slate-900 dark:text-white">
            {sample ? fmtDateTime(sample.time) : '—'}
          </span>
          <span className="tabular shrink-0 font-semibold text-slate-900 dark:text-white">
            {sample ? Math.round(sample.speed) : 0}
            <span className="ml-0.5 text-[10.5px] font-medium text-slate-400"> km/h</span>
          </span>
        </div>
        <div className="relative">
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-slate-200 dark:bg-white/10" />
          <div
            className="pointer-events-none absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-brand-500 to-emerald-400"
            style={{ width: `${pct}%` }}
          />
          <input
            type="range"
            className="scrubber relative block"
            min={0}
            max={track.duration || 1}
            step="any"
            value={v}
            aria-label="Playback position"
            aria-valuetext={sample ? fmtDateTime(sample.time) : undefined}
            onChange={(e) => setV(Number(e.target.value))}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10.5px] text-slate-400">
          <span className="tabular">{fmtTime(track.t[0])}</span>
          <span className="tabular">{fmtTime(track.t[track.t.length - 1])}</span>
        </div>
      </div>
      <div role="group" aria-label="Playback speed" className="hidden shrink-0 rounded-lg bg-slate-100 p-0.5 dark:bg-white/[0.06] sm:flex">
        {RATES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={rate === r}
            onClick={() => setRate(r)}
            title={`${r}x (${r * BASE}s of track per second)`}
            className={cn(
              'tabular h-7 rounded-md px-2 text-[11.5px] font-semibold transition-colors',
              rate === r ? 'bg-white text-slate-900 shadow-sm dark:bg-white/15 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white',
            )}
          >
            {r}x
          </button>
        ))}
      </div>
      <select
        aria-label="Playback speed"
        value={rate}
        onChange={(e) => setRate(Number(e.target.value))}
        className="h-8 shrink-0 rounded-lg border border-slate-200 bg-white px-1.5 text-[12px] font-semibold dark:border-white/10 dark:bg-white/[0.05] dark:[color-scheme:dark] sm:hidden"
      >
        {RATES.map((r) => (
          <option key={r} value={r}>
            {r}x
          </option>
        ))}
      </select>
    </div>
  )
}
