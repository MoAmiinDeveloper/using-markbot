import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Sparkles, Trash2, TriangleAlert } from 'lucide-react'
import { api, ApiError, qk } from '@/api/client'
import type { CustomEvent, CustomEventInput, ParamDef, Severity } from '@/api/types'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Input'
import { Drawer, Modal } from '@/components/ui/Modal'
import { EmptyState, Skeleton } from '@/components/ui/Misc'
import { Segmented } from '@/components/ui/Tabs'
import { Switch } from '@/components/ui/Switch'
import { DeviceChecklist } from '@/features/common/DeviceMultiSelect'
import { useCustomEvents } from '@/features/common/queries'
import { useAccess } from '@/lib/access'
import { useDeviceList, useLive } from '@/store/live'
import { toast } from '@/store/toast'
import { cn } from '@/lib/cn'
import { FormulaInput } from './FormulaInput'

export const SEVERITY_META: Record<Severity, { label: string; cls: string }> = {
  info: { label: 'Info', cls: 'bg-sky-500/12 text-sky-700 ring-sky-500/25 dark:text-sky-300' },
  warning: { label: 'Warning', cls: 'bg-amber-500/12 text-amber-700 ring-amber-500/25 dark:text-amber-300' },
  critical: { label: 'Critical', cls: 'bg-rose-500/12 text-rose-700 ring-rose-500/25 dark:text-rose-300' },
}

const DURATIONS: Array<[number, string]> = [
  [0, 'Immediately'],
  [10, '10 seconds'],
  [30, '30 seconds'],
  [60, '1 minute'],
  [120, '2 minutes'],
  [300, '5 minutes'],
  [600, '10 minutes'],
  [900, '15 minutes'],
  [1800, '30 minutes'],
  [3600, '1 hour'],
]

export function fmtHold(s: number) {
  return DURATIONS.find(([v]) => v === s)?.[1] ?? (s % 60 ? `${s} s` : `${s / 60} min`)
}

const TEMPLATES: Array<{ name: string; condition: string; duration: number; message: string; severity: Severity }> = [
  { name: 'Low battery while parked', condition: 'not ignition and power < 11.8', duration: 300, message: '{device}: battery {power} V', severity: 'warning' },
  { name: 'Door opened while moving', condition: 'in2 and speed > 5', duration: 0, message: '{device}: door opened at {speed} km/h', severity: 'critical' },
  { name: 'Engine running, no driver', condition: 'ignition and not has(driverId)', duration: 120, message: '{device}: engine on without a driver card', severity: 'warning' },
  { name: 'No GPS fix', condition: 'satellites < 3', duration: 600, message: '{device}: no GPS fix for 10 min', severity: 'info' },
]

type V = { name: string; condition: string; scope: 'all' | 'some'; deviceIds: number[]; duration: string; message: string; severity: Severity; notifyEnd: boolean; enabled: boolean }

function CustomEventForm({ initial, defs, onClose }: { initial: CustomEvent | null; defs: ParamDef[]; onClose: () => void }) {
  const qc = useQueryClient()
  const { isAdmin, canManageDevice } = useAccess()
  const devices = useDeviceList().filter((d) => canManageDevice(d))
  const [v, setV] = useState<V>(() => ({
    name: initial?.name ?? '',
    condition: initial?.condition ?? '',
    scope: initial ? (initial.deviceIds.length ? 'some' : 'all') : isAdmin ? 'all' : 'some',
    deviceIds: initial?.deviceIds ?? [],
    duration: String(initial?.duration ?? 0),
    message: initial?.message ?? '',
    severity: initial?.severity ?? 'warning',
    notifyEnd: initial?.notifyEnd ?? false,
    enabled: initial?.enabled ?? true,
  }))
  const [touched, setTouched] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const set = <K extends keyof V>(k: K, val: V[K]) => setV((s) => ({ ...s, [k]: val }))
  const errors: Partial<Record<keyof V, string>> = {}
  if (!v.name.trim()) errors.name = 'Give it a name'
  if (!v.condition.trim()) errors.condition = 'Write the condition'
  if (v.scope === 'some' && !v.deviceIds.length) errors.deviceIds = 'Choose at least one vehicle'
  const show = (k: keyof V) => (touched ? errors[k] : undefined)
  const sample = v.scope === 'some' ? devices.filter((d) => v.deviceIds.includes(d.id)) : devices

  const save = useMutation({
    meta: { silent: true },
    mutationFn: () => {
      const input: CustomEventInput = {
        name: v.name.trim(),
        condition: v.condition.trim(),
        deviceIds: v.scope === 'all' ? [] : v.deviceIds,
        duration: Number(v.duration) || 0,
        message: v.message.trim(),
        severity: v.severity,
        notifyEnd: v.notifyEnd,
        enabled: v.enabled,
      }
      return initial ? api.updateCustomEvent(initial.id, input) : api.createCustomEvent(input)
    },
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: qk.customEvents })
      toast.success(initial ? 'Custom event saved' : 'Custom event created', c.name)
      onClose()
    },
    onError: (e) => setServerError(e instanceof ApiError ? e.message : 'Could not save the custom event'),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    setServerError(null)
    if (Object.keys(errors).length) return
    save.mutate()
  }
  const durationOptions = DURATIONS.some(([s]) => String(s) === v.duration) ? DURATIONS : [...DURATIONS, [Number(v.duration), fmtHold(Number(v.duration))] as [number, string]]

  return (
    <Drawer
      open
      onClose={onClose}
      wide
      title={initial ? `Edit ${initial.name}` : 'New custom event'}
      subtitle="Raise an alert when a condition on the vehicle’s data is true"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="custom-event-form" loading={save.isPending}>
            {initial ? 'Save changes' : 'Create event'}
          </Button>
        </>
      }
    >
      <form id="custom-event-form" onSubmit={submit} className="space-y-4" noValidate>
        {serverError && (
          <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-700 dark:text-rose-300">
            {serverError}
          </div>
        )}
        {!initial && (
          <div>
            <p className="mb-1.5 text-[12px] text-slate-500 dark:text-slate-400">Start from an example</p>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => setV((s) => ({ ...s, name: t.name, condition: t.condition, duration: String(t.duration), message: t.message, severity: t.severity }))}
                  className="rounded-full border border-slate-200 px-2.5 py-1 text-[12px] text-slate-700 hover:border-brand-500 hover:bg-brand-500/10 dark:border-white/10 dark:text-slate-200"
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <Field label="Name" required error={show('name')}>
          {(id, d) => <Input id={id} aria-describedby={d} value={v.name} invalid={!!show('name')} placeholder="Door opened while moving" onChange={(e) => set('name', e.target.value)} />}
        </Field>
        <Field label="Condition" required error={show('condition')} hint="The event fires when this is true">
          {(id) => (
            <FormulaInput id={id} boolean value={v.condition} onChange={(x) => set('condition', x)} devices={sample} defs={defs} invalid={!!show('condition')} placeholder="in2 and speed > 5" />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="True for at least" hint="Ignores short blips">
            {(id) => (
              <Select id={id} value={v.duration} onChange={(e) => set('duration', e.target.value)}>
                {durationOptions.map(([s, l]) => (
                  <option key={s} value={s}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="space-y-1.5">
            <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Severity</span>
            <Segmented<Severity>
              label="Severity"
              value={v.severity}
              onChange={(s) => set('severity', s)}
              options={(['info', 'warning', 'critical'] as const).map((s) => ({ id: s, label: SEVERITY_META[s].label }))}
            />
          </div>
        </div>
        <Field label="Message" hint="Placeholders: {device}, {plate}, {name} and any parameter key, e.g. {speed} or {power}">
          {(id, d) => <Input id={id} aria-describedby={d} value={v.message} maxLength={300} placeholder="{device}: door opened at {speed} km/h" onChange={(e) => set('message', e.target.value)} />}
        </Field>
        <div className="space-y-1.5">
          <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Vehicles</span>
          {isAdmin && (
            <Segmented<'all' | 'some'>
              label="Vehicles"
              value={v.scope}
              onChange={(s) => set('scope', s)}
              options={[
                { id: 'all', label: 'All vehicles' },
                { id: 'some', label: 'Selected vehicles' },
              ]}
            />
          )}
          {v.scope === 'some' && <DeviceChecklist value={v.deviceIds} onChange={(ids) => set('deviceIds', ids)} devices={devices} maxHeight="200px" />}
          {show('deviceIds') && <p className="text-[12px] text-rose-500">{show('deviceIds')}</p>}
        </div>
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200/80 text-[12.5px] dark:divide-white/[0.05] dark:border-white/[0.07]">
          <label className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span>
              <span className="block font-medium text-slate-800 dark:text-slate-100">Also alert when it ends</span>
              <span className="text-slate-500 dark:text-slate-400">e.g. “Door opened while moving ended”</span>
            </span>
            <Switch checked={v.notifyEnd} onChange={(x) => set('notifyEnd', x)} label="Also alert when it ends" />
          </label>
          <label className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span className="font-medium text-slate-800 dark:text-slate-100">Enabled</span>
            <Switch checked={v.enabled} onChange={(x) => set('enabled', x)} label="Enabled" />
          </label>
        </div>
        <p className="text-[12px] text-slate-500 dark:text-slate-400">Delivery (in-app, Telegram, push, email) follows each user’s notification settings for “Custom event”.</p>
      </form>
    </Drawer>
  )
}

export function CustomEventsTab({ defs }: { defs: ParamDef[] }) {
  const qc = useQueryClient()
  const { canManage, isAdmin } = useAccess()
  const byId = useLive((s) => s.byId)
  const q = useCustomEvents()
  const [editing, setEditing] = useState<CustomEvent | null | 'new'>(null)
  const [deleting, setDeleting] = useState<CustomEvent | null>(null)
  const list = useMemo(() => q.data ?? [], [q.data])

  const toggle = useMutation({
    mutationFn: (c: CustomEvent) => api.updateCustomEvent(c.id, { ...c, enabled: !c.enabled }),
    onSuccess: (c) => {
      qc.setQueryData<CustomEvent[]>(qk.customEvents, (l) => l?.map((x) => (x.id === c.id ? c : x)))
      toast.success(c.enabled ? 'Enabled' : 'Paused', c.name)
    },
  })
  const del = useMutation({
    mutationFn: (c: CustomEvent) => api.deleteCustomEvent(c.id),
    onSuccess: (_, c) => {
      qc.setQueryData<CustomEvent[]>(qk.customEvents, (l) => l?.filter((x) => x.id !== c.id))
      toast.success('Custom event deleted', c.name)
      setDeleting(null)
    },
  })
  const vehicles = (c: CustomEvent) =>
    c.deviceIds.length === 0 ? 'All vehicles' : c.deviceIds.length <= 2 ? c.deviceIds.map((id) => byId[id]?.name ?? `#${id}`).join(', ') : `${c.deviceIds.length} vehicles`

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="text-[12.5px] text-slate-500 dark:text-slate-400">Alerts from your own conditions — any parameter, raw or calculated.</p>
        {canManage && (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')} className="sm:ml-auto">
            New custom event
          </Button>
        )}
      </div>
      <div className="card overflow-hidden">
        {q.isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : q.isError ? (
          <EmptyState icon={<TriangleAlert className="h-5 w-5" />} title="Couldn’t load custom events" action={<Button onClick={() => void q.refetch()}>Try again</Button>} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="h-5 w-5" />}
            title="No custom events yet"
            description="E.g. “door opened while moving” or “battery below 11.8 V while parked”."
            action={canManage ? <Button onClick={() => setEditing('new')}>Create one</Button> : undefined}
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
            {list.map((c) => {
              const editable = canManage && (isAdmin || c.deviceIds.length > 0)
              return (
                <li key={c.id} className={cn('group flex items-center gap-3 px-3 py-3 sm:px-4', !c.enabled && 'opacity-60')}>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500/15 text-brand-700 dark:text-brand-300">
                    <Sparkles className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate font-medium text-slate-900 dark:text-white">{c.name}</span>
                      <span className={cn('rounded-full px-1.5 py-px text-[10.5px] font-medium ring-1 ring-inset', SEVERITY_META[c.severity].cls)}>{SEVERITY_META[c.severity].label}</span>
                      {!c.enabled && <span className="text-[11px] text-slate-500">Paused</span>}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11.5px] text-slate-600 dark:text-slate-300">{c.condition}</div>
                    <div className="truncate text-[11.5px] text-slate-500 dark:text-slate-400">
                      {vehicles(c)} · {c.duration ? `for ${fmtHold(c.duration)}` : 'immediately'}
                      {c.notifyEnd ? ' · start & end' : ''}
                    </div>
                  </div>
                  {editable && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Switch size="sm" checked={c.enabled} onChange={() => toggle.mutate(c)} label={c.enabled ? `Pause ${c.name}` : `Enable ${c.name}`} />
                      <IconButton size="sm" label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton size="sm" label={`Delete ${c.name}`} onClick={() => setDeleting(c)} className="hover:!bg-rose-500/10 hover:!text-rose-500">
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
      {editing && <CustomEventForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? null : editing} defs={defs} onClose={() => setEditing(null)} />}
      <Modal
        open={!!deleting}
        onClose={() => !del.isPending && setDeleting(null)}
        title={`Delete “${deleting?.name ?? 'custom event'}”?`}
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
      >
        <p className="text-[13px] text-slate-600 dark:text-slate-300">Alerts it already raised stay in the alert history.</p>
      </Modal>
    </div>
  )
}
