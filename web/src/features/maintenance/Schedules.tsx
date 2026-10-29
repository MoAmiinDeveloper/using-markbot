import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarDays,
  CheckCheck,
  Clock3,
  EllipsisVertical,
  Gauge,
  History,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  Wrench,
} from 'lucide-react'
import { api, ApiError, qk } from '@/api/client'
import type { DueStatus, Maintenance, MaintenanceInput } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Input'
import { Drawer, Modal } from '@/components/ui/Modal'
import { EmptyState, Skeleton } from '@/components/ui/Misc'
import { DUE_META, DueStatusPill } from '@/components/ui/Badges'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { Segmented } from '@/components/ui/Tabs'
import { useCurrency } from '@/features/common/queries'
import { useAccess } from '@/lib/access'
import { useDeviceList, useLive } from '@/store/live'
import { toast } from '@/store/toast'
import { CategoryIcon } from '@/lib/category'
import { daysUntil, fmtDate, fmtHours, fmtKm, fmtMoney, todayISO } from '@/lib/format'
import { cn } from '@/lib/cn'

const ORDER: Record<DueStatus, number> = { overdue: 0, dueSoon: 1, ok: 2 }
const SUGGESTIONS = ['Oil change', 'Tyre rotation', 'Brake inspection', 'Air filter', 'Annual service', 'Gearbox oil', 'Coolant flush', 'Battery check']

/** One interval (km / days / hours) as a progress bar: how much of the interval is used up. */
function IntervalBar({
  icon,
  label,
  interval,
  remaining,
  fmt,
  due,
  warnAt,
}: {
  icon: React.ReactNode
  label: string
  interval: number
  remaining: number | null
  fmt: (n: number) => string
  due: string
  warnAt: number
}) {
  const rem = remaining ?? interval
  const used = Math.min(1, Math.max(0, (interval - rem) / interval))
  const status: DueStatus = rem < 0 ? 'overdue' : rem <= warnAt ? 'dueSoon' : 'ok'
  const m = DUE_META[status]
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400 [&>svg]:h-3.5 [&>svg]:w-3.5">
          {icon}
          {label}
        </span>
        <span className={cn('tabular font-semibold', status === 'ok' ? 'text-slate-900 dark:text-white' : status === 'dueSoon' ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400')}>
          {rem < 0 ? `${fmt(-rem)} overdue` : `${fmt(rem)} left`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.07]" role="progressbar" aria-valuenow={Math.round(used * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${label} used`}>
        <div className={cn('h-full rounded-full transition-all duration-700', m.bar)} style={{ width: `${Math.max(4, used * 100)}%` }} />
      </div>
      <div className="mt-1 text-[11px] text-slate-400">{due}</div>
    </div>
  )
}

function ScheduleCard({
  m,
  canEdit,
  onDone,
  onHistory,
  onEdit,
  onDelete,
}: {
  m: Maintenance
  canEdit: boolean
  onDone: () => void
  onHistory: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const dev = useLive((s) => s.byId[m.deviceId])
  return (
    <article
      className={cn(
        'card flex flex-col overflow-hidden',
        m.status === 'overdue' && 'ring-1 ring-rose-500/30',
        m.status === 'dueSoon' && 'ring-1 ring-amber-500/25',
      )}
    >
      <div className="flex items-start gap-3 px-4 pb-3 pt-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `${DUE_META[m.status].color}1f`, color: DUE_META[m.status].color }}>
          <Wrench className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-semibold text-slate-900 dark:text-white">{m.name}</h3>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-slate-500 dark:text-slate-400">
            {dev && <CategoryIcon category={dev.category} icon={dev.icon} className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{dev?.name ?? `Vehicle #${m.deviceId}`}</span>
            {dev?.plate && <span className="shrink-0 text-slate-400">· {dev.plate}</span>}
          </p>
        </div>
        <DueStatusPill status={m.status} />
      </div>
      <div className="space-y-3 px-4 pb-3">
        {m.intervalKm > 0 && (
          <IntervalBar
            icon={<Gauge />}
            label={`Every ${m.intervalKm.toLocaleString()} km`}
            interval={m.intervalKm}
            remaining={m.remainingKm}
            fmt={(n) => fmtKm(n)}
            due={m.nextDueKm != null ? `Due at ${fmtKm(m.nextDueKm)}` : ''}
            warnAt={m.notifyBeforeKm}
          />
        )}
        {m.intervalDays > 0 && (
          <IntervalBar
            icon={<CalendarDays />}
            label={`Every ${m.intervalDays} days`}
            interval={m.intervalDays}
            remaining={m.remainingDays ?? daysUntil(m.nextDueDate)}
            fmt={(n) => `${Math.round(n)} day${Math.round(n) === 1 ? '' : 's'}`}
            due={m.nextDueDate ? `Due ${fmtDate(m.nextDueDate)}` : ''}
            warnAt={m.notifyBeforeDays}
          />
        )}
        {m.intervalHours > 0 && (
          <IntervalBar
            icon={<Clock3 />}
            label={`Every ${m.intervalHours.toLocaleString()} engine h`}
            interval={m.intervalHours}
            remaining={m.remainingHours}
            fmt={(n) => fmtHours(n)}
            due={m.nextDueHours != null ? `Due at ${fmtHours(m.nextDueHours)}` : ''}
            warnAt={m.notifyBeforeHours}
          />
        )}
      </div>
      <div className="mt-auto flex items-center gap-2 border-t border-slate-100 px-4 py-2.5 dark:border-white/[0.05]">
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-slate-500 dark:text-slate-400">
          Last service {m.lastServiceDate ? fmtDate(m.lastServiceDate) : '—'}
        </span>
        {canEdit && (
          <Button size="sm" variant={m.status === 'ok' ? 'secondary' : 'primary'} icon={<CheckCheck className="h-3.5 w-3.5" />} onClick={onDone}>
            Mark as done
          </Button>
        )}
        <Menu
          className="w-52"
          trigger={({ toggle, open }) => (
            <button
              type="button"
              aria-label={`More actions for ${m.name}`}
              aria-expanded={open}
              onClick={toggle}
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/[0.07] dark:hover:text-white"
            >
              <EllipsisVertical className="h-4 w-4" />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem icon={<History className="text-slate-400" />} title="Service history" onClick={() => (close(), onHistory())} />
              {canEdit && <MenuItem icon={<Pencil className="text-slate-400" />} title="Edit schedule" onClick={() => (close(), onEdit())} />}
              {canEdit && <MenuItem icon={<Trash2 className="text-rose-500" />} title="Delete" onClick={() => (close(), onDelete())} />}
            </>
          )}
        </Menu>
      </div>
    </article>
  )
}

function CompleteDialog({ m, onClose }: { m: Maintenance; onClose: () => void }) {
  const qc = useQueryClient()
  const dev = useLive((s) => s.byId[m.deviceId])
  const currency = useCurrency()
  const [date, setDate] = useState(todayISO())
  const [odo, setOdo] = useState(dev?.odometer != null ? String(Math.round(dev.odometer)) : '')
  const [hours, setHours] = useState(dev?.engineHours != null ? String(Math.round(dev.engineHours * 10) / 10) : '')
  const [cost, setCost] = useState('')
  const [notes, setNotes] = useState('')
  const done = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      api.completeMaintenance(m.id, {
        date,
        odometer: odo ? Number(odo) : undefined,
        engineHours: hours ? Number(hours) : undefined,
        cost: cost ? Number(cost) : undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.maintenance })
      void qc.invalidateQueries({ queryKey: ['maintenanceHistory', m.id] })
      if (cost && Number(cost) > 0) void qc.invalidateQueries({ queryKey: qk.expenses() })
      toast.success(`${m.name} marked as done`, cost && Number(cost) > 0 ? `${fmtMoney(Number(cost), currency)} added to expenses` : 'Schedule reset from this service')
      onClose()
    },
    onError: (e) => toast.error('Could not complete the service', e instanceof ApiError ? e.message : String(e)),
  })
  const costErr = cost && !(Number(cost) >= 0) ? 'Enter an amount' : undefined
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!date || costErr) return
    done.mutate()
  }
  return (
    <Modal
      open
      onClose={() => !done.isPending && onClose()}
      title={`Mark “${m.name}” as done`}
      description={`${dev?.name ?? 'Vehicle'} — this resets the schedule and stores a service record. A cost creates a maintenance expense.`}
      className="max-w-lg"
      footer={
        <>
          <Button onClick={onClose} disabled={done.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="complete-form" loading={done.isPending} icon={<CheckCheck className="h-4 w-4" />}>
            Mark as done
          </Button>
        </>
      }
    >
      <form id="complete-form" onSubmit={submit} className="mt-4 space-y-3" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Service date" required>
            {(id) => <Input id={id} type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} data-autofocus className="dark:[&_input]:[color-scheme:dark]" />}
          </Field>
          <Field label="Cost" error={costErr}>
            {(id) => (
              <Input id={id} inputMode="decimal" value={cost} placeholder="0.00" onChange={(e) => setCost(e.target.value.replace(/[^\d.]/g, ''))} trailing={<span className="pr-1.5 text-[11px] text-slate-400">{currency}</span>} />
            )}
          </Field>
          <Field label="Odometer">
            {(id) => <Input id={id} inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value.replace(/\D/g, ''))} trailing={<span className="pr-1.5 text-[11px] text-slate-400">km</span>} />}
          </Field>
          <Field label="Engine hours">
            {(id) => <Input id={id} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^\d.]/g, ''))} trailing={<span className="pr-1.5 text-[11px] text-slate-400">h</span>} />}
          </Field>
        </div>
        <Field label="Notes">
          {(id) => <Textarea id={id} rows={2} value={notes} placeholder="Workshop, parts replaced…" onChange={(e) => setNotes(e.target.value)} />}
        </Field>
      </form>
    </Modal>
  )
}

function HistoryDrawer({ m, onClose }: { m: Maintenance; onClose: () => void }) {
  const currency = useCurrency()
  const dev = useLive((s) => s.byId[m.deviceId])
  const hist = useQuery({ queryKey: ['maintenanceHistory', m.id], queryFn: () => api.maintenanceHistory(m.id) })
  const list = [...(hist.data ?? [])].sort((a, b) => b.date.localeCompare(a.date))
  const total = list.reduce((s, r) => s + (r.cost ?? 0), 0)
  return (
    <Drawer open onClose={onClose} title="Service history" subtitle={`${m.name} · ${dev?.name ?? `Vehicle #${m.deviceId}`}`}>
      {hist.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={<History className="h-5 w-5" />} title="No services recorded yet" description="Use “Mark as done” after each service to build the history." />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-slate-200/80 px-3 py-2 dark:border-white/[0.07]">
              <div className="text-[11px] text-slate-500">Services</div>
              <div className="tabular text-[16px] font-semibold text-slate-900 dark:text-white">{list.length}</div>
            </div>
            <div className="rounded-xl border border-slate-200/80 px-3 py-2 dark:border-white/[0.07]">
              <div className="text-[11px] text-slate-500">Total cost</div>
              <div className="tabular text-[16px] font-semibold text-slate-900 dark:text-white">{fmtMoney(total, currency)}</div>
            </div>
          </div>
          <ol className="relative space-y-3 border-l-2 border-slate-200 pl-4 dark:border-white/10">
            {list.map((r) => (
              <li key={r.id} className="relative">
                <span className="absolute -left-[23px] top-1 h-3 w-3 rounded-full border-2 border-white bg-brand-500 dark:border-ink-900" />
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-900 dark:text-white">{fmtDate(r.date)}</span>
                  <span className="tabular text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">{r.cost ? fmtMoney(r.cost, currency) : ''}</span>
                </div>
                <div className="tabular mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
                  {[r.odometer != null ? fmtKm(r.odometer) : null, r.engineHours != null ? fmtHours(r.engineHours) : null].filter(Boolean).join(' · ') || '—'}
                </div>
                {r.notes && <p className="mt-1 text-[12.5px] text-slate-600 dark:text-slate-300">{r.notes}</p>}
              </li>
            ))}
          </ol>
        </>
      )}
    </Drawer>
  )
}

type FormV = Record<keyof MaintenanceInput, string>

function toForm(m: Maintenance | null, deviceId?: number): FormV {
  const s = (n: number | undefined | null) => (n ? String(n) : '')
  return {
    deviceId: m ? String(m.deviceId) : deviceId ? String(deviceId) : '',
    name: m?.name ?? '',
    intervalKm: s(m?.intervalKm ?? 10000),
    intervalDays: s(m?.intervalDays ?? 180),
    intervalHours: s(m?.intervalHours),
    lastServiceDate: m?.lastServiceDate ?? todayISO(),
    lastServiceKm: s(m?.lastServiceKm),
    lastServiceHours: s(m?.lastServiceHours),
    notifyBeforeKm: s(m?.notifyBeforeKm ?? 500),
    notifyBeforeDays: s(m?.notifyBeforeDays ?? 7),
    notifyBeforeHours: s(m?.notifyBeforeHours ?? 10),
  }
}

function ScheduleForm({ initial, defaultDevice, onClose }: { initial: Maintenance | null; defaultDevice?: number; onClose: () => void }) {
  const qc = useQueryClient()
  const { canManageDevice } = useAccess()
  const devices = useDeviceList().filter((d) => canManageDevice(d))
  const [v, setV] = useState<FormV>(() => toForm(initial, defaultDevice))
  const [touched, setTouched] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const set = (k: keyof FormV, val: string) => setV((s) => ({ ...s, [k]: val }))
  const n = (k: keyof FormV) => (v[k] ? Number(v[k]) : 0)
  const errors: Partial<Record<keyof FormV | 'interval', string>> = {}
  if (!v.deviceId) errors.deviceId = 'Choose a vehicle'
  if (!v.name.trim()) errors.name = 'Name the service'
  if (!n('intervalKm') && !n('intervalDays') && !n('intervalHours')) errors.interval = 'Set at least one interval'
  const show = (k: keyof typeof errors) => (touched ? errors[k] : undefined)

  const save = useMutation({
    meta: { silent: true },
    mutationFn: () => {
      const input: MaintenanceInput = {
        deviceId: Number(v.deviceId),
        name: v.name.trim(),
        intervalKm: n('intervalKm'),
        intervalDays: n('intervalDays'),
        intervalHours: n('intervalHours'),
        lastServiceDate: v.lastServiceDate,
        lastServiceKm: n('lastServiceKm'),
        lastServiceHours: n('lastServiceHours'),
        notifyBeforeKm: n('notifyBeforeKm'),
        notifyBeforeDays: n('notifyBeforeDays'),
        notifyBeforeHours: n('notifyBeforeHours'),
      }
      return initial ? api.updateMaintenance(initial.id, input) : api.createMaintenance(input)
    },
    onSuccess: (m) => {
      void qc.invalidateQueries({ queryKey: qk.maintenance })
      toast.success(initial ? 'Schedule saved' : 'Schedule added', m.name)
      onClose()
    },
    onError: (e) => setServerError(e instanceof ApiError ? e.message : 'Could not save the schedule'),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    setServerError(null)
    if (Object.keys(errors).length) return
    save.mutate()
  }
  const numIn = (k: keyof FormV, unit: string, label: string) => (
    <Input
      aria-label={label}
      inputMode="numeric"
      value={v[k]}
      placeholder="—"
      onChange={(e) => set(k, e.target.value.replace(/[^\d.]/g, ''))}
      trailing={<span className="pr-1.5 text-[11px] text-slate-400">{unit}</span>}
    />
  )
  const dev = devices.find((d) => d.id === Number(v.deviceId))

  return (
    <Drawer
      open
      onClose={onClose}
      title={initial ? 'Edit service schedule' : 'New service schedule'}
      subtitle="Due when any of the intervals is reached"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="schedule-form" loading={save.isPending}>
            {initial ? 'Save changes' : 'Add schedule'}
          </Button>
        </>
      }
    >
      <form id="schedule-form" onSubmit={submit} className="space-y-4" noValidate>
        {serverError && (
          <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-700 dark:text-rose-300">
            {serverError}
          </div>
        )}
        <Field label="Vehicle" required error={show('deviceId')}>
          {(id, d) => (
            <Select id={id} aria-describedby={d} value={v.deviceId} invalid={!!show('deviceId')} onChange={(e) => set('deviceId', e.target.value)}>
              <option value="">Select a vehicle…</option>
              {devices.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {x.plate ? ` · ${x.plate}` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Service" required error={show('name')}>
          {(id, d) => (
            <>
              <Input id={id} aria-describedby={d} list="svc-suggestions" value={v.name} invalid={!!show('name')} placeholder="Oil change" onChange={(e) => set('name', e.target.value)} />
              <datalist id="svc-suggestions">
                {SUGGESTIONS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Interval & early warning</span>
            <span className="text-[11.5px] text-slate-400">leave empty if unused</span>
          </div>
          <div className={cn('overflow-hidden rounded-xl border', show('interval') ? 'border-rose-400' : 'border-slate-200/80 dark:border-white/[0.08]')}>
            <div className="grid grid-cols-[72px_1fr_1fr] items-center gap-2 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-500 dark:bg-white/[0.03] dark:text-slate-400">
              <span />
              <span>Every</span>
              <span>Warn before</span>
            </div>
            {(
              [
                ['Distance', 'intervalKm', 'notifyBeforeKm', 'km'],
                ['Time', 'intervalDays', 'notifyBeforeDays', 'days'],
                ['Engine', 'intervalHours', 'notifyBeforeHours', 'h'],
              ] as const
            ).map(([label, a, b, unit]) => (
              <div key={a} className="grid grid-cols-[72px_1fr_1fr] items-center gap-2 border-t border-slate-100 px-3 py-2 dark:border-white/[0.05]">
                <span className="text-[12.5px] text-slate-600 dark:text-slate-300">{label}</span>
                {numIn(a, unit, `${label} interval`)}
                {numIn(b, unit, `${label} warning`)}
              </div>
            ))}
          </div>
          {show('interval') && <p className="text-[12px] text-rose-500">{show('interval')}</p>}
        </div>
        <div className="space-y-2">
          <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Last service</span>
          <div className="grid grid-cols-3 gap-2">
            <Input aria-label="Last service date" type="date" value={v.lastServiceDate} max={todayISO()} onChange={(e) => set('lastServiceDate', e.target.value)} className="dark:[&_input]:[color-scheme:dark] [&_input]:px-2 [&_input]:text-[12px]" />
            {numIn('lastServiceKm', 'km', 'Odometer at last service')}
            {numIn('lastServiceHours', 'h', 'Engine hours at last service')}
          </div>
          {dev && (
            <p className="text-[11.5px] text-slate-500 dark:text-slate-400">
              {dev.name} now: {fmtKm(dev.odometer)} · {fmtHours(dev.engineHours)}{' '}
              <button
                type="button"
                className="font-medium text-navy-600 hover:underline dark:text-brand-300"
                onClick={() =>
                  setV((s) => ({
                    ...s,
                    lastServiceDate: todayISO(),
                    lastServiceKm: dev.odometer != null ? String(Math.round(dev.odometer)) : s.lastServiceKm,
                    lastServiceHours: dev.engineHours != null ? String(Math.round(dev.engineHours)) : s.lastServiceHours,
                  }))
                }
              >
                Use current values
              </button>
            </p>
          )}
        </div>
      </form>
    </Drawer>
  )
}

export function SchedulesTab({ deviceFilter, setDeviceFilter }: { deviceFilter: number | null; setDeviceFilter: (id: number | null) => void }) {
  const qc = useQueryClient()
  const { canManage, canManageDevice } = useAccess()
  const devices = useDeviceList()
  const byId = useLive((s) => s.byId)
  const q = useQuery({ queryKey: qk.maintenance, queryFn: () => api.maintenance() })
  const [status, setStatus] = useState<DueStatus | 'all'>('all')
  const [completing, setCompleting] = useState<Maintenance | null>(null)
  const [history, setHistory] = useState<Maintenance | null>(null)
  const [editing, setEditing] = useState<Maintenance | null | 'new'>(null)
  const [deleting, setDeleting] = useState<Maintenance | null>(null)

  const all = useMemo(() => q.data ?? [], [q.data])
  const counts = useMemo(() => {
    const c = { all: 0, ok: 0, dueSoon: 0, overdue: 0 }
    for (const m of all) if (deviceFilter == null || m.deviceId === deviceFilter) (c.all++, c[m.status]++)
    return c
  }, [all, deviceFilter])
  const rows = useMemo(
    () =>
      all
        .filter((m) => (deviceFilter == null || m.deviceId === deviceFilter) && (status === 'all' || m.status === status))
        .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.remainingDays ?? 1e9) - (b.remainingDays ?? 1e9)),
    [all, deviceFilter, status],
  )

  const del = useMutation({
    mutationFn: (m: Maintenance) => api.deleteMaintenance(m.id),
    onSuccess: (_, m) => {
      qc.setQueryData<Maintenance[]>(qk.maintenance, (l) => l?.filter((x) => x.id !== m.id))
      toast.success('Schedule deleted', m.name)
      setDeleting(null)
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select aria-label="Vehicle" value={deviceFilter ?? ''} onChange={(e) => setDeviceFilter(e.target.value ? Number(e.target.value) : null)} className="sm:w-60">
          <option value="">All vehicles</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <Segmented<DueStatus | 'all'>
          label="Status"
          value={status}
          onChange={setStatus}
          className="overflow-x-auto"
          options={[
            { id: 'all', label: `All ${counts.all}` },
            { id: 'overdue', label: <span className={cn(counts.overdue && 'text-rose-600 dark:text-rose-400')}>Overdue {counts.overdue}</span> },
            { id: 'dueSoon', label: <span className={cn(counts.dueSoon && 'text-amber-600 dark:text-amber-400')}>Due soon {counts.dueSoon}</span> },
            { id: 'ok', label: `OK ${counts.ok}` },
          ]}
        />
        {canManage && (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')} className="sm:ml-auto">
            New schedule
          </Button>
        )}
      </div>

      {q.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[230px] rounded-2xl" />
          ))}
        </div>
      ) : q.isError ? (
        <div className="card">
          <EmptyState icon={<TriangleAlert className="h-5 w-5" />} title="Couldn’t load maintenance" action={<Button onClick={() => void q.refetch()}>Try again</Button>} />
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Wrench className="h-5 w-5" />}
            title={all.length ? 'Nothing here' : 'No service schedules yet'}
            description={all.length ? 'No schedule matches this filter.' : 'Track oil changes, tyre rotations and inspections by distance, days or engine hours.'}
            action={
              canManage &&
              !all.length && (
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
                  New schedule
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((m) => (
            <ScheduleCard
              key={m.id}
              m={m}
              canEdit={canManageDevice(byId[m.deviceId])}
              onDone={() => setCompleting(m)}
              onHistory={() => setHistory(m)}
              onEdit={() => setEditing(m)}
              onDelete={() => setDeleting(m)}
            />
          ))}
        </div>
      )}

      {completing && <CompleteDialog m={completing} onClose={() => setCompleting(null)} />}
      {history && <HistoryDrawer m={history} onClose={() => setHistory(null)} />}
      {editing && (
        <ScheduleForm
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? null : editing}
          defaultDevice={deviceFilter ?? undefined}
          onClose={() => setEditing(null)}
        />
      )}
      <Modal
        open={!!deleting}
        onClose={() => !del.isPending && setDeleting(null)}
        title={`Delete “${deleting?.name ?? 'schedule'}”?`}
        description="The schedule and its service history are removed. Expenses already recorded are kept."
        footer={
          <>
            <Button onClick={() => setDeleting(null)} disabled={del.isPending} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" loading={del.isPending} icon={<Trash2 className="h-4 w-4" />} onClick={() => deleting && del.mutate(deleting)}>
              Delete
            </Button>
          </>
        }
      />
    </div>
  )
}
