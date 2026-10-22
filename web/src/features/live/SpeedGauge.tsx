import { useId } from 'react'

/** Semi-circular speedometer drawn in SVG. */
export function SpeedGauge({ speed, max = 160 }: { speed: number; max?: number }) {
  const id = useId()
  const r = 54
  const cx = 70
  const cy = 66
  const start = Math.PI * 0.85
  const end = Math.PI * 2.15
  const k = Math.max(0, Math.min(1, speed / max))
  const a = start + (end - start) * k
  const pt = (ang: number, rad = r) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)] as const
  const arc = (from: number, to: number) => {
    const [x0, y0] = pt(from)
    const [x1, y1] = pt(to)
    const large = to - from > Math.PI ? 1 : 0
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`
  }
  const [nx, ny] = pt(a, r - 16)
  const ticks = Array.from({ length: 9 }, (_, i) => start + ((end - start) * i) / 8)
  return (
    <svg viewBox="0 0 140 112" className="h-[112px] w-[140px]" role="img" aria-label={`Speed ${Math.round(speed)} km/h`}>
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="16" y1="0" x2="124" y2="0">
          <stop offset="0" stopColor="#10b981" />
          <stop offset="0.6" stopColor="#f59e0b" />
          <stop offset="1" stopColor="#f43f5e" />
        </linearGradient>
      </defs>
      <path d={arc(start, end)} fill="none" strokeWidth="9" strokeLinecap="round" className="stroke-slate-200 dark:stroke-white/[0.07]" />
      {k > 0.001 && <path d={arc(start, a)} fill="none" stroke={`url(#${id})`} strokeWidth="9" strokeLinecap="round" />}
      {ticks.map((t, i) => {
        const [x0, y0] = pt(t, r - 9)
        const [x1, y1] = pt(t, r - 13)
        return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} strokeWidth="1.2" className="stroke-slate-300 dark:stroke-white/15" />
      })}
      <line x1={cx} y1={cy} x2={nx} y2={ny} strokeWidth="2.5" strokeLinecap="round" className="stroke-slate-700 transition-all duration-700 dark:stroke-slate-200" />
      <circle cx={cx} cy={cy} r="4" className="fill-slate-700 dark:fill-slate-200" />
      <text x={cx} y={cy + 30} textAnchor="middle" className="fill-slate-900 text-[22px] font-semibold dark:fill-white" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {Math.round(speed)}
      </text>
      <text x={cx} y={cy + 43} textAnchor="middle" className="fill-slate-400 text-[9px] font-medium uppercase tracking-wider">
        km/h
      </text>
    </svg>
  )
}

/** 0–5 bar signal indicator. */
export function SignalBars({ level }: { level: number | null }) {
  const l = level == null ? -1 : Math.max(0, Math.min(5, Math.round(level)))
  return (
    <span className="inline-flex items-end gap-[2px]" aria-label={l < 0 ? 'Unknown signal' : `Signal ${l} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={i <= l ? 'w-[3px] rounded-sm bg-emerald-500' : 'w-[3px] rounded-sm bg-slate-300 dark:bg-white/15'}
          style={{ height: 3 + i * 2.2 }}
        />
      ))}
    </span>
  )
}
