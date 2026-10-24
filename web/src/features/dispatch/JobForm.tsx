import { useMemo, useState, type ReactNode } from 'react'
import { addHours, format, setMinutes, startOfHour } from 'date-fns'
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, ClipboardList, ListChecks, MapPin, Plus, Trash2, UserRound, X } from 'lucide-react'
import type { Job, JobInput, JobPriority } from '@/api/types'
import { MapCanvas } from '@/components/map/MapCanvas'
import { RoutesLayer } from '@/components/map/RoutesLayer'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Segmented } from '@/components/ui/Tabs'
import { Switch } from '@/components/ui/Switch'
import { useDrivers, usePlaces } from '@/features/common/queries'
import { useDeviceList } from '@/store/live'
import { cn } from '@/lib/cn'
import { fmtWhen } from './JobBits'
import { priorityMeta } from './meta'
import { useRoutes, useSaveJob } from './queries'
import { FitStops, StopsLayer } from './StopsLayer'
import { StopSearch, StopsList, enrichStop, newKey, type DraftStop } from './StopsEditor'

interface CheckDraft {
  key: string
  id?: number
  text: string
  required: boolean
  done?: boolean
}

interface Draft {
  title: string
  description: string
  priority: JobPriority
  customerName: string
  customerPhone: string
  notes: string
  stops: DraftStop[]
  checklist: CheckDraft[]
  driverId: string
  deviceId: string
  routeId: string
  scheduledStart: string
  dueBy: string
}

const toLocal = (iso: string | null | undefined) => (iso ? format(Date.parse(iso), "yyyy-MM-dd'T'HH:mm") : '')
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null)

function draftOf(j: Job | null): Draft {
  if (!j) {
    const start = setMinutes(startOfHour(addHours(new Date(), 1)), 0)
    return {
      title: '',
      description: '',
      priority: 'normal',
      customerName: '',
      customerPhone: '',
      notes: '',
      stops: [],
      checklist: [],
      driverId: '',
      deviceId: '',
      routeId: '',
      scheduledStart: toLocal(start.toISOString()),
      dueBy: toLocal(addHours(start, 4).toISOString()),
    }
  }
  return {
    title: j.title,
    description: j.description ?? '',
    priority: j.priority,
    customerName: j.customerName ?? '',
    customerPhone: j.customerPhone ?? '',
    notes: j.notes ?? '',
    stops: [...j.stops].sort((a, b) => a.seq - b.seq).map((s) => ({ key: newKey(), id: s.id, name: s.name, address: s.address, lat: s.lat, lng: s.lng, radius: s.radius, notes: s.notes ?? '', status: s.status })),
    checklist: j.checklist.map((c) => ({ key: newKey(), id: c.id, text: c.text, required: c.required, done: c.done })),
    driverId: j.driverId != null ? String(j.driverId) : '',
    deviceId: j.deviceId != null ? String(j.deviceId) : '',
    routeId: j.routeId != null ? String(j.routeId) : '',
    scheduledStart: toLocal(j.scheduledStart),
    dueBy: toLocal(j.dueBy),
  }
}

function toInput(d: Draft): JobInput {
  return {
    title: d.title.trim(),
    description: d.description.trim(),
    priority: d.priority,
    customerName: d.customerName.trim(),
    customerPhone: d.customerPhone.trim(),
    notes: d.notes.trim(),
    deviceId: d.deviceId ? Number(d.deviceId) : null,
    driverId: d.driverId ? Number(d.driverId) : null,
    routeId: d.routeId ? Number(d.routeId) : null,
    scheduledStart: fromLocal(d.scheduledStart),
    dueBy: fromLocal(d.dueBy),
    stops: d.stops.map((s, i) => ({
      ...(s.id != null ? { id: s.id } : {}),
      seq: i + 1,
      name: s.name.trim() || `Stop ${i + 1}`,
      address: s.address,
      lat: +s.lat.toFixed(7),
      lng: +s.lng.toFixed(7),
      radius: Math.max(20, Math.round(s.radius || 150)),
      notes: s.notes.trim(),
    })),
    checklist: d.checklist
      .filter((c) => c.text.trim())
      .map((c) => ({ ...(c.id != null ? { id: c.id } : {}), text: c.text.trim(), required: c.required, ...(c.done != null ? { done: c.done } : {}) })),
  }
}

type Step = 'details' | 'stops' | 'checklist' | 'assign' | 'review'
const STEPS: Array<{ id: Step; label: string; icon: ReactNode }> = [
  { id: 'details', label: 'Details', icon: <ClipboardList className="h-4 w-4" /> },
  { id: 'stops', label: 'Stops', icon: <MapPin className="h-4 w-4" /> },
  { id: 'checklist', label: 'Checklist', icon: <ListChecks className="h-4 w-4" /> },
  { id: 'assign', label: 'Assign', icon: <UserRound className="h-4 w-4" /> },
  { id: 'review', label: 'Review', icon: <Check className="h-4 w-4" /> },
]

const CHECK_PRESETS = ['Check seal is intact', 'Count cartons with customer', 'Collect signature', 'Photo of delivered goods', 'Collect cash on delivery']

export function JobForm({ initial, onClose, onSaved }: { initial: Job | null; onClose: () => void; onSaved: (j: Job) => void }) {
  const editing = !!initial
  const [d, setD] = useState<Draft>(() => draftOf(initial))
  const [step, setStep] = useState<Step>('details')
  const [touched, setTouched] = useState<Partial<Record<Step, boolean>>>({})
  const [picking, setPicking] = useState(true)
  const [sel, setSel] = useState<number | null>(null)
  const [fit, setFit] = useState(0)
  const places = usePlaces()
  const drivers = useDrivers()
  const routes = useRoutes()
  const devices = useDeviceList()
  const save = useSaveJob((j) => onSaved(j))
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((s) => ({ ...s, [k]: v }))

  const errors: Partial<Record<Step, Record<string, string>>> = {}
  if (!d.title.trim()) errors.details = { title: 'Give the job a title' }
  if (d.customerPhone && !/^\+?[\d\s-]{5,20}$/.test(d.customerPhone.trim())) errors.details = { ...errors.details, phone: 'Enter a valid phone number' }
  if (!d.stops.length) errors.stops = { stops: 'Add at least one stop' }
  if (d.scheduledStart && d.dueBy && d.dueBy <= d.scheduledStart) errors.assign = { due: 'Due time must be after the start' }
  const err = (s: Step, k: string) => (touched[s] ? errors[s]?.[k] : undefined)
  const steps = editing ? STEPS.filter((s) => s.id !== 'review') : STEPS
  const idx = steps.findIndex((s) => s.id === step)

  const addStop = (s: Omit<DraftStop, 'key'>, refit = false) => {
    if (refit) window.setTimeout(() => setFit((f) => f + 1), 0)
    const st: DraftStop = { ...s, key: newKey(), name: s.name || `Stop ${d.stops.length + 1}` }
    setD((x) => ({ ...x, stops: [...x.stops, st] }))
    setSel(d.stops.length)
    if (!s.address)
      void enrichStop(st).then((p) => setD((x) => ({ ...x, stops: x.stops.map((y) => (y.key === st.key ? { ...y, ...p } : y)) })))
  }

  const go = (to: Step) => {
    setTouched((t) => ({ ...t, [step]: true }))
    const toIdx = steps.findIndex((s) => s.id === to)
    if (toIdx > idx && errors[step] && !editing) return
    setStep(to)
    if (to === 'stops') setFit((f) => f + 1)
  }
  const submit = () => {
    setTouched({ details: true, stops: true, checklist: true, assign: true })
    const bad = steps.find((s) => errors[s.id])
    if (bad) return setStep(bad.id)
    save.mutate({ id: initial?.id ?? null, input: toInput(d) })
  }

  const driver = drivers.data?.find((x) => String(x.id) === d.driverId)
  const driverVehicle = driver?.deviceId != null ? devices.find((x) => x.id === driver.deviceId) : undefined
  const route = routes.data?.find((r) => String(r.id) === d.routeId)
  const stopPts = useMemo(() => d.stops.map((s) => ({ lat: s.lat, lng: s.lng, radius: s.radius, name: s.name, status: s.status ?? 'pending' })), [d.stops])

  return (
    <Modal open onClose={onClose} title={editing ? `Edit ${initial.reference}` : 'New job'} bare phoneFull className="flex h-[min(780px,92vh)] !max-w-5xl flex-col !p-0">
      {/* header */}
      <div className="flex items-center gap-3 border-b border-slate-200/80 px-4 py-3 dark:border-white/[0.07] sm:px-5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500 text-navy-900">
          <ClipboardList className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold text-slate-900 dark:text-white">{editing ? `Edit ${initial.reference}` : 'New job'}</h2>
          <p className="truncate text-[12px] text-slate-500 dark:text-slate-400">{editing ? initial.title : 'Create a job, add its stops and assign a driver'}</p>
        </div>
        <IconButton label="Close" onClick={onClose} size="sm">
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      <nav aria-label="Steps" className="flex gap-1 overflow-x-auto border-b border-slate-200/80 px-3 py-2 dark:border-white/[0.07] sm:px-4">
        {steps.map((s, i) => {
          const done = i < idx && !errors[s.id]
          const on = s.id === step
          const bad = touched[s.id] && errors[s.id]
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => (editing || i <= idx ? setStep(s.id) : go(s.id))}
              aria-current={on ? 'step' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
                on ? 'bg-brand-500/15 text-navy-800 dark:bg-brand-400/15 dark:text-brand-100' : 'text-slate-500 hover:bg-slate-900/[0.04] dark:text-slate-400 dark:hover:bg-white/[0.05]',
              )}
            >
              <span
                className={cn(
                  'tabular grid h-5 w-5 place-items-center rounded-full text-[10.5px] font-bold',
                  bad ? 'bg-rose-500 text-white' : on ? 'bg-brand-500 text-navy-900' : done ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-300',
                )}
              >
                {done && !bad ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
              </span>
              {s.label}
              {s.id === 'stops' && d.stops.length > 0 && <span className="tabular text-[11px] text-slate-400">{d.stops.length}</span>}
            </button>
          )
        })}
      </nav>

      {/* body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {step === 'details' && (
          <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
            <Field label="Title" required error={err('details', 'title')}>
              {(id, dsc) => (
                <Input id={id} aria-describedby={dsc} data-autofocus value={d.title} invalid={!!err('details', 'title')} placeholder="Deliver 40 cartons of water — Bakaaraha" onChange={(e) => set('title', e.target.value)} />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Customer">
                {(id) => <Input id={id} value={d.customerName} placeholder="Hormuud Supermarket" onChange={(e) => set('customerName', e.target.value)} />}
              </Field>
              <Field label="Customer phone" error={err('details', 'phone')}>
                {(id, dsc) => <Input id={id} aria-describedby={dsc} type="tel" value={d.customerPhone} invalid={!!err('details', 'phone')} placeholder="+252 61 555 0123" onChange={(e) => set('customerPhone', e.target.value)} />}
              </Field>
            </div>
            <div className="space-y-1.5">
              <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Priority</span>
              <Segmented<JobPriority>
                label="Priority"
                value={d.priority}
                onChange={(p) => set('priority', p)}
                className="sm:w-80"
                options={(['normal', 'high', 'urgent'] as const).map((p) => ({
                  id: p,
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <span className={cn('h-2 w-2 rounded-full', priorityMeta(p).dot)} />
                      {priorityMeta(p).label}
                    </span>
                  ),
                }))}
              />
            </div>
            <Field label="Description" hint="Shown to the driver in the app">
              {(id, dsc) => <Textarea id={id} aria-describedby={dsc} rows={3} value={d.description} placeholder="What to deliver or do, special handling…" onChange={(e) => set('description', e.target.value)} />}
            </Field>
            <Field label="Internal notes" hint="Only visible to dispatchers">
              {(id, dsc) => <Textarea id={id} aria-describedby={dsc} rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />}
            </Field>
          </div>
        )}

        {step === 'stops' && (
          <div className="flex h-full min-h-0 flex-col md:flex-row">
            <div className="relative h-[260px] shrink-0 md:h-auto md:min-h-0 md:flex-1">
              <MapCanvas className="absolute inset-0">
                {route && <RoutesLayer routes={[route]} prefix="form-route" labels={false} />}
                <StopsLayer
                  stops={stopPts}
                  prefix="form-stops"
                  selected={sel}
                  draggable
                  onPinClick={(i) => setSel(i)}
                  onMove={(i, [lng, lat]) => setD((x) => ({ ...x, stops: x.stops.map((s, k) => (k === i ? { ...s, lat, lng, address: '' } : s)) }))}
                  onMapClick={picking ? ([lng, lat]) => addStop({ name: '', address: '', lat, lng, radius: 150, notes: '' }) : undefined}
                />
                <FitStops
                  points={d.stops.length ? d.stops.map((s) => [s.lng, s.lat]) : (places.data ?? []).map((p) => [p.lng, p.lat])}
                  fitKey={`${fit}:${d.stops.length ? 1 : places.data?.length ?? 0}`}
                  padding={50}
                />
              </MapCanvas>
              {picking && (
                <div className="glass pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 text-[11.5px] font-medium text-slate-700 dark:text-slate-200">
                  Click the map to add stop {d.stops.length + 1} · drag pins to move
                </div>
              )}
            </div>
            <div className="flex min-h-0 flex-col border-slate-200/80 dark:border-white/[0.07] md:w-[400px] md:border-l">
              <div className="space-y-2 border-b border-slate-200/80 p-3 dark:border-white/[0.07]">
                <StopSearch places={places.data ?? []} onAdd={(x) => addStop(x, true)} picking={picking} onPickMode={() => setPicking((p) => !p)} />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <StopsList stops={d.stops} onChange={(s) => set('stops', s)} selected={sel} onSelect={setSel} error={err('stops', 'stops')} />
              </div>
            </div>
          </div>
        )}

        {step === 'checklist' && (
          <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
            <div>
              <h3 className="text-[14px] font-semibold text-slate-900 dark:text-white">Checklist</h3>
              <p className="text-[12.5px] text-slate-500 dark:text-slate-400">The driver ticks these off in the app. Required items must be done before the job can be completed.</p>
            </div>
            <ul className="space-y-1.5">
              {d.checklist.map((c, i) => (
                <li key={c.key} className="flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white px-2 py-1.5 dark:border-white/[0.07] dark:bg-ink-850">
                  <span className="tabular w-5 text-center text-[11px] font-semibold text-slate-400">{i + 1}</span>
                  <input
                    value={c.text}
                    onChange={(e) => set('checklist', d.checklist.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))}
                    placeholder="e.g. Check seal is intact"
                    aria-label={`Checklist item ${i + 1}`}
                    className="h-8 min-w-0 flex-1 rounded-md bg-transparent px-1.5 text-[13px] text-slate-900 focus:outline-none dark:text-white"
                  />
                  <label className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-slate-500 dark:text-slate-400">
                    <Switch size="sm" checked={c.required} onChange={(v) => set('checklist', d.checklist.map((x, k) => (k === i ? { ...x, required: v } : x)))} label={`Item ${i + 1} required`} />
                    <span className="hidden sm:inline">Required</span>
                  </label>
                  <IconButton size="sm" label="Move up" disabled={i === 0} onClick={() => set('checklist', swap(d.checklist, i, i - 1))}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton size="sm" label="Move down" disabled={i === d.checklist.length - 1} onClick={() => set('checklist', swap(d.checklist, i, i + 1))}>
                    <ArrowDown className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton size="sm" label={`Remove item ${i + 1}`} onClick={() => set('checklist', d.checklist.filter((_, k) => k !== i))} className="hover:!bg-rose-500/10 hover:!text-rose-500">
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </li>
              ))}
            </ul>
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => set('checklist', [...d.checklist, { key: newKey(), text: '', required: false }])}>
              Add item
            </Button>
            <div>
              <p className="label-xs mb-1.5 !text-[10.5px]">Quick add</p>
              <div className="flex flex-wrap gap-1.5">
                {CHECK_PRESETS.filter((p) => !d.checklist.some((c) => c.text === p)).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => set('checklist', [...d.checklist, { key: newKey(), text: p, required: /signature|seal/i.test(p) }])}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-[12px] text-slate-600 hover:border-brand-500 hover:bg-brand-500/10 dark:border-white/10 dark:text-slate-300"
                  >
                    <Plus className="h-3 w-3" /> {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 'assign' && (
          <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Driver" hint={driver && !driver.userId ? 'This driver has no app login yet (Drivers → Edit)' : 'Sees the job in the driver app'}>
                {(id, dsc) => (
                  <Select id={id} aria-describedby={dsc} value={d.driverId} onChange={(e) => set('driverId', e.target.value)}>
                    <option value="">— Unassigned —</option>
                    {drivers.data?.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                        {x.userId ? '' : ' (no app login)'}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Vehicle" hint={driverVehicle && !d.deviceId ? `Empty = driver’s vehicle (${driverVehicle.name})` : 'Used for automatic stop arrival'}>
                {(id, dsc) => (
                  <Select id={id} aria-describedby={dsc} value={d.deviceId} onChange={(e) => set('deviceId', e.target.value)}>
                    <option value="">{driverVehicle ? `Driver’s vehicle — ${driverVehicle.name}` : '— None —'}</option>
                    {devices.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                        {x.plate ? ` · ${x.plate}` : ''}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Scheduled start">
                {(id) => <Input id={id} type="datetime-local" value={d.scheduledStart} onChange={(e) => set('scheduledStart', e.target.value)} className="dark:[&_input]:[color-scheme:dark]" />}
              </Field>
              <Field label="Due by" error={err('assign', 'due')} hint={err('assign', 'due') ? undefined : 'Late alert fires if not completed by then'}>
                {(id, dsc) => <Input id={id} aria-describedby={dsc} type="datetime-local" value={d.dueBy} invalid={!!err('assign', 'due')} onChange={(e) => set('dueBy', e.target.value)} className="dark:[&_input]:[color-scheme:dark]" />}
              </Field>
            </div>
            <Field label="Planned route" hint="Optional. The vehicle is monitored for deviation from this route while the job is active.">
              {(id, dsc) => (
                <Select id={id} aria-describedby={dsc} value={d.routeId} onChange={(e) => set('routeId', e.target.value)}>
                  <option value="">— No planned route —</option>
                  {routes.data?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} (±{r.corridor} m)
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        )}

        {step === 'review' && (
          <div className="mx-auto max-w-2xl space-y-3 p-4 sm:p-6">
            <Summary label="Job" onEdit={() => setStep('details')}>
              <p className="font-semibold text-slate-900 dark:text-white">{d.title || '—'}</p>
              <p className="text-[12.5px] text-slate-500">
                {[d.customerName, d.customerPhone].filter(Boolean).join(' · ') || 'No customer'} · {priorityMeta(d.priority).label} priority
              </p>
            </Summary>
            <Summary label={`${d.stops.length} stop${d.stops.length === 1 ? '' : 's'}`} onEdit={() => setStep('stops')}>
              <ol className="space-y-1">
                {d.stops.map((s, i) => (
                  <li key={s.key} className="flex items-center gap-2 text-[12.5px]">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-navy-700 text-[10px] font-bold text-brand-400 dark:bg-brand-500 dark:text-navy-900">{i + 1}</span>
                    <span className="font-medium text-slate-900 dark:text-white">{s.name}</span>
                    <span className="truncate text-slate-500">{s.address}</span>
                  </li>
                ))}
              </ol>
            </Summary>
            <Summary label="Checklist" onEdit={() => setStep('checklist')}>
              <p className="text-[12.5px] text-slate-600 dark:text-slate-300">
                {d.checklist.filter((c) => c.text.trim()).length
                  ? d.checklist
                      .filter((c) => c.text.trim())
                      .map((c) => c.text + (c.required ? ' *' : ''))
                      .join(' · ')
                  : 'No checklist'}
              </p>
            </Summary>
            <Summary label="Assignment" onEdit={() => setStep('assign')}>
              <p className="text-[12.5px] text-slate-600 dark:text-slate-300">
                {driver?.name ?? 'Unassigned'} · {devices.find((x) => String(x.id) === d.deviceId)?.name ?? driverVehicle?.name ?? 'no vehicle'}
                {route ? ` · route ${route.name}` : ''}
              </p>
              <p className="tabular text-[12.5px] text-slate-500">
                Start {fmtWhen(fromLocal(d.scheduledStart))} · Due {fmtWhen(fromLocal(d.dueBy))}
              </p>
            </Summary>
            {!driver && (
              <p className="rounded-lg bg-amber-500/12 px-3 py-2 text-[12.5px] text-amber-800 dark:text-amber-200">
                The job will wait in <b>Unassigned</b> until you pick a driver.
              </p>
            )}
          </div>
        )}
      </div>

      {/* footer */}
      <div className="flex items-center gap-2 border-t border-slate-200/80 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-white/[0.07] sm:px-5">
        {idx > 0 ? (
          <Button icon={<ChevronLeft className="h-4 w-4" />} onClick={() => setStep(steps[idx - 1].id)}>
            Back
          </Button>
        ) : (
          <Button onClick={onClose}>Cancel</Button>
        )}
        <span className="tabular hidden text-[12px] text-slate-400 sm:block">
          Step {idx + 1} of {steps.length}
        </span>
        <div className="ml-auto flex gap-2">
          {editing && (
            <Button variant="primary" loading={save.isPending} onClick={submit}>
              Save changes
            </Button>
          )}
          {!editing && idx < steps.length - 1 && (
            <Button variant="primary" onClick={() => go(steps[idx + 1].id)}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          )}
          {!editing && idx === steps.length - 1 && (
            <Button variant="primary" loading={save.isPending} icon={<Check className="h-4 w-4" />} onClick={submit}>
              Create job
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function swap<T>(a: T[], i: number, j: number): T[] {
  const n = a.slice()
  ;[n[i], n[j]] = [n[j], n[i]]
  return n
}

function Summary({ label, onEdit, children }: { label: string; onEdit: () => void; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200/80 p-3 dark:border-white/[0.07]">
      <div className="mb-1 flex items-center justify-between">
        <span className="label-xs !text-[10.5px]">{label}</span>
        <button type="button" onClick={onEdit} className="text-[12px] font-medium text-navy-600 hover:underline dark:text-brand-300">
          Edit
        </button>
      </div>
      {children}
    </div>
  )
}
