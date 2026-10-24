import { useQuery } from '@tanstack/react-query'
import { Settings2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api, qk } from '@/api/client'
import type { Device, DeviceSensorValue, Sensor } from '@/api/types'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'
import { fmtSensor, sensorMeta } from './sensor'

function FuelTile({ s, cfg }: { s: DeviceSensorValue; cfg?: Sensor }) {
  const cap = cfg?.tankCapacity ?? null
  const pct = cap && s.value != null ? Math.max(0, Math.min(100, (s.value / cap) * 100)) : null
  const low = pct != null && pct < 15
  const m = sensorMeta('fuel')
  return (
    <div className="col-span-2 rounded-xl border border-slate-200/80 bg-white/60 px-3 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.025]">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
        <m.icon className="h-3.5 w-3.5" style={{ color: m.color }} />
        {s.name}
        {pct != null && <span className={cn('tabular ml-auto font-semibold', low ? 'text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-200')}>{Math.round(pct)} %</span>}
      </div>
      <div className="mt-1 flex items-end gap-3">
        <span className="tabular text-[18px] font-semibold leading-none text-slate-900 dark:text-white">{fmtSensor(s.value, s.unit, cfg?.decimals ?? 1)}</span>
        {cap != null && <span className="tabular pb-px text-[11.5px] text-slate-500 dark:text-slate-400">of {cap} {s.unit}</span>}
      </div>
      {pct != null && (
        <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200/80 dark:bg-white/[0.08]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={`${s.name} level`}>
          <div className={cn('h-full rounded-full transition-[width]', low ? 'bg-rose-500' : 'bg-gradient-to-r from-amber-400 to-brand-500')} style={{ width: `${pct}%` }} />
          {[25, 50, 75].map((k) => (
            <span key={k} className="absolute inset-y-0 w-px bg-white/70 dark:bg-ink-900/70" style={{ left: `${k}%` }} />
          ))}
        </div>
      )}
    </div>
  )
}

function BandTile({ s, cfg }: { s: DeviceSensorValue; cfg?: Sensor }) {
  const m = sensorMeta(s.type)
  const min = cfg?.min ?? null
  const max = cfg?.max ?? null
  const v = s.value
  const out = v != null && ((min != null && v < min) || (max != null && v > max))
  const hasBand = min != null || max != null
  const lo = (min ?? (max != null ? max - 10 : 0)) - Math.max(2, Math.abs((max ?? 10) - (min ?? 0)) * 0.5)
  const hi = (max ?? (min != null ? min + 10 : 10)) + Math.max(2, Math.abs((max ?? 10) - (min ?? 0)) * 0.5)
  const pos = (x: number) => `${Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100))}%`
  return (
    <div className={cn('rounded-xl border px-3 py-2.5', out ? 'border-rose-500/40 bg-rose-500/[0.06]' : 'border-slate-200/80 bg-white/60 dark:border-white/[0.06] dark:bg-white/[0.025]')}>
      <div className="flex items-center gap-1.5 truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
        <m.icon className="h-3.5 w-3.5 shrink-0" style={{ color: out ? '#f43f5e' : m.color }} />
        <span className="truncate">{s.name}</span>
      </div>
      <div className={cn('tabular mt-1 text-[15px] font-semibold', out ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white')}>{fmtSensor(v, s.unit, cfg?.decimals ?? 1)}</div>
      {hasBand && v != null && (
        <>
          <div className="relative mt-1.5 h-1.5 rounded-full bg-slate-200/80 dark:bg-white/[0.08]">
            <span className="absolute inset-y-0 rounded-full bg-emerald-500/50" style={{ left: min != null ? pos(min) : '0%', right: max != null ? `calc(100% - ${pos(max)})` : '0%' }} />
            <span className={cn('absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow dark:border-ink-900', out ? 'bg-rose-500' : 'bg-navy-700 dark:bg-brand-500')} style={{ left: pos(v) }} />
          </div>
          <div className="tabular mt-1 flex justify-between text-[10px] text-slate-400">
            <span>{min != null ? `min ${min}` : ''}</span>
            <span>{max != null ? `max ${max}` : ''}</span>
          </div>
        </>
      )}
    </div>
  )
}

/** Live sensor values (Device.sensors) on the vehicle panel. */
export function SensorTiles({ device, canConfigure }: { device: Device; canConfigure: boolean }) {
  const nav = useNavigate()
  const values = device.sensors ?? []
  const cfg = useQuery({ queryKey: qk.sensors(device.id), queryFn: () => api.sensors(device.id), enabled: values.length > 0, staleTime: 5 * 60_000, meta: { silent: true } })
  if (!values.length) return null
  const byId = (id: number) => cfg.data?.find((x) => x.id === id)
  const fuel = values.filter((v) => v.type === 'fuel')
  const rest = values.filter((v) => v.type !== 'fuel')
  const newest = values.map((v) => v.time).filter(Boolean).sort().pop()
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="label-xs">Sensors</h3>
        <span className="flex items-center gap-1 text-[11px] text-slate-400">
          {newest && timeAgo(newest)}
          {canConfigure && (
            <button type="button" onClick={() => nav(`/devices?sensors=${device.id}`)} aria-label="Configure sensors" title="Configure sensors" className="grid h-6 w-6 place-items-center rounded-md hover:bg-slate-900/5 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white">
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {fuel.map((s) => (
          <FuelTile key={s.id} s={s} cfg={byId(s.id)} />
        ))}
        {rest.map((s) => (
          <BandTile key={s.id} s={s} cfg={byId(s.id)} />
        ))}
      </div>
    </div>
  )
}
