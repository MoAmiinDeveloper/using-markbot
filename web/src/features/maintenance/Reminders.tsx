import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileClock, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { api, ApiError, qk } from '@/api/client'
import { REMINDER_KINDS, type DueStatus, type Reminder, type ReminderInput, type ReminderKind } from '@/api/types'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Input'
import { Drawer, Modal } from '@/components/ui/Modal'
import { EmptyState, Skeleton } from '@/components/ui/Misc'
import { DueStatusPill } from '@/components/ui/Badges'
import { Segmented } from '@/components/ui/Tabs'
import { useDrivers } from '@/features/common/queries'
import { useAccess } from '@/lib/access'
import { reminderMeta, REMINDER_META } from '@/lib/ops'
import { useDeviceList, useLive } from '@/store/live'
import { toast } from '@/store/toast'
import { daysUntil, fmtDate } from '@/lib/format'
import { cn } from '@/lib/cn'

const ORDER: Record<DueStatus, number> = { overdue: 0, dueSoon: 1, ok: 2 }

function DaysLeft({ date }: { date: string }) {
  const d = daysUntil(date)
  if (d == null) return null
  return (
    <span
      className={cn(
        'tabular text-[12px]',
        d < 0 ? 'font-semibold text-rose-600 dark:text-rose-400' : d <= 14 ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400',
      )}
    >
      {d < 0 ? `${-d} day${d === -1 ? '' : 's'} overdue` : d === 0 ? 'Due today' : `in ${d} day${d === 1 ? '' : 's'}`}
    </span>
  )
}

type FormV = { kind: ReminderKind; title: string; subject: 'vehicle' | 'driver'; deviceId: string; driverId: string; dueDate: string; notifyDaysBefore: string; notes: string }

function ReminderForm({ initial, defaultDevice, onClose }: { initial: Reminder | null; defaultDevice?: number; onClose: () => void }) {
  const qc = useQueryClient()
  const { canManageDevice } = useAccess()
  const devices = useDeviceList().filter((d) => canManageDevice(d))
  const drivers = useDrivers()
  const [v, setV] = useState<FormV>(() => ({
    kind: initial?.kind ?? 'insurance',
    title: initial?.title ?? '',
    subject: initial?.driverId != null ? 'driver' : 'vehicle',
    deviceId: initial?.deviceId != null ? String(initial.deviceId) : defaultDevice ? String(defaultDevice) : '',
    driverId: initial?.driverId != null ? String(initial.driverId) : '',
    dueDate: initial?.dueDate ?? '',
    notifyDaysBefore: String(initial?.notifyDaysBefore ?? 14),
    notes: initial?.notes ?? '',
  }))
  const [touched, setTouched] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const set = <K extends keyof FormV>(k: K, val: FormV[K]) => setV((s) => ({ ...s, [k]: val }))
  const errors: Partial<Record<keyof FormV, string>> = {}
  if (!v.title.trim()) errors.title = 'Give it a title'
  if (!v.dueDate) errors.dueDate = 'Pick the due date'
  if (v.subject === 'vehicle' && !v.deviceId) errors.deviceId = 'Choose a vehicle'
  if (v.subject === 'driver' && !v.driverId) errors.driverId = 'Choose a driver'
  const show = (k: keyof FormV) => (touched ? errors[k] : undefined)

  const save = useMutation({
    meta: { silent: true },
    mutationFn: () => {
      const input: ReminderInput = {
        kind: v.kind,
        title: v.title.trim(),
        deviceId: v.subject === 'vehicle' ? Number(v.deviceId) : null,
        driverId: v.subject === 'driver' ? Number(v.driverId) : null,
        dueDate: v.dueDate,
        notifyDaysBefore: Number(v.notifyDaysBefore) || 0,
        notes: v.notes.trim(),
      }
      return initial ? api.updateReminder(initial.id, input) : api.createReminder(input)
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.reminders })
      toast.success(initial ? 'Reminder saved' : 'Reminder added', r.title)
      onClose()
    },
    onError: (e) => setServerError(e instanceof ApiError ? e.message : 'Could not save the reminder'),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    setServerError(null)
    if (Object.keys(errors).length) return
    save.mutate()
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={initial ? 'Edit reminder' : 'New document reminder'}
      subtitle="Insurance, registration, licences, permits…"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="reminder-form" loading={save.isPending}>
            {initial ? 'Save changes' : 'Add reminder'}
          </Button>
        </>
      }
    >
      <form id="reminder-form" onSubmit={submit} className="space-y-4" noValidate>
        {serverError && (
          <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-700 dark:text-rose-300">
            {serverError}
          </div>
        )}
        <div className="space-y-1.5">
          <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Type</span>
          <div role="radiogroup" aria-label="Type" className="grid grid-cols-3 gap-1.5">
            {REMINDER_KINDS.map((k) => {
              const m = REMINDER_META[k]
              const on = v.kind === k
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    set('kind', k)
                    if (!v.title.trim() || Object.values(REMINDER_META).some((x) => `${x.label} renewal` === v.title)) set('title', `${m.label} renewal`)
                  }}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-[11.5px] font-medium transition-colors',
                    on
                      ? 'border-brand-500 bg-brand-500/10 text-navy-800 dark:text-brand-100'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-white/10 dark:text-slate-300 dark:hover:border-white/20',
                  )}
                >
                  <m.icon className="h-4 w-4" style={{ color: m.color }} />
                  {m.label}
                </button>
              )
            })}
          </div>
        </div>
        <Field label="Title" required error={show('title')}>
          {(id, d) => <Input id={id} aria-describedby={d} value={v.title} invalid={!!show('title')} placeholder="Insurance renewal" onChange={(e) => set('title', e.target.value)} />}
        </Field>
        <div className="space-y-1.5">
          <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Applies to</span>
          <Segmented<'vehicle' | 'driver'>
            label="Applies to"
            value={v.subject}
            onChange={(s) => set('subject', s)}
            options={[
              { id: 'vehicle', label: 'A vehicle' },
              { id: 'driver', label: 'A driver' },
            ]}
          />
          {v.subject === 'vehicle' ? (
            <Select aria-label="Vehicle" value={v.deviceId} invalid={!!show('deviceId')} onChange={(e) => set('deviceId', e.target.value)}>
              <option value="">Select a vehicle…</option>
              {devices.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {x.plate ? ` · ${x.plate}` : ''}
                </option>
              ))}
            </Select>
          ) : (
            <Select aria-label="Driver" value={v.driverId} invalid={!!show('driverId')} onChange={(e) => set('driverId', e.target.value)}>
              <option value="">Select a driver…</option>
              {drivers.data?.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          )}
          {(show('deviceId') || show('driverId')) && <p className="text-[12px] text-rose-500">{show('deviceId') || show('driverId')}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due date" required error={show('dueDate')}>
            {(id, d) => (
              <Input id={id} aria-describedby={d} type="date" value={v.dueDate} invalid={!!show('dueDate')} onChange={(e) => set('dueDate', e.target.value)} className="dark:[&_input]:[color-scheme:dark]" />
            )}
          </Field>
          <Field label="Warn before">
            {(id) => (
              <Input id={id} inputMode="numeric" value={v.notifyDaysBefore} onChange={(e) => set('notifyDaysBefore', e.target.value.replace(/\D/g, '').slice(0, 3))} trailing={<span className="pr-1.5 text-[11px] text-slate-400">days</span>} />
            )}
          </Field>
        </div>
        <Field label="Notes">
          {(id) => <Textarea id={id} rows={2} value={v.notes} placeholder="Policy number, agent…" onChange={(e) => set('notes', e.target.value)} />}
        </Field>
      </form>
    </Drawer>
  )
}

export function RemindersTab({ deviceFilter }: { deviceFilter: number | null }) {
  const qc = useQueryClient()
  const { canManage, canManageDevice } = useAccess()
  const byId = useLive((s) => s.byId)
  const drivers = useDrivers()
  const q = useQuery({ queryKey: qk.reminders, queryFn: () => api.reminders() })
  const [status, setStatus] = useState<DueStatus | 'all'>('all')
  const [editing, setEditing] = useState<Reminder | null | 'new'>(null)
  const [deleting, setDeleting] = useState<Reminder | null>(null)
  const all = useMemo(() => (q.data ?? []).filter((r) => deviceFilter == null || r.deviceId === deviceFilter), [q.data, deviceFilter])
  const rows = useMemo(
    () => all.filter((r) => status === 'all' || r.status === status).sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.dueDate.localeCompare(b.dueDate)),
    [all, status],
  )
  const count = (s: DueStatus) => all.filter((r) => r.status === s).length
  const subject = (r: Reminder) =>
    r.deviceId != null ? (byId[r.deviceId]?.name ?? `Vehicle #${r.deviceId}`) : r.driverId != null ? (drivers.data?.find((d) => d.id === r.driverId)?.name ?? `Driver #${r.driverId}`) : '—'
  const canEdit = (r: Reminder) => (r.deviceId != null ? canManageDevice(byId[r.deviceId]) : canManage)

  const del = useMutation({
    mutationFn: (r: Reminder) => api.deleteReminder(r.id),
    onSuccess: (_, r) => {
      qc.setQueryData<Reminder[]>(qk.reminders, (l) => l?.filter((x) => x.id !== r.id))
      toast.success('Reminder deleted', r.title)
      setDeleting(null)
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Segmented<DueStatus | 'all'>
          label="Status"
          value={status}
          onChange={setStatus}
          className="overflow-x-auto"
          options={[
            { id: 'all', label: `All ${all.length}` },
            { id: 'overdue', label: <span className={cn(count('overdue') && 'text-rose-600 dark:text-rose-400')}>Overdue {count('overdue')}</span> },
            { id: 'dueSoon', label: <span className={cn(count('dueSoon') && 'text-amber-600 dark:text-amber-400')}>Due soon {count('dueSoon')}</span> },
            { id: 'ok', label: `OK ${count('ok')}` },
          ]}
        />
        {canManage && (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')} className="sm:ml-auto">
            New reminder
          </Button>
        )}
      </div>
      <div className="card overflow-hidden">
        {q.isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : q.isError ? (
          <EmptyState icon={<TriangleAlert className="h-5 w-5" />} title="Couldn’t load reminders" action={<Button onClick={() => void q.refetch()}>Try again</Button>} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<FileClock className="h-5 w-5" />}
            title={all.length ? 'Nothing here' : 'No document reminders'}
            description={all.length ? 'No reminder matches this filter.' : 'Never miss an insurance, registration or licence renewal again.'}
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
            {rows.map((r) => {
              const m = reminderMeta(r.kind)
              return (
                <li key={r.id} className="group flex items-center gap-3 px-3 py-3 sm:px-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `${m.color}1f`, color: m.color }}>
                    <m.icon className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate font-medium text-slate-900 dark:text-white">{r.title}</span>
                      <DueStatusPill status={r.status} className="sm:hidden" />
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-slate-500 dark:text-slate-400">
                      {m.label} · {subject(r)}
                      {r.notes ? ` · ${r.notes}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="tabular text-[12.5px] font-medium text-slate-800 dark:text-slate-100">{fmtDate(r.dueDate)}</div>
                    <DaysLeft date={r.dueDate} />
                  </div>
                  <DueStatusPill status={r.status} className="hidden w-[84px] justify-center sm:inline-flex" />
                  {canEdit(r) && (
                    <div className="flex shrink-0 gap-0.5 sm:opacity-60 sm:group-hover:opacity-100">
                      <IconButton size="sm" label={`Edit ${r.title}`} onClick={() => setEditing(r)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton size="sm" label={`Delete ${r.title}`} onClick={() => setDeleting(r)} className="hover:!bg-rose-500/10 hover:!text-rose-500 max-sm:hidden">
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {editing && <ReminderForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? null : editing} defaultDevice={deviceFilter ?? undefined} onClose={() => setEditing(null)} />}
      <Modal
        open={!!deleting}
        onClose={() => !del.isPending && setDeleting(null)}
        title={`Delete “${deleting?.title ?? 'reminder'}”?`}
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
