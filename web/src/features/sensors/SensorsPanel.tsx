import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Crosshair, Gauge, Pencil, Plus, Table2, Trash2, Calculator } from 'lucide-react'
import { api, ApiError, qk } from '@/api/client'
import { SENSOR_TYPES, type Device, type Sensor, type SensorInput, type SensorType } from '@/api/types'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState, Skeleton } from '@/components/ui/Misc'
import { Segmented } from '@/components/ui/Tabs'
import { useLive } from '@/store/live'
import { toast } from '@/store/toast'
import { cn } from '@/lib/cn'
import { TELTONIKA_HINTS, computeValue, fmtSensor, hintFor, sensorMeta, SENSOR_META } from './sensor'

type Draft = Omit<SensorInput, 'min' | 'max' | 'tankCapacity' | 'fuelDropThreshold' | 'fuelFillThreshold' | 'multiplier' | 'offset' | 'decimals' | 'smoothing'> & {
  min: string
  max: string
  tankCapacity: string
  fuelDropThreshold: string
  fuelFillThreshold: string
  multiplier: string
  offset: string
  decimals: number
  smoothing: number
  mode: 'table' | 'linear'
  rows: Array<[string, string]>
}

const str = (n: number | null | undefined) => (n == null ? '' : String(n))
const num = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s))

function toDraft(s: Sensor | null, deviceId: number): Draft {
  if (!s)
    return {
      deviceId,
      name: '',
      type: 'fuel',
      source: '',
      calibration: [],
      multiplier: '1',
      offset: '0',
      unit: 'L',
      decimals: 1,
      min: '',
      max: '',
      tankCapacity: '',
      fuelDropThreshold: '8',
      fuelFillThreshold: '10',
      smoothing: 5,
      mode: 'table',
      rows: [
        ['0', '0'],
        ['', ''],
      ],
    }
  return {
    deviceId: s.deviceId,
    name: s.name,
    type: s.type,
    source: s.source,
    calibration: s.calibration,
    multiplier: str(s.multiplier ?? 1),
    offset: str(s.offset ?? 0),
    unit: s.unit,
    decimals: s.decimals ?? 1,
    min: str(s.min),
    max: str(s.max),
    tankCapacity: str(s.tankCapacity),
    fuelDropThreshold: str(s.fuelDropThreshold),
    fuelFillThreshold: str(s.fuelFillThreshold),
    smoothing: s.smoothing ?? 1,
    mode: s.calibration?.length >= 2 ? 'table' : 'linear',
    rows: s.calibration?.length ? s.calibration.map(([a, b]) => [String(a), String(b)]) : [['0', '0'], ['', '']],
  }
}

function tableOf(d: Draft): Array<[number, number]> {
  return d.rows
    .map(([a, b]) => [num(a), num(b)] as const)
    .filter((p): p is readonly [number, number] => p[0] != null && p[1] != null)
    .map(([a, b]) => [a, b] as [number, number])
    .sort((x, y) => x[0] - y[0])
}

function toInput(d: Draft): SensorInput {
  const fuel = d.type === 'fuel'
  return {
    deviceId: d.deviceId,
    name: d.name.trim(),
    type: d.type,
    source: d.source.trim(),
    calibration: d.mode === 'table' ? tableOf(d) : [],
    multiplier: num(d.multiplier) ?? 1,
    offset: num(d.offset) ?? 0,
    unit: d.unit.trim(),
    decimals: d.decimals,
    min: fuel ? null : num(d.min),
    max: fuel ? null : num(d.max),
    tankCapacity: fuel ? num(d.tankCapacity) : null,
    fuelDropThreshold: fuel ? num(d.fuelDropThreshold) : null,
    fuelFillThreshold: fuel ? num(d.fuelFillThreshold) : null,
    smoothing: d.smoothing,
  }
}

/** Calibration curve with the live raw reading marked. */
function CalibrationChart({ pts, raw, value, unit, color }: { pts: Array<[number, number]>; raw: number | null; value: number | null; unit: string; color: string }) {
  const W = 320
  const H = 140
  const P = { l: 34, r: 10, t: 10, b: 22 }
  if (pts.length < 2) return <div className="grid h-[140px] place-items-center rounded-lg bg-slate-50 text-[12px] text-slate-400 dark:bg-white/[0.03]">Add at least two points to see the curve</div>
  const xs = pts.map((p) => p[0]).concat(raw != null ? [raw] : [])
  const ys = pts.map((p) => p[1])
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs) || 1
  const y0 = Math.min(0, ...ys)
  const y1 = Math.max(...ys) || 1
  const X = (v: number) => P.l + ((v - x0) / (x1 - x0 || 1)) * (W - P.l - P.r)
  const Y = (v: number) => H - P.b - ((v - y0) / (y1 - y0 || 1)) * (H - P.t - P.b)
  const line = pts.map(([a, b], i) => `${i ? 'L' : 'M'}${X(a).toFixed(1)},${Y(b).toFixed(1)}`).join('')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[140px] w-full" role="img" aria-label="Calibration curve">
      {[0, 0.5, 1].map((k) => (
        <g key={k}>
          <line x1={P.l} x2={W - P.r} y1={Y(y0 + (y1 - y0) * k)} y2={Y(y0 + (y1 - y0) * k)} className="stroke-slate-200 dark:stroke-white/10" strokeWidth="1" />
          <text x={P.l - 4} y={Y(y0 + (y1 - y0) * k) + 3} textAnchor="end" className="fill-slate-400 text-[9px]">
            {Math.round(y0 + (y1 - y0) * k)}
          </text>
        </g>
      ))}
      <text x={P.l} y={H - 6} className="fill-slate-400 text-[9px]">
        {Math.round(x0)}
      </text>
      <text x={W - P.r} y={H - 6} textAnchor="end" className="fill-slate-400 text-[9px]">
        raw {Math.round(x1)}
      </text>
      <path d={`${line}L${X(pts[pts.length - 1][0])},${Y(y0)}L${X(pts[0][0])},${Y(y0)}Z`} fill={color} opacity="0.12" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      {pts.map(([a, b], i) => (
        <circle key={i} cx={X(a)} cy={Y(b)} r="3" fill="white" stroke={color} strokeWidth="2" />
      ))}
      {raw != null && value != null && (
        <g>
          <line x1={X(raw)} x2={X(raw)} y1={P.t} y2={H - P.b} stroke="#ffd700" strokeWidth="1.5" strokeDasharray="3 2" />
          <line x1={P.l} x2={X(raw)} y1={Y(value)} y2={Y(value)} stroke="#ffd700" strokeWidth="1.5" strokeDasharray="3 2" />
          <circle cx={X(raw)} cy={Y(value)} r="5" fill="#ffd700" stroke="#222d5d" strokeWidth="2" />
          <text x={Math.min(X(raw) + 7, W - 60)} y={Math.max(Y(value) - 7, 12)} className="fill-slate-700 text-[10px] font-semibold dark:fill-white">
            {fmtSensor(value, unit, 1)}
          </text>
        </g>
      )}
    </svg>
  )
}

function SensorEditor({ device, initial, onDone }: { device: Device; initial: Sensor | null; onDone: () => void }) {
  const qc = useQueryClient()
  const live = useLive((s) => s.byId[device.id]) ?? device
  const attrs = live.position?.attributes ?? {}
  const [d, setD] = useState<Draft>(() => toDraft(initial, device.id))
  const [touched, setTouched] = useState(false)
  const [srcOpen, setSrcOpen] = useState(false)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((s) => ({ ...s, [k]: v }))
  const meta = sensorMeta(d.type)
  const rawVal = attrs[d.source.trim()]
  const raw = typeof rawVal === 'number' ? rawVal : typeof rawVal === 'string' && Number.isFinite(Number(rawVal)) ? Number(rawVal) : null
  const input = toInput(d)
  const value = computeValue(input, raw)
  const pts = tableOf(d)

  const numericAttrs = Object.entries(attrs)
    .filter(([, v]) => typeof v === 'number')
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
  const suggestions = useMemo(() => {
    const present = numericAttrs.map(([k, v]) => ({ key: k, label: hintFor(k)?.label ?? 'In latest position', value: v as number, present: true, hint: hintFor(k) }))
    const hints = TELTONIKA_HINTS.filter((h) => !(h.key in attrs)).map((h) => ({ key: h.key, label: h.label, value: null as number | null, present: false, hint: h }))
    const q = d.source.trim().toLowerCase()
    return [...present, ...hints].filter((x) => !q || x.key.toLowerCase().includes(q) || x.label.toLowerCase().includes(q))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attrs, d.source])

  const errors = {
    name: !d.name.trim() ? 'Name the sensor' : undefined,
    source: !d.source.trim() ? 'Pick the attribute that carries the raw value' : undefined,
    calibration: d.mode === 'table' && pts.length < 2 ? 'At least two complete rows' : d.mode === 'table' && new Set(pts.map((p) => p[0])).size !== pts.length ? 'Raw values must be different' : undefined,
    multiplier: d.mode === 'linear' && num(d.multiplier) == null ? 'Number' : undefined,
    range: num(d.min) != null && num(d.max) != null && num(d.min)! >= num(d.max)! ? 'Min must be below max' : undefined,
  }
  const save = useMutation({
    meta: { silent: true },
    mutationFn: () => (initial ? api.updateSensor(initial.id, input) : api.createSensor(input)),
    onSuccess: (s) => {
      qc.setQueryData<Sensor[]>(qk.sensors(device.id), (l) => (l ? [...l.filter((x) => x.id !== s.id), s] : [s]))
      void qc.invalidateQueries({ queryKey: qk.sensors(device.id) })
      toast.success(initial ? 'Sensor saved' : 'Sensor added', s.name)
      onDone()
    },
    onError: (e) => toast.error('Could not save the sensor', e instanceof ApiError ? e.message : String(e)),
  })
  const submit = () => {
    setTouched(true)
    if (Object.values(errors).some(Boolean)) return
    save.mutate()
  }
  const pickSource = (key: string) => {
    const h = hintFor(key)
    setD((s) => ({
      ...s,
      source: key,
      ...(h && !initial
        ? {
            type: h.type,
            unit: h.unit ?? SENSOR_META[h.type].unit,
            decimals: SENSOR_META[h.type].decimals,
            ...(h.multiplier ? { mode: 'linear' as const, multiplier: String(h.multiplier) } : {}),
            name: s.name || h.label.replace(/\s*\(.*\)$/, ''),
          }
        : {}),
    }))
    setSrcOpen(false)
  }
  const err = (k: keyof typeof errors) => (touched ? errors[k] : undefined)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <IconButton size="sm" label="Back to sensors" onClick={onDone} className="-ml-1.5">
          <ArrowLeft className="h-4 w-4" />
        </IconButton>
        <h3 className="flex-1 text-[14px] font-semibold text-slate-900 dark:text-white">{initial ? `Edit ${initial.name}` : 'New sensor'}</h3>
      </div>

      {/* live preview */}
      <div className="flex items-center gap-3 rounded-xl border border-brand-500/30 bg-brand-500/[0.07] px-3 py-2.5 dark:bg-brand-400/[0.06]">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: `${meta.color}22`, color: meta.color }}>
          <meta.icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="label-xs !text-[10px]">Live preview</p>
          <p className="tabular truncate text-[13px] text-slate-700 dark:text-slate-200">
            {raw == null ? (
              <span className="text-slate-500">{d.source ? `No “${d.source}” in the latest position` : 'Pick a source to preview'}</span>
            ) : (
              <>
                raw <b className="font-mono font-semibold text-slate-900 dark:text-white">{raw}</b> →{' '}
                <b className="text-[15px] font-semibold text-slate-900 dark:text-white">{fmtSensor(value, d.unit, d.decimals)}</b>
                {d.type === 'fuel' && num(d.tankCapacity) && value != null && <span className="text-slate-500"> · {Math.round((value / num(d.tankCapacity)!) * 100)} % of tank</span>}
              </>
            )}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required error={err('name')}>
          {(id, dsc) => <Input id={id} aria-describedby={dsc} value={d.name} invalid={!!err('name')} placeholder="Fuel tank" onChange={(e) => set('name', e.target.value)} />}
        </Field>
        <div className="relative">
          <Field label="Source attribute" required error={err('source')}>
            {(id, dsc) => (
              <Input
                id={id}
                aria-describedby={dsc}
                className="font-mono"
                value={d.source}
                invalid={!!err('source')}
                autoComplete="off"
                spellCheck={false}
                placeholder="io201"
                role="combobox"
                aria-expanded={srcOpen}
                onFocus={() => setSrcOpen(true)}
                onBlur={() => window.setTimeout(() => setSrcOpen(false), 150)}
                onChange={(e) => {
                  set('source', e.target.value.trim())
                  setSrcOpen(true)
                }}
              />
            )}
          </Field>
          {srcOpen && suggestions.length > 0 && (
            <ul role="listbox" className="glass absolute left-0 right-0 top-[62px] z-30 max-h-64 animate-fade-in overflow-y-auto rounded-xl p-1 sm:-right-24">
              {suggestions.map((x, i) => (
                <li key={x.key}>
                  {i > 0 && suggestions[i - 1].present && !x.present && <p className="label-xs px-2 pb-1 pt-2 !text-[10px]">Teltonika IO</p>}
                  {i === 0 && x.present && <p className="label-xs px-2 pb-1 pt-1 !text-[10px]">In {live.name}’s latest position</p>}
                  <button type="button" role="option" aria-selected={d.source === x.key} onMouseDown={(e) => e.preventDefault()} onClick={() => pickSource(x.key)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-900/5 dark:hover:bg-white/[0.07]">
                    <span className="w-14 shrink-0 font-mono text-[12px] font-semibold text-slate-900 dark:text-white">{x.key}</span>
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-slate-500 dark:text-slate-400">{x.label}</span>
                    {x.value != null && <span className="tabular shrink-0 rounded bg-emerald-500/12 px-1.5 font-mono text-[11px] text-emerald-700 dark:text-emerald-300">{x.value}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Type</span>
        <div role="radiogroup" aria-label="Sensor type" className="grid grid-cols-5 gap-1.5">
          {SENSOR_TYPES.map((t) => {
            const m = SENSOR_META[t]
            const on = d.type === t
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setD((s) => ({ ...s, type: t as SensorType, unit: s.unit === SENSOR_META[s.type].unit ? m.unit : s.unit, decimals: m.decimals }))}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-medium transition-colors',
                  on ? 'border-brand-500 bg-brand-500/10 text-slate-900 dark:text-white' : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-white/10 dark:text-slate-400',
                )}
              >
                <m.icon className="h-4 w-4" style={{ color: on ? m.color : undefined }} />
                {m.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* conversion */}
      <section className="space-y-3 rounded-xl border border-slate-200/80 p-3 dark:border-white/[0.07]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-[13px] font-semibold text-slate-900 dark:text-white">Conversion</h4>
          <Segmented
            size="sm"
            label="Conversion"
            value={d.mode}
            onChange={(m) => set('mode', m)}
            options={[
              { id: 'table', label: <span className="inline-flex items-center gap-1"><Table2 className="h-3 w-3" /> Calibration table</span> },
              { id: 'linear', label: <span className="inline-flex items-center gap-1"><Calculator className="h-3 w-3" /> Multiplier</span> },
            ]}
          />
        </div>
        {d.mode === 'table' ? (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
            <div>
              <div className="grid grid-cols-[1fr_1fr_28px] gap-1 px-0.5 pb-1 text-[11px] font-medium text-slate-500">
                <span>Raw</span>
                <span>{d.unit || 'Value'}</span>
              </div>
              <div className="max-h-56 space-y-1 overflow-y-auto pr-0.5">
                {d.rows.map((r, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_28px] gap-1">
                    {[0, 1].map((k) => (
                      <input
                        key={k}
                        inputMode="decimal"
                        value={r[k]}
                        aria-label={`Row ${i + 1} ${k ? 'value' : 'raw'}`}
                        onChange={(e) => set('rows', d.rows.map((x, j) => (j === i ? ((k ? [x[0], e.target.value] : [e.target.value, x[1]]) as [string, string]) : x)))}
                        className="tabular h-8 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 font-mono text-[12px] text-slate-900 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-white/[0.03] dark:text-white"
                      />
                    ))}
                    <IconButton size="sm" label={`Remove row ${i + 1}`} onClick={() => set('rows', d.rows.filter((_, j) => j !== i))} className="hover:!text-rose-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" variant="subtle" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => set('rows', [...d.rows, ['', '']])}>
                  Row
                </Button>
                {raw != null && (
                  <Button size="sm" variant="subtle" icon={<Crosshair className="h-3.5 w-3.5" />} onClick={() => set('rows', [...d.rows.filter((x) => x[0] || x[1]), [String(raw), '']])} title="Add a row with the current raw reading — fill in the measured value">
                    Current raw
                  </Button>
                )}
              </div>
              {err('calibration') && <p className="mt-1 text-[12px] text-rose-500">{err('calibration')}</p>}
            </div>
            <div className="rounded-lg bg-slate-50 p-2 dark:bg-white/[0.025]">
              <CalibrationChart pts={pts} raw={raw} value={value} unit={d.unit} color={meta.color} />
              <p className="px-1 text-[11px] text-slate-500 dark:text-slate-400">Linear interpolation between points. Fill the tank in steps and note raw ↔ litres.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Multiplier" error={err('multiplier')}>
              {(id, dsc) => <Input id={id} aria-describedby={dsc} inputMode="decimal" className="font-mono" value={d.multiplier} onChange={(e) => set('multiplier', e.target.value)} />}
            </Field>
            <Field label="Offset">
              {(id) => <Input id={id} inputMode="decimal" className="font-mono" value={d.offset} onChange={(e) => set('offset', e.target.value)} />}
            </Field>
            <p className="col-span-2 text-[11.5px] text-slate-500 dark:text-slate-400">
              value = raw × {d.multiplier || '1'} + {d.offset || '0'}
              {raw != null && (
                <>
                  {' '}
                  = <b className="text-slate-900 dark:text-white">{fmtSensor(value, d.unit, d.decimals)}</b>
                </>
              )}
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit">
            {(id) => <Input id={id} value={d.unit} maxLength={8} placeholder="L" onChange={(e) => set('unit', e.target.value)} />}
          </Field>
          <Field label="Decimals">
            {() => (
              <Segmented size="sm" label="Decimals" value={d.decimals} onChange={(x) => set('decimals', x)} className="mt-0.5 h-8 items-center" options={[0, 1, 2, 3].map((x) => ({ id: x, label: String(x) }))} />
            )}
          </Field>
        </div>
      </section>

      {d.type === 'fuel' ? (
        <section className="space-y-3 rounded-xl border border-slate-200/80 p-3 dark:border-white/[0.07]">
          <h4 className="text-[13px] font-semibold text-slate-900 dark:text-white">Tank & theft detection</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Tank capacity">
              {(id) => <Input id={id} inputMode="decimal" value={d.tankCapacity} onChange={(e) => set('tankCapacity', e.target.value)} trailing={<span className="pr-1.5 text-[11px] text-slate-400">{d.unit || 'L'}</span>} />}
            </Field>
            <Field label="Drain alert ≥" hint="Drop while parked">
              {(id, dsc) => <Input id={id} aria-describedby={dsc} inputMode="decimal" value={d.fuelDropThreshold} onChange={(e) => set('fuelDropThreshold', e.target.value)} trailing={<span className="pr-1.5 text-[11px] text-slate-400">{d.unit || 'L'}</span>} />}
            </Field>
            <Field label="Refuel ≥" hint="Rise counted as refuel">
              {(id, dsc) => <Input id={id} aria-describedby={dsc} inputMode="decimal" value={d.fuelFillThreshold} onChange={(e) => set('fuelFillThreshold', e.target.value)} trailing={<span className="pr-1.5 text-[11px] text-slate-400">{d.unit || 'L'}</span>} />}
            </Field>
          </div>
        </section>
      ) : (
        <section className="space-y-3 rounded-xl border border-slate-200/80 p-3 dark:border-white/[0.07]">
          <h4 className="text-[13px] font-semibold text-slate-900 dark:text-white">Alert thresholds</h4>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Min" hint="Below → sensor low" error={err('range')}>
              {(id, dsc) => <Input id={id} aria-describedby={dsc} inputMode="decimal" value={d.min} placeholder="None" onChange={(e) => set('min', e.target.value)} trailing={<span className="pr-1.5 text-[11px] text-slate-400">{d.unit}</span>} />}
            </Field>
            <Field label="Max" hint="Above → sensor high">
              {(id, dsc) => <Input id={id} aria-describedby={dsc} inputMode="decimal" value={d.max} placeholder="None" onChange={(e) => set('max', e.target.value)} trailing={<span className="pr-1.5 text-[11px] text-slate-400">{d.unit}</span>} />}
            </Field>
          </div>
        </section>
      )}

      <div className="space-y-2 rounded-xl border border-slate-200/80 p-3 dark:border-white/[0.07]">
        <div className="flex items-center justify-between">
          <label htmlFor="smoothing" className="text-[13px] font-semibold text-slate-900 dark:text-white">
            Smoothing
          </label>
          <span className="tabular text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">{d.smoothing <= 1 ? 'Off' : `${d.smoothing} fixes`}</span>
        </div>
        <input id="smoothing" type="range" className="slider" min={1} max={15} step={1} value={d.smoothing} onChange={(e) => set('smoothing', Number(e.target.value))} />
        <p className="text-[11.5px] text-slate-500 dark:text-slate-400">Median of the last N readings — removes fuel slosh on bumpy roads. 5 is a good start for fuel.</p>
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-200/80 pt-3 dark:border-white/[0.06]">
        <Button onClick={onDone}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} onClick={submit}>
          {initial ? 'Save sensor' : 'Add sensor'}
        </Button>
      </div>
    </div>
  )
}

export function SensorsPanel({ device, canEdit }: { device: Device; canEdit: boolean }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: qk.sensors(device.id), queryFn: () => api.sensors(device.id) })
  const live = useLive((s) => s.byId[device.id]) ?? device
  const [editing, setEditing] = useState<Sensor | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Sensor | null>(null)
  const del = useMutation({
    mutationFn: (s: Sensor) => api.deleteSensor(s.id),
    onSuccess: (_, s) => {
      qc.setQueryData<Sensor[]>(qk.sensors(device.id), (l) => l?.filter((x) => x.id !== s.id))
      toast.success('Sensor removed', s.name)
      setDeleting(null)
    },
  })
  if (editing) return <SensorEditor device={device} initial={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
  const sensors = list.data ?? []
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12.5px] text-slate-500 dark:text-slate-400">Turn raw IO values into litres, °C or volts. Values show on the Live Map, in History and in the Fuel & Temperature reports.</p>
        {canEdit && (
          <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditing('new')} className="shrink-0">
            Add
          </Button>
        )}
      </div>
      {list.isLoading ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : sensors.length === 0 ? (
        <EmptyState icon={<Gauge className="h-5 w-5" />} title="No sensors yet" description="Add a fuel probe (LLS), temperature probe (Dallas / BLE) or any analog input." className="py-6" />
      ) : (
        <ul className="space-y-1.5">
          {sensors.map((s) => {
            const m = sensorMeta(s.type)
            const cur = live.sensors?.find((x) => x.id === s.id)?.value ?? computeValue(s, typeof live.position?.attributes?.[s.source] === 'number' ? (live.position!.attributes[s.source] as number) : null)
            return (
              <li key={s.id} className="flex items-center gap-3 rounded-xl border border-slate-200/80 px-3 py-2.5 dark:border-white/[0.07]">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: `${m.color}1f`, color: m.color }}>
                  <m.icon className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900 dark:text-white">{s.name}</p>
                  <p className="truncate text-[11.5px] text-slate-500 dark:text-slate-400">
                    <span className="font-mono">{s.source}</span> · {s.calibration?.length >= 2 ? `${s.calibration.length}-point table` : `×${s.multiplier}${s.offset ? ` ${s.offset > 0 ? '+' : '−'} ${Math.abs(s.offset)}` : ''}`}
                    {s.min != null || s.max != null ? ` · ${s.min ?? '…'}–${s.max ?? '…'} ${s.unit}` : ''}
                  </p>
                </div>
                <span className="tabular shrink-0 text-[14px] font-semibold text-slate-900 dark:text-white">{fmtSensor(cur, s.unit, s.decimals)}</span>
                {canEdit && (
                  <span className="flex shrink-0">
                    <IconButton size="sm" label={`Edit ${s.name}`} onClick={() => setEditing(s)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton size="sm" label={`Delete ${s.name}`} onClick={() => setDeleting(s)} className="hover:!bg-rose-500/10 hover:!text-rose-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <Modal
        open={!!deleting}
        onClose={() => !del.isPending && setDeleting(null)}
        title={`Remove ${deleting?.name ?? 'sensor'}?`}
        description="Its values disappear from the live panel, history and reports."
        footer={
          <>
            <Button onClick={() => setDeleting(null)} disabled={del.isPending} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" loading={del.isPending} onClick={() => deleting && del.mutate(deleting)}>
              Remove sensor
            </Button>
          </>
        }
      />
    </div>
  )
}

export default SensorsPanel
