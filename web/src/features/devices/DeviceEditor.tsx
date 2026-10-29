import { lazy, Suspense, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, ChevronRight, CircleDot, Cpu, Gauge, IdCard, Navigation, SlidersHorizontal, Truck, UserRound } from 'lucide-react'
import { api, ApiError, qk } from '@/api/client'
import { DEVICE_CATEGORIES, emptyDetails, FUEL_TYPES, PROTOCOLS, type Device, type DeviceDetails, type DeviceIcon, type DeviceInput } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Input'
import { Drawer } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Misc'
import { Segmented, Tabs } from '@/components/ui/Tabs'
import { SourceBadge } from '@/components/ui/SourceBadge'
import { GroupChip } from '@/components/ui/Badges'
import { useDrivers, useGroups } from '@/features/common/queries'
import { ParamsTable } from '@/features/params/ParamsTable'
import { useAccess } from '@/lib/access'
import { categoryMeta } from '@/lib/category'
import { DEVICE_ICON_META } from '@/lib/deviceIcons'
import { useLive } from '@/store/live'
import { toast } from '@/store/toast'
import { cn } from '@/lib/cn'

const SensorsPanel = lazy(() => import('@/features/sensors/SensorsPanel'))

export type EditorTab = 'tracker' | 'vehicle' | 'owner' | 'driver' | 'sensors' | 'params'
const FORM_STEPS = ['tracker', 'vehicle', 'owner', 'driver'] as const
type FormStep = (typeof FORM_STEPS)[number]
type WizardStep = FormStep | 'review'

const STEP_META: Record<EditorTab | 'review', { label: string; icon: ReactNode }> = {
  tracker: { label: 'Tracker', icon: <Cpu /> },
  vehicle: { label: 'Vehicle', icon: <Truck /> },
  owner: { label: 'Owner', icon: <UserRound /> },
  driver: { label: 'Driver', icon: <IdCard /> },
  sensors: { label: 'Sensors', icon: <Gauge /> },
  params: { label: 'Parameters', icon: <SlidersHorizontal /> },
  review: { label: 'Review', icon: <Check /> },
}

type DriverMode = 'none' | 'existing' | 'new'

interface V {
  name: string
  imei: string
  protocol: string
  model: string
  phone: string
  plate: string
  category: string
  icon: DeviceIcon | ''
  speedLimit: string
  odometer: string
  engineHours: string
  year: string
  details: DeviceDetails
  driverMode: DriverMode
  driverId: string
  newDriver: { name: string; phone: string; licenseNumber: string }
  groupIds: number[]
}

type Errors = Partial<Record<string, string>>

function validate(v: V, bridged: boolean): Errors {
  const e: Errors = {}
  const d = v.details
  if (!v.name.trim()) e.name = 'Name is required'
  else if (v.name.trim().length > 100) e.name = 'Keep it under 100 characters'
  if (bridged) {
    if (!v.imei.trim()) e.imei = 'Identifier is required'
  } else if (!/^\d{15}$/.test(v.imei.trim())) e.imei = 'IMEI must be exactly 15 digits'
  if (v.phone && !/^\+?[\d\s()-]{5,24}$/.test(v.phone.trim())) e.phone = 'Enter a valid phone number'
  if (d.sim.iccid && !/^\d{18,22}F?$/i.test(d.sim.iccid.replace(/\s/g, ''))) e.iccid = 'ICCID is 18–22 digits'
  if (v.speedLimit.trim() && !/^\d{1,3}$/.test(v.speedLimit.trim())) e.speedLimit = 'Whole km/h'
  else if (Number(v.speedLimit) > 300) e.speedLimit = 'Faster than 300 km/h?'
  if (v.odometer && !/^\d{1,8}(\.\d*)?$/.test(v.odometer)) e.odometer = 'Kilometres, e.g. 81234'
  if (v.engineHours && !/^\d{1,6}(\.\d*)?$/.test(v.engineHours)) e.engineHours = 'Hours, e.g. 812.5'
  if (d.vehicle.vin && !/^[A-HJ-NPR-Z0-9]{11,17}$/i.test(d.vehicle.vin)) e.vin = '11–17 letters/digits, no I, O or Q'
  if (v.year && (!/^\d{4}$/.test(v.year) || Number(v.year) < 1950 || Number(v.year) > 2100)) e.year = '1950–2100'
  if (d.owner.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.owner.email.trim())) e.ownerEmail = 'Enter a valid email'
  if (d.owner.phone && !/^\+?[\d\s()-]{5,24}$/.test(d.owner.phone.trim())) e.ownerPhone = 'Enter a valid phone number'
  if (v.driverMode === 'existing' && !v.driverId) e.driverId = 'Choose a driver'
  if (v.driverMode === 'new' && !v.newDriver.name.trim()) e.newDriverName = 'Driver name is required'
  return e
}

/** Which step each error belongs to (to jump there on submit). */
const ERROR_STEP: Record<string, FormStep> = {
  name: 'tracker',
  imei: 'tracker',
  phone: 'tracker',
  iccid: 'tracker',
  speedLimit: 'vehicle',
  odometer: 'vehicle',
  engineHours: 'vehicle',
  vin: 'vehicle',
  year: 'vehicle',
  ownerEmail: 'owner',
  ownerPhone: 'owner',
  driverId: 'driver',
  newDriverName: 'driver',
}

function initialValues(d: Device | null, currentDriverId: number | null): V {
  const det = d?.details ? structuredClone(d.details) : emptyDetails()
  return {
    name: d?.name ?? '',
    imei: d?.imei ?? '',
    protocol: d?.protocol || 'teltonika',
    model: d?.model ?? '',
    phone: d?.phone ?? '',
    plate: d?.plate ?? '',
    category: d?.category || 'car',
    icon: (d?.icon as DeviceIcon | '') ?? '',
    speedLimit: d?.speedLimit ? String(d.speedLimit) : '',
    odometer: d?.odometer != null ? String(Math.round(d.odometer)) : '',
    engineHours: d?.engineHours != null ? String(Math.round(d.engineHours * 10) / 10) : '',
    year: det.vehicle.year ? String(det.vehicle.year) : '',
    details: det,
    driverMode: currentDriverId != null ? 'existing' : 'none',
    driverId: currentDriverId != null ? String(currentDriverId) : '',
    newDriver: { name: '', phone: '', licenseNumber: '' },
    groupIds: d?.groupIds ?? [],
  }
}

function Grid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return <div className={cn('grid gap-3', cols === 3 ? 'grid-cols-3' : 'grid-cols-2')}>{children}</div>
}

function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="pt-1">
      <p className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-100">{children}</p>
      {hint && <p className="text-[11.5px] text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  )
}

const dateCls = 'dark:[&_input]:[color-scheme:dark]'

/**
 * Register a device (step-by-step wizard) or edit it (tabs): tracker & SIM,
 * vehicle & map icon, owner, driver & groups, then sensors and parameters.
 */
export function DeviceEditor({ initial, onClose, startTab = 'tracker' }: { initial: Device | null; onClose: () => void; startTab?: EditorTab }) {
  const qc = useQueryClient()
  const bridged = initial?.source === 'traccar'
  const { isAdmin, canManage } = useAccess()
  const drivers = useDrivers()
  const groups = useGroups(isAdmin)
  const upsert = useLive((s) => s.upsert)
  const liveDevice = useLive((s) => (initial ? s.byId[initial.id] : undefined))
  const settings = useQuery({ queryKey: qk.settings, queryFn: api.settings, staleTime: 60_000, meta: { silent: true } })
  const defaultLimit = settings.data?.speedLimit
  const manualDriverId = useMemo(() => (initial ? (drivers.data?.find((d) => d.deviceId === initial.id)?.id ?? null) : null), [drivers.data, initial])

  // after creating, the editor switches to the new device (sensors / parameters)
  const [created, setCreated] = useState<Device | null>(null)
  const createdLive = useLive((s) => (created ? s.byId[created.id] : undefined))
  const device = createdLive ?? created ?? liveDevice ?? initial
  const wizard = !initial && !created
  const [step, setStep] = useState<WizardStep>('tracker')
  const [tab, setTab] = useState<EditorTab>(initial ? startTab : 'tracker')
  const [v, setV] = useState<V>(() => initialValues(initial, null))
  const [driverSynced, setDriverSynced] = useState(false)
  if (!driverSynced && initial && drivers.data) {
    setDriverSynced(true)
    if (manualDriverId != null) setV((s) => ({ ...s, driverMode: 'existing', driverId: String(manualDriverId) }))
  }
  const [touched, setTouched] = useState<Set<WizardStep | EditorTab>>(new Set())
  const [serverError, setServerError] = useState<string | null>(null)
  const errors = validate(v, bridged)
  const current: WizardStep | EditorTab = wizard ? step : tab
  const show = (k: string) => (touched.has(ERROR_STEP[k]) || touched.has('review') ? errors[k] : undefined)
  const set = <K extends keyof V>(k: K, val: V[K]) => setV((s) => ({ ...s, [k]: val }))
  const setDet = <S extends keyof DeviceDetails>(section: S, patch: DeviceDetails[S] extends object ? Partial<DeviceDetails[S]> : DeviceDetails[S]) =>
    setV((s) => ({ ...s, details: { ...s.details, [section]: typeof patch === 'object' ? { ...(s.details[section] as object), ...patch } : patch } }))

  const save = useMutation({
    meta: { silent: true },
    mutationFn: async () => {
      let driverId: number | null | undefined
      if (v.driverMode === 'new') {
        const d = await api.createDriver({ name: v.newDriver.name.trim(), phone: v.newDriver.phone.trim(), licenseNumber: v.newDriver.licenseNumber.trim(), licenseExpiry: '', tag: '', deviceId: null, notes: '' })
        driverId = d.id
        void qc.invalidateQueries({ queryKey: qk.drivers })
      } else if (v.driverMode === 'existing') driverId = Number(v.driverId)
      else driverId = initial && manualDriverId == null ? undefined : null
      if (initial && driverId === manualDriverId) driverId = undefined // unchanged

      const det: DeviceDetails = { ...v.details, vehicle: { ...v.details.vehicle, year: Number(v.year) || 0 } }
      const input: DeviceInput & { driverId?: number | null; groupIds?: number[] } = {
        name: v.name.trim(),
        imei: v.imei.trim(),
        protocol: v.protocol,
        plate: v.plate.trim(),
        model: v.model.trim(),
        category: v.category,
        phone: v.phone.trim(),
        speedLimit: v.speedLimit.trim() ? Number(v.speedLimit) : 0,
        icon: v.icon,
        details: det,
      }
      if (driverId !== undefined) input.driverId = driverId
      if (isAdmin && (!initial || JSON.stringify([...v.groupIds].sort()) !== JSON.stringify([...(initial.groupIds ?? [])].sort()))) input.groupIds = v.groupIds
      // counters only when changed (calibration)
      if (v.odometer !== '' && (!initial || Number(v.odometer) !== Math.round(initial.odometer ?? -1))) input.odometer = Number(v.odometer)
      if (v.engineHours !== '' && (!initial || Number(v.engineHours) !== Math.round((initial.engineHours ?? -1) * 10) / 10)) input.engineHours = Number(v.engineHours)
      return initial ? api.updateDevice(initial.id, input) : api.createDevice(input)
    },
    onSuccess: (d) => {
      upsert(d)
      void qc.invalidateQueries({ queryKey: qk.drivers })
      if (initial) {
        toast.success('Device updated', d.name)
        onClose()
      } else {
        toast.success('Device registered', d.name)
        setCreated(d)
        setTab('sensors')
      }
    },
    onError: (e) => setServerError(e instanceof ApiError ? e.message : 'Could not save the device'),
  })

  const stepErrors = (s: FormStep) => Object.keys(errors).filter((k) => ERROR_STEP[k] === s)
  const markTouched = (s: WizardStep | EditorTab) => setTouched((t) => new Set(t).add(s))
  const goNext = () => {
    if (step === 'review') return
    markTouched(step)
    if (stepErrors(step).length) return
    const i = FORM_STEPS.indexOf(step)
    setStep(i < FORM_STEPS.length - 1 ? FORM_STEPS[i + 1] : 'review')
  }
  const goBack = () => {
    const i = step === 'review' ? FORM_STEPS.length : FORM_STEPS.indexOf(step)
    if (i > 0) setStep(FORM_STEPS[i - 1])
  }
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    setServerError(null)
    if (wizard && step !== 'review') return goNext()
    setTouched(new Set([...FORM_STEPS, 'review']))
    const bad = Object.keys(errors)
    if (bad.length) {
      const s = ERROR_STEP[bad[0]]
      if (wizard) setStep(s)
      else setTab(s)
      return
    }
    save.mutate()
  }

  const formTab = (FORM_STEPS as readonly string[]).includes(current) || current === 'review'
  const title = wizard ? 'Register a device' : created ? `${created.name} registered` : 'Edit device'
  const subtitle = wizard ? `Step ${step === 'review' ? 5 : FORM_STEPS.indexOf(step) + 1} of 5 · ${STEP_META[step].label}` : device ? `${device.name} · ${device.imei}` : undefined

  const footer = wizard ? (
    <>
      {step === 'tracker' ? <Button onClick={onClose}>Cancel</Button> : <Button icon={<ChevronLeft className="h-4 w-4" />} onClick={goBack}>Back</Button>}
      {step === 'review' ? (
        <Button variant="primary" loading={save.isPending} onClick={() => submit()} icon={<Check className="h-4 w-4" />}>
          Register device
        </Button>
      ) : (
        <Button variant="primary" onClick={goNext}>
          Next <ChevronRight className="-mr-1 h-4 w-4" />
        </Button>
      )}
    </>
  ) : created ? (
    <Button variant="primary" onClick={onClose}>
      Done
    </Button>
  ) : formTab ? (
    <>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" type="submit" form="device-form" loading={save.isPending}>
        Save changes
      </Button>
    </>
  ) : undefined

  return (
    <Drawer open onClose={onClose} title={title} subtitle={subtitle} wide footer={footer}>
      {wizard ? (
        <ol className="-mt-1 mb-4 flex items-center gap-1" aria-label="Steps">
          {[...FORM_STEPS, 'review' as const].map((s, i) => {
            const idx = step === 'review' ? 4 : FORM_STEPS.indexOf(step)
            const done = i < idx
            const on = s === step
            return (
              <li key={s} className="flex flex-1 items-center gap-1">
                <button
                  type="button"
                  disabled={i > idx}
                  onClick={() => setStep(s)}
                  className={cn(
                    'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-1 py-1 text-[11px] font-medium transition-colors disabled:cursor-default',
                    on ? 'text-navy-800 dark:text-white' : done ? 'text-slate-600 hover:text-slate-900 dark:text-slate-300' : 'text-slate-400',
                  )}
                  aria-current={on ? 'step' : undefined}
                >
                  <span
                    className={cn(
                      'grid h-7 w-7 place-items-center rounded-full text-[12px] [&>svg]:h-3.5 [&>svg]:w-3.5',
                      on ? 'bg-brand-500 text-navy-900' : done ? 'bg-navy-700 text-white dark:bg-brand-500/30 dark:text-brand-100' : 'bg-slate-100 text-slate-400 dark:bg-white/[0.06]',
                    )}
                  >
                    {done ? <Check /> : STEP_META[s].icon}
                  </span>
                  <span className="truncate">{STEP_META[s].label}</span>
                </button>
                {i < 4 && <span className={cn('mb-4 h-px w-3 shrink-0', done ? 'bg-navy-600 dark:bg-brand-500/50' : 'bg-slate-200 dark:bg-white/10')} />}
              </li>
            )
          })}
        </ol>
      ) : (
        <Tabs<EditorTab>
          className="-mt-3 mb-4"
          value={tab}
          onChange={setTab}
          tabs={(created ? (['sensors', 'params'] as const) : (['tracker', 'vehicle', 'owner', 'driver', 'sensors', 'params'] as const)).map((t) => ({
            id: t,
            label: STEP_META[t].label,
            count: t === 'sensors' ? device?.sensors?.length || undefined : undefined,
            alert: (FORM_STEPS as readonly string[]).includes(t) && touched.size > 0 && stepErrors(t as FormStep).length > 0,
          }))}
        />
      )}
      {created && tab === 'sensors' && (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12.5px] text-emerald-800 dark:text-emerald-200">
          Registered. Point the tracker at this server and its data appears under Parameters. Add fuel or temperature sensors here, or press Done.
        </div>
      )}
      {serverError && (
        <div role="alert" className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-700 dark:text-rose-300">
          {serverError}
        </div>
      )}
      {current === 'sensors' && device ? (
        <Suspense fallback={<Skeleton className="h-40 rounded-xl" />}>
          <SensorsPanel device={device} canEdit={canManage} />
        </Suspense>
      ) : current === 'params' && device ? (
        <ParamsTable device={device} />
      ) : (
        <form id="device-form" onSubmit={submit} className="space-y-4" noValidate>
          {current === 'tracker' && (
            <>
              <Field label="Vehicle name" required error={show('name')} hint="Shown on the map and in reports">
                {(id, d) => <Input id={id} aria-describedby={d} data-autofocus value={v.name} invalid={!!show('name')} placeholder="Truck 07" onChange={(e) => set('name', e.target.value)} />}
              </Field>
              {bridged ? (
                <Field label="Traccar unique ID" required error={show('imei')} hint="Matches the device’s identifier in Traccar">
                  {(id, d) => <Input id={id} aria-describedby={d} autoComplete="off" className="font-mono" value={v.imei} invalid={!!show('imei')} onChange={(e) => set('imei', e.target.value)} />}
                </Field>
              ) : (
                <Field label="IMEI" required error={show('imei')} hint="15 digits, printed on the tracker label">
                  {(id, d) => (
                    <Input
                      id={id}
                      aria-describedby={d}
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={15}
                      className="font-mono"
                      value={v.imei}
                      invalid={!!show('imei')}
                      placeholder="356307042441013"
                      onChange={(e) => set('imei', e.target.value.replace(/\D/g, ''))}
                      trailing={<span className="tabular pr-1.5 text-[11px] text-slate-400">{v.imei.length}/15</span>}
                    />
                  )}
                </Field>
              )}
              <Grid>
                <Field label="Protocol">
                  {(id) => (
                    <Select id={id} value={v.protocol} onChange={(e) => set('protocol', e.target.value)} disabled={bridged}>
                      {(bridged ? [v.protocol] : PROTOCOLS).map((p) => (
                        <option key={p} value={p}>
                          {p[0].toUpperCase() + p.slice(1)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Tracker model">{(id) => <Input id={id} value={v.model} placeholder="FMB920" onChange={(e) => set('model', e.target.value)} />}</Field>
              </Grid>
              <SectionTitle hint="Used for SMS commands and billing">SIM card</SectionTitle>
              <Grid>
                <Field label="SIM phone number" error={show('phone')}>
                  {(id, d) => <Input id={id} aria-describedby={d} type="tel" value={v.phone} invalid={!!show('phone')} placeholder="+252 63 …" onChange={(e) => set('phone', e.target.value)} />}
                </Field>
                <Field label="Operator">{(id) => <Input id={id} value={v.details.sim.operator} placeholder="Somtel" onChange={(e) => setDet('sim', { operator: e.target.value })} />}</Field>
              </Grid>
              <Field label="ICCID" error={show('iccid')} hint="The long number on the SIM card">
                {(id, d) => (
                  <Input id={id} aria-describedby={d} inputMode="numeric" className="font-mono" value={v.details.sim.iccid} invalid={!!show('iccid')} placeholder="8925…" onChange={(e) => setDet('sim', { iccid: e.target.value.replace(/[^\dFf\s]/g, '').slice(0, 26) })} />
                )}
              </Field>
              <SectionTitle>Installation & service</SectionTitle>
              <Grid>
                <Field label="Installed on">{(id) => <Input id={id} type="date" className={dateCls} value={v.details.sim.installDate} onChange={(e) => setDet('sim', { installDate: e.target.value })} />}</Field>
                <Field label="Installed by">{(id) => <Input id={id} value={v.details.sim.installer} placeholder="Technician" onChange={(e) => setDet('sim', { installer: e.target.value })} />}</Field>
              </Grid>
              <Field label="Subscription expires" hint="Tracking service renewal date">
                {(id, d) => <Input id={id} aria-describedby={d} type="date" className={dateCls} value={v.details.sim.subscriptionExpiry} onChange={(e) => setDet('sim', { subscriptionExpiry: e.target.value })} />}
              </Field>
              {device && (
                <div className="flex items-center justify-between rounded-lg border border-slate-200/80 px-3 py-2 text-[12.5px] dark:border-white/[0.06]">
                  <span className="text-slate-500 dark:text-slate-400">Connection</span>
                  <SourceBadge source={device.source} />
                </div>
              )}
            </>
          )}

          {current === 'vehicle' && (
            <>
              <div className="space-y-1.5">
                <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Map icon</span>
                <div role="radiogroup" aria-label="Map icon" className="grid grid-cols-6 gap-1.5 sm:grid-cols-9">
                  {([['', { label: 'Arrow', icon: Navigation }], ...Object.entries(DEVICE_ICON_META)] as Array<[string, { label: string; icon: typeof Navigation }]>).map(([k, m]) => {
                    const on = v.icon === k
                    return (
                      <button
                        key={k || 'arrow'}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        title={m.label}
                        onClick={() =>
                          setV((s) => ({
                            ...s,
                            icon: k as DeviceIcon | '',
                            // the icon names a category (truck, bus…): keep them in step
                            category: (DEVICE_CATEGORIES as readonly string[]).includes(k) ? k : s.category,
                          }))
                        }
                        className={cn(
                          'flex flex-col items-center gap-0.5 rounded-lg border px-0.5 py-1.5 text-[10px] font-medium transition-colors',
                          on ? 'border-brand-500 bg-brand-500/10 text-navy-800 dark:text-brand-100' : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-white/10 dark:text-slate-400 dark:hover:border-white/20',
                        )}
                      >
                        <span className={cn('grid h-7 w-7 place-items-center rounded-full', on ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300')}>
                          <m.icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="w-full truncate text-center">{m.label}</span>
                      </button>
                    )
                  })}
                </div>
                <p className="text-[11.5px] text-slate-500 dark:text-slate-400">The marker colour still shows the status (moving, idle, stopped, offline).</p>
              </div>
              <Grid>
                <Field label="Category">
                  {(id) => (
                    <Select id={id} value={v.category} onChange={(e) => set('category', e.target.value)}>
                      {DEVICE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {categoryMeta(c).label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Plate">{(id) => <Input id={id} value={v.plate} placeholder="SL 12345" onChange={(e) => set('plate', e.target.value.toUpperCase())} />}</Field>
              </Grid>
              <Grid cols={3}>
                <Field label="Make">{(id) => <Input id={id} value={v.details.vehicle.make} placeholder="Toyota" onChange={(e) => setDet('vehicle', { make: e.target.value })} />}</Field>
                <Field label="Model">{(id) => <Input id={id} value={v.details.vehicle.model} placeholder="Hilux" onChange={(e) => setDet('vehicle', { model: e.target.value })} />}</Field>
                <Field label="Year" error={show('year')}>
                  {(id, d) => <Input id={id} aria-describedby={d} inputMode="numeric" value={v.year} invalid={!!show('year')} placeholder="2020" onChange={(e) => set('year', e.target.value.replace(/\D/g, '').slice(0, 4))} />}
                </Field>
              </Grid>
              <Grid>
                <Field label="Colour">{(id) => <Input id={id} value={v.details.vehicle.color} placeholder="White" onChange={(e) => setDet('vehicle', { color: e.target.value })} />}</Field>
                <Field label="Fuel type">
                  {(id) => (
                    <Select id={id} value={v.details.vehicle.fuelType} onChange={(e) => setDet('vehicle', { fuelType: e.target.value })}>
                      <option value="">—</option>
                      {FUEL_TYPES.map((f) => (
                        <option key={f} value={f}>
                          {f === 'lpg' || f === 'cng' ? f.toUpperCase() : f[0].toUpperCase() + f.slice(1)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </Grid>
              <Grid>
                <Field label="VIN / chassis" error={show('vin')}>
                  {(id, d) => <Input id={id} aria-describedby={d} className="font-mono" maxLength={17} value={v.details.vehicle.vin} invalid={!!show('vin')} onChange={(e) => setDet('vehicle', { vin: e.target.value.toUpperCase().replace(/\s/g, '') })} />}
                </Field>
                <Field label="Engine number">{(id) => <Input id={id} className="font-mono" value={v.details.vehicle.engineNumber} onChange={(e) => setDet('vehicle', { engineNumber: e.target.value })} />}</Field>
              </Grid>
              <Field label="Speed limit" error={show('speedLimit')} hint={`Overspeed alerts above this. Empty = fleet default${defaultLimit ? ` (${defaultLimit} km/h)` : ''}.`}>
                {(id, d) => (
                  <Input
                    id={id}
                    aria-describedby={d}
                    inputMode="numeric"
                    value={v.speedLimit}
                    invalid={!!show('speedLimit')}
                    placeholder={defaultLimit ? String(defaultLimit) : 'Default'}
                    onChange={(e) => set('speedLimit', e.target.value.replace(/\D/g, '').slice(0, 3))}
                    trailing={<span className="pr-1.5 text-[11px] text-slate-400">km/h</span>}
                  />
                )}
              </Field>
              <SectionTitle hint="Match the vehicle’s dashboard — maintenance schedules use these">Counters</SectionTitle>
              <Grid>
                <Field label="Odometer" error={show('odometer')}>
                  {(id, d) => <Input id={id} aria-describedby={d} inputMode="decimal" value={v.odometer} invalid={!!show('odometer')} placeholder="0" onChange={(e) => set('odometer', e.target.value.replace(/[^\d.]/g, ''))} trailing={<span className="pr-1.5 text-[11px] text-slate-400">km</span>} />}
                </Field>
                <Field label="Engine hours" error={show('engineHours')}>
                  {(id, d) => <Input id={id} aria-describedby={d} inputMode="decimal" value={v.engineHours} invalid={!!show('engineHours')} placeholder="0" onChange={(e) => set('engineHours', e.target.value.replace(/[^\d.]/g, ''))} trailing={<span className="pr-1.5 text-[11px] text-slate-400">h</span>} />}
                </Field>
              </Grid>
            </>
          )}

          {current === 'owner' && (
            <>
              <Grid>
                <Field label="Owner name">{(id) => <Input id={id} value={v.details.owner.name} placeholder="Ahmed Ali" onChange={(e) => setDet('owner', { name: e.target.value })} />}</Field>
                <Field label="Company">{(id) => <Input id={id} value={v.details.owner.company} placeholder="Optional" onChange={(e) => setDet('owner', { company: e.target.value })} />}</Field>
              </Grid>
              <Grid>
                <Field label="Phone" error={show('ownerPhone')}>
                  {(id, d) => <Input id={id} aria-describedby={d} type="tel" value={v.details.owner.phone} invalid={!!show('ownerPhone')} placeholder="+252 63 …" onChange={(e) => setDet('owner', { phone: e.target.value })} />}
                </Field>
                <Field label="Email" error={show('ownerEmail')}>
                  {(id, d) => <Input id={id} aria-describedby={d} type="email" value={v.details.owner.email} invalid={!!show('ownerEmail')} placeholder="owner@example.com" onChange={(e) => setDet('owner', { email: e.target.value })} />}
                </Field>
              </Grid>
              <Field label="ID / passport number">{(id) => <Input id={id} value={v.details.owner.idNumber} onChange={(e) => setDet('owner', { idNumber: e.target.value })} />}</Field>
              <Field label="Address">{(id) => <Textarea id={id} rows={2} value={v.details.owner.address} placeholder="District, city" onChange={(e) => setDet('owner', { address: e.target.value })} />}</Field>
              <Field label="Notes">{(id) => <Textarea id={id} rows={3} value={v.details.notes} placeholder="Contract, payment terms, anything else…" onChange={(e) => setDet('notes', e.target.value)} />}</Field>
            </>
          )}

          {current === 'driver' && (
            <>
              <div className="space-y-1.5">
                <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Driver</span>
                <Segmented<DriverMode>
                  label="Driver"
                  value={v.driverMode}
                  onChange={(m) => set('driverMode', m)}
                  options={[
                    { id: 'none', label: 'No driver' },
                    { id: 'existing', label: 'Existing driver' },
                    { id: 'new', label: 'New driver' },
                  ]}
                />
              </div>
              {v.driverMode === 'existing' && (
                <Field label="Assigned driver" error={show('driverId')} hint="A driver can drive one vehicle at a time; assigning moves them here.">
                  {(id, d) => (
                    <Select id={id} aria-describedby={d} value={v.driverId} invalid={!!show('driverId')} onChange={(e) => set('driverId', e.target.value)}>
                      <option value="">Select a driver…</option>
                      {drivers.data?.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                          {x.deviceId != null && x.deviceId !== device?.id ? ` (now on ${useLive.getState().byId[x.deviceId]?.name ?? 'another vehicle'})` : ''}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              {v.driverMode === 'new' && (
                <>
                  <Field label="Driver name" required error={show('newDriverName')}>
                    {(id, d) => <Input id={id} aria-describedby={d} value={v.newDriver.name} invalid={!!show('newDriverName')} placeholder="Mohamed Hassan" onChange={(e) => set('newDriver', { ...v.newDriver, name: e.target.value })} />}
                  </Field>
                  <Grid>
                    <Field label="Phone">{(id) => <Input id={id} type="tel" value={v.newDriver.phone} onChange={(e) => set('newDriver', { ...v.newDriver, phone: e.target.value })} />}</Field>
                    <Field label="Licence number">{(id) => <Input id={id} value={v.newDriver.licenseNumber} onChange={(e) => set('newDriver', { ...v.newDriver, licenseNumber: e.target.value })} />}</Field>
                  </Grid>
                  <p className="text-[11.5px] text-slate-500 dark:text-slate-400">More details (iButton tag, licence expiry, driver app login) on the Drivers page.</p>
                </>
              )}
              {isAdmin && (
                <div className="space-y-1.5">
                  <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Groups</span>
                  {groups.data?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {groups.data.map((g) => {
                        const on = v.groupIds.includes(g.id)
                        return (
                          <button
                            key={g.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() => set('groupIds', on ? v.groupIds.filter((x) => x !== g.id) : [...v.groupIds, g.id])}
                            className={cn('rounded-full ring-2 transition', on ? 'ring-brand-500' : 'opacity-60 ring-transparent hover:opacity-100')}
                          >
                            <GroupChip name={g.name} color={g.color} />
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="text-[12px] text-slate-500 dark:text-slate-400">No groups yet — create them under Users & Groups.</p>
                  )}
                </div>
              )}
            </>
          )}

          {current === 'review' && <Review v={v} driverName={v.driverMode === 'existing' ? drivers.data?.find((d) => String(d.id) === v.driverId)?.name : v.newDriver.name} onEdit={setStep} />}
        </form>
      )}
    </Drawer>
  )
}

function Review({ v, driverName, onEdit }: { v: V; driverName?: string; onEdit: (s: FormStep) => void }) {
  const d = v.details
  const IconComp = v.icon ? DEVICE_ICON_META[v.icon].icon : CircleDot
  const join = (...xs: Array<string | number | undefined>) => xs.filter(Boolean).join(' · ') || '—'
  const rows: Array<[FormStep, string, Array<[string, string]>]> = [
    ['tracker', 'Tracker', [['Name', v.name], ['IMEI', v.imei], ['Model', join(v.protocol, v.model)], ['SIM', join(v.phone, d.sim.operator, d.sim.iccid)], ['Installed', join(d.sim.installDate, d.sim.installer)], ['Subscription', d.sim.subscriptionExpiry || '—']]],
    ['vehicle', 'Vehicle', [['Vehicle', join(d.vehicle.make, d.vehicle.model, v.year)], ['Plate', v.plate || '—'], ['Category', categoryMeta(v.category).label], ['VIN', d.vehicle.vin || '—'], ['Fuel', d.vehicle.fuelType ? (d.vehicle.fuelType.length <= 3 ? d.vehicle.fuelType.toUpperCase() : d.vehicle.fuelType[0].toUpperCase() + d.vehicle.fuelType.slice(1)) : '—']]],
    ['owner', 'Owner', [['Owner', join(d.owner.name, d.owner.company)], ['Contact', join(d.owner.phone, d.owner.email)]]],
    ['driver', 'Driver', [['Driver', v.driverMode === 'none' ? 'None' : `${driverName || '—'}${v.driverMode === 'new' ? ' (new)' : ''}`]]],
  ]
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-xl border border-slate-200/80 p-3 dark:border-white/[0.07]">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-emerald-500 text-white ring-4 ring-white shadow dark:ring-ink-900">
          {v.icon ? <IconComp className="h-5 w-5" /> : <Navigation className="h-5 w-5" />}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900 dark:text-white">{v.name || 'Unnamed'}</p>
          <p className="truncate text-[12px] text-slate-500 dark:text-slate-400">{join(v.plate, d.vehicle.make, d.owner.name)}</p>
        </div>
      </div>
      {rows.map(([step, title, items]) => (
        <div key={step} className="rounded-lg border border-slate-200/80 dark:border-white/[0.07]">
          <div className="flex items-center justify-between px-3 pt-2">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</span>
            <button type="button" className="text-[12px] font-medium text-navy-700 hover:underline dark:text-brand-300" onClick={() => onEdit(step)}>
              Edit
            </button>
          </div>
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 px-3 pb-2.5 pt-1 text-[12.5px]">
            {items.map(([k, val]) => (
              <div key={k} className="contents">
                <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
                <dd className="truncate text-right text-slate-900 dark:text-white">{val}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      <p className="text-[12px] text-slate-500 dark:text-slate-400">Next: sensors (fuel, temperature) and the live parameters table.</p>
    </div>
  )
}
