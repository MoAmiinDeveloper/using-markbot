import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { CalendarClock, CircleAlert, CircleCheck, History, Mail, MoreHorizontal, Pencil, Plus, Send, Trash2, TriangleAlert, X } from 'lucide-react'
import { api, ApiError, qk } from '@/api/client'
import type { ReportSchedule, ReportScheduleInput, ScheduleFrequency, SchedulePeriod, User } from '@/api/types'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Input'
import { Drawer, Modal } from '@/components/ui/Modal'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { EmptyState, Skeleton } from '@/components/ui/Misc'
import { Segmented } from '@/components/ui/Tabs'
import { Switch } from '@/components/ui/Switch'
import { DeviceMultiSelect } from '@/features/common/DeviceMultiSelect'
import { useDrivers, useGroups, useSettings } from '@/features/common/queries'
import { useAccess } from '@/lib/access'
import { fmtShortDateTime, timeAgo } from '@/lib/format'
import { useAuth } from '@/store/auth'
import { toast } from '@/store/toast'
import { cn } from '@/lib/cn'
import { REPORTS, REPORT_GROUPS, reportDef } from './catalog'

export const PERIODS: Array<{ id: SchedulePeriod; label: string }> = [
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'today', label: 'Today so far' },
  { id: 'lastWeek', label: 'Last week' },
  { id: 'thisWeek', label: 'This week so far' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'thisMonth', label: 'This month so far' },
]
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const FORMAT_LABEL = { pdf: 'PDF', xlsx: 'Excel', csv: 'CSV' } as const
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

export const browserTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Mogadishu'
  } catch {
    return 'Africa/Mogadishu'
  }
}
function timezones(current: string): string[] {
  let all: string[] = []
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  } catch {
    all = []
  }
  const common = ['Africa/Mogadishu', 'Africa/Nairobi', 'Africa/Djibouti', 'Africa/Addis_Ababa', 'Asia/Dubai', 'Asia/Riyadh', 'Europe/London', 'UTC']
  return [...new Set([current, browserTz(), ...common, ...all])]
}

/** "telegram:amira@somtel.so" → "Telegram · amira@somtel.so" */
function fmtRecipient(r: string): string {
  const m = /^(telegram|email):(.*)$/i.exec(r)
  if (!m) return r
  return m[1].toLowerCase() === 'telegram' ? `Telegram · ${m[2]}` : m[2]
}

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`
export function cadence(s: Pick<ReportSchedule, 'frequency' | 'hour' | 'weekday' | 'monthDay' | 'timezone'>, withTz = true): string {
  const at = `at ${hh(s.hour)}${withTz ? ` (${s.timezone.split('/').pop()?.replace(/_/g, ' ')})` : ''}`
  if (s.frequency === 'weekly') return `Every ${WEEKDAYS_LONG[s.weekday] ?? 'Monday'} ${at}`
  if (s.frequency === 'monthly') return `Monthly on day ${s.monthDay} ${at}`
  return `Daily ${at}`
}
const periodLabel = (p: string) => PERIODS.find((x) => x.id === p)?.label ?? p

/** Users (admin) for Telegram recipients; others fall back to themselves. */
function useRecipientUsers(): { users: User[]; partial: boolean; loading: boolean } {
  const me = useAuth((s) => s.user)
  const users = useQuery({ queryKey: qk.users, queryFn: api.users, staleTime: 5 * 60_000, retry: false, meta: { silent: true } })
  const prefs = useQuery({ queryKey: qk.notificationPrefs, queryFn: api.notificationPrefs, staleTime: 5 * 60_000, meta: { silent: true } })
  if (users.data) return { users: users.data.filter((u) => u.role !== 'driver' && u.active !== false), partial: false, loading: false }
  const self = me ? [{ ...me, telegramLinked: me.telegramLinked ?? prefs.data?.telegramLinked ?? false }] : []
  return { users: self, partial: true, loading: users.isLoading }
}

function EmailChips({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const commit = () => {
    const parts = text.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)
    if (!parts.length) return
    const bad = parts.filter((p) => !EMAIL_RE.test(p))
    const good = parts.filter((p) => EMAIL_RE.test(p) && !value.includes(p.toLowerCase())).map((p) => p.toLowerCase())
    if (good.length) onChange([...value, ...good])
    setText(bad.join(' '))
    setErr(bad.length ? `“${bad[0]}” isn’t a valid email` : null)
  }
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === ' ') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
  }
  return (
    <div>
      <div
        className={cn(
          'flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border bg-white px-1.5 py-1 shadow-soft focus-within:ring-2 focus-within:ring-brand-500/40 dark:bg-white/[0.03]',
          err ? 'border-rose-400' : 'border-slate-200 focus-within:border-brand-500 dark:border-white/10',
          disabled && 'opacity-60',
        )}
      >
        <Mail className="ml-1 h-4 w-4 shrink-0 text-slate-400" />
        {value.map((e) => (
          <span key={e} className="inline-flex max-w-full items-center gap-1 rounded-md bg-navy-700/[0.08] py-0.5 pl-2 pr-1 text-[12px] font-medium text-navy-800 dark:bg-white/[0.08] dark:text-slate-100">
            <span className="truncate">{e}</span>
            <button type="button" aria-label={`Remove ${e}`} onClick={() => onChange(value.filter((x) => x !== e))} className="grid h-4 w-4 place-items-center rounded text-slate-400 hover:bg-slate-900/10 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value)
            setErr(null)
          }}
          onKeyDown={onKey}
          onBlur={commit}
          placeholder={value.length ? 'Add another…' : 'name@company.so — Enter to add'}
          aria-label="Email recipients"
          className="h-7 min-w-[140px] flex-1 bg-transparent px-1 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-white"
        />
      </div>
      {err && <p className="mt-1 text-[12px] text-rose-500">{err}</p>}
    </div>
  )
}

export interface SchedulePrefill {
  reportType: string
  filters: ReportSchedule['filters']
  period: SchedulePeriod
}

function blank(prefill?: SchedulePrefill): ReportScheduleInput {
  const type = prefill?.reportType ?? 'summary'
  return {
    name: `${reportDef(type)?.label ?? 'Report'} — daily`,
    reportType: type,
    filters: prefill?.filters ?? { deviceIds: [], groupId: null, driverId: null },
    period: prefill?.period ?? 'yesterday',
    frequency: 'daily',
    hour: 7,
    weekday: 1,
    monthDay: 1,
    timezone: browserTz(),
    format: 'pdf',
    telegramUserIds: [],
    emails: [],
    enabled: true,
  }
}

export function ScheduleDrawer({ initial, prefill, onClose }: { initial: ReportSchedule | null; prefill?: SchedulePrefill; onClose: () => void }) {
  const qc = useQueryClient()
  const [v, setV] = useState<ReportScheduleInput>(() => (initial ? { ...initial, filters: { deviceIds: initial.filters?.deviceIds ?? [], groupId: initial.filters?.groupId ?? null, driverId: initial.filters?.driverId ?? null } } : blank(prefill)))
  const [nameTouched, setNameTouched] = useState(!!initial)
  const [touched, setTouched] = useState(false)
  const groups = useGroups()
  const drivers = useDrivers()
  const settings = useSettings()
  const recipients = useRecipientUsers()
  const smtpOk = settings.data?.smtp?.configured
  const tzs = useMemo(() => timezones(v.timezone), [v.timezone])
  const set = <K extends keyof ReportScheduleInput>(k: K, val: ReportScheduleInput[K]) => setV((s) => ({ ...s, [k]: val }))
  const autoName = (p: Partial<ReportScheduleInput>) => {
    if (nameTouched) return
    const n = { ...v, ...p }
    setV((s) => ({ ...s, ...p, name: `${reportDef(n.reportType)?.label ?? 'Report'} — ${n.frequency}` }))
  }
  const errors = {
    name: !v.name.trim() ? 'Name the schedule' : undefined,
    recipients: !v.telegramUserIds.length && !v.emails.length ? 'Add at least one Telegram or email recipient' : undefined,
  }
  const save = useMutation({
    meta: { silent: true },
    mutationFn: (input: ReportScheduleInput) => (initial ? api.updateReportSchedule(initial.id, input) : api.createReportSchedule(input)),
    onSuccess: (s) => {
      qc.setQueryData<ReportSchedule[]>(qk.reportSchedules, (l) => (l ? [...l.filter((x) => x.id !== s.id), s] : [s]))
      void qc.invalidateQueries({ queryKey: qk.reportSchedules })
      toast.success(initial ? 'Schedule saved' : 'Report scheduled', `${s.name} · ${cadence(s, false)}`)
      onClose()
    },
    onError: (e) => toast.error('Could not save the schedule', e instanceof ApiError ? e.message : String(e)),
  })
  const submit = () => {
    setTouched(true)
    if (errors.name || errors.recipients) return
    save.mutate({ ...v, name: v.name.trim() })
  }
  const def = reportDef(v.reportType)

  return (
    <Drawer
      open
      onClose={onClose}
      wide
      title={initial ? 'Edit schedule' : 'Schedule a report'}
      subtitle="Generated with your access and sent automatically"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            {initial ? 'Save changes' : 'Create schedule'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-xl bg-brand-500/10 px-3 py-2.5 dark:bg-brand-400/[0.08]">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-navy-700 dark:text-brand-300" />
          <p className="text-[12.5px] text-slate-700 dark:text-slate-200">
            <b className="font-semibold text-slate-900 dark:text-white">{cadence(v)}</b> — {periodLabel(v.period).toLowerCase()}’s {def?.label ?? v.reportType} report as {FORMAT_LABEL[v.format]}
            {v.telegramUserIds.length + v.emails.length > 0 && ` to ${v.telegramUserIds.length + v.emails.length} recipient${v.telegramUserIds.length + v.emails.length === 1 ? '' : 's'}`}.
          </p>
        </div>

        <Field label="Name" required error={touched ? errors.name : undefined}>
          {(id, d) => (
            <Input id={id} aria-describedby={d} data-autofocus value={v.name} invalid={touched && !!errors.name} onChange={(e) => (setNameTouched(true), set('name', e.target.value))} />
          )}
        </Field>

        <section className="space-y-3">
          <h3 className="label-xs">Report</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Report type">
              {(id) => (
                <Select id={id} value={v.reportType} onChange={(e) => autoName({ reportType: e.target.value })}>
                  {REPORT_GROUPS.map((g) => (
                    <optgroup key={g} label={g}>
                      {REPORTS.filter((r) => r.group === g).map((r) => (
                        <option key={r.type} value={r.type}>
                          {r.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Period covered">
              {(id) => (
                <Select id={id} value={v.period} onChange={(e) => set('period', e.target.value as SchedulePeriod)}>
                  {PERIODS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <DeviceMultiSelect value={v.filters.deviceIds} onChange={(ids) => set('filters', { ...v.filters, deviceIds: ids })} />
            <Select aria-label="Group" value={v.filters.groupId ?? ''} onChange={(e) => set('filters', { ...v.filters, groupId: e.target.value ? Number(e.target.value) : null })} disabled={!groups.data?.length}>
              <option value="">All groups</option>
              {groups.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
            <Select aria-label="Driver" value={v.filters.driverId ?? ''} onChange={(e) => set('filters', { ...v.filters, driverId: e.target.value ? Number(e.target.value) : null })} disabled={!drivers.data?.length}>
              <option value="">All drivers</option>
              {drivers.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Format</span>
            <Segmented label="Format" value={v.format} onChange={(f) => set('format', f)} className="sm:w-72" options={(['pdf', 'xlsx', 'csv'] as const).map((f) => ({ id: f, label: FORMAT_LABEL[f] }))} />
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="label-xs">When</h3>
          <Segmented<ScheduleFrequency>
            label="Frequency"
            value={v.frequency}
            onChange={(f) => autoName({ frequency: f, period: f === 'weekly' && v.period === 'yesterday' ? 'lastWeek' : f === 'monthly' && v.period === 'yesterday' ? 'lastMonth' : v.period })}
            options={[
              { id: 'daily', label: 'Daily' },
              { id: 'weekly', label: 'Weekly' },
              { id: 'monthly', label: 'Monthly' },
            ]}
          />
          {v.frequency === 'weekly' && (
            <div role="radiogroup" aria-label="Weekday" className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={v.weekday === d}
                  onClick={() => set('weekday', d)}
                  className={cn(
                    'h-8 w-11 rounded-lg border text-[12.5px] font-medium transition-colors',
                    v.weekday === d ? 'border-brand-500 bg-brand-500 text-navy-900' : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-white/10 dark:text-slate-300',
                  )}
                >
                  {WEEKDAYS[d]}
                </button>
              ))}
            </div>
          )}
          <div className={cn('grid gap-3', v.frequency === 'monthly' ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
            {v.frequency === 'monthly' && (
              <Field label="Day of month" hint="1–28 so every month has it">
                {(id, d) => (
                  <Select id={id} aria-describedby={d} value={v.monthDay} onChange={(e) => set('monthDay', Number(e.target.value))}>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label="Time">
              {(id) => (
                <Select id={id} value={v.hour} onChange={(e) => set('hour', Number(e.target.value))}>
                  {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                    <option key={h} value={h}>
                      {hh(h)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Time zone">
              {(id) => (
                <Select id={id} value={v.timezone} onChange={(e) => set('timezone', e.target.value)}>
                  {tzs.map((z) => (
                    <option key={z} value={z}>
                      {z.replace(/_/g, ' ')}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="label-xs">Recipients</h3>
            {touched && errors.recipients && <span className="text-[12px] text-rose-500">{errors.recipients}</span>}
          </div>
          <div className="space-y-1.5">
            <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Telegram</span>
            <div className="overflow-hidden rounded-lg border border-slate-200/80 dark:border-white/[0.08]">
              {recipients.loading ? (
                <Skeleton className="m-2 h-16" />
              ) : (
                <ul className="max-h-48 overflow-y-auto p-1">
                  {recipients.users.map((u) => {
                    const linked = !!u.telegramLinked
                    const on = v.telegramUserIds.includes(u.id)
                    return (
                      <li key={u.id}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          disabled={!linked && !on}
                          onClick={() => set('telegramUserIds', on ? v.telegramUserIds.filter((x) => x !== u.id) : [...v.telegramUserIds, u.id])}
                          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left enabled:hover:bg-slate-900/[0.04] disabled:cursor-not-allowed dark:enabled:hover:bg-white/[0.05]"
                        >
                          <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded border', on ? 'border-brand-500 bg-brand-500 text-navy-900' : 'border-slate-300 dark:border-white/20', !linked && 'opacity-40')}>
                            {on && <CircleCheck className="h-3 w-3" />}
                          </span>
                          <span className={cn('min-w-0 flex-1', !linked && 'opacity-50')}>
                            <span className="block truncate text-[12.5px] font-medium text-slate-800 dark:text-slate-100">{u.name || u.email}</span>
                            <span className="block truncate text-[11px] text-slate-500">{u.email}</span>
                          </span>
                          {linked ? (
                            <span className="rounded bg-sky-500/12 px-1.5 text-[10px] font-semibold uppercase text-sky-700 dark:text-sky-300">Linked</span>
                          ) : (
                            <span className="text-[10.5px] text-slate-400">Not linked</span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            <p className="text-[11.5px] text-slate-500 dark:text-slate-400">
              Only users who linked Telegram (Settings → Notifications) can receive the file.{recipients.partial && ' Only admins can pick other users.'}
            </p>
          </div>
          <div className="space-y-1.5">
            <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Email</span>
            <EmailChips value={v.emails} onChange={(e) => set('emails', e)} />
            {settings.data && !smtpOk && (
              <p className="flex items-center gap-1.5 text-[11.5px] text-amber-700 dark:text-amber-300">
                <TriangleAlert className="h-3.5 w-3.5" /> Email isn’t configured yet — an admin can set up SMTP in Settings → Email.
              </p>
            )}
          </div>
        </section>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200/80 px-3 py-2.5 dark:border-white/[0.07]">
          <div>
            <p className="text-[13px] font-medium text-slate-900 dark:text-white">Enabled</p>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">Paused schedules keep their settings and history</p>
          </div>
          <Switch checked={v.enabled} onChange={(x) => set('enabled', x)} label="Schedule enabled" />
        </div>
      </div>
    </Drawer>
  )
}

function RunsModal({ s, onClose }: { s: ReportSchedule; onClose: () => void }) {
  const runs = useQuery({ queryKey: qk.scheduleRuns(s.id), queryFn: () => api.reportScheduleRuns(s.id) })
  return (
    <Modal open onClose={onClose} title={`Run history · ${s.name}`} description={cadence(s)} className="!max-w-lg" footer={<Button onClick={onClose}>Close</Button>}>
      <div className="mt-4 max-h-[55vh] overflow-y-auto">
        {runs.isLoading ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : !runs.data?.length ? (
          <EmptyState icon={<History className="h-5 w-5" />} title="Not run yet" description="Runs appear here after the first delivery." className="py-6" />
        ) : (
          <ol className="space-y-2">
            {[...runs.data]
              .sort((a, b) => b.time.localeCompare(a.time))
              .map((r, i) => {
                const rec = (Array.isArray(r.recipients) ? r.recipients : r.recipients ? String(r.recipients).split(/,\s*/) : []).map(fmtRecipient)
                return (
                  <li key={i} className="rounded-xl border border-slate-200/80 px-3 py-2.5 dark:border-white/[0.07]">
                    <div className="flex items-center gap-2">
                      {r.status === 'ok' ? <CircleCheck className="h-4 w-4 text-emerald-500" /> : <CircleAlert className="h-4 w-4 text-rose-500" />}
                      <span className="tabular text-[12.5px] font-medium text-slate-900 dark:text-white">{format(Date.parse(r.time), 'EEE d MMM yyyy, HH:mm')}</span>
                      {r.manual && <span className="rounded bg-slate-100 px-1.5 text-[10px] font-semibold uppercase text-slate-500 dark:bg-white/[0.07] dark:text-slate-300">Sent now</span>}
                      <span className={cn('ml-auto text-[11px] font-semibold', r.status === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>{r.status === 'ok' ? 'Delivered' : 'Failed'}</span>
                    </div>
                    {r.error && <p className="mt-1 rounded-md bg-rose-500/10 px-2 py-1 font-mono text-[11.5px] text-rose-700 dark:text-rose-300">{r.error}</p>}
                    {rec.length > 0 && <p className="mt-1 text-[11.5px] text-slate-500 dark:text-slate-400">{rec.join(' · ')}</p>}
                  </li>
                )
              })}
          </ol>
        )}
      </div>
    </Modal>
  )
}

export default function SchedulesView({ onNew }: { onNew?: () => void }) {
  const { canManage } = useAccess()
  const qc = useQueryClient()
  const list = useQuery({ queryKey: qk.reportSchedules, queryFn: api.reportSchedules })
  const [editing, setEditing] = useState<ReportSchedule | 'new' | null>(null)
  const [runs, setRuns] = useState<ReportSchedule | null>(null)
  const [deleting, setDeleting] = useState<ReportSchedule | null>(null)
  const users = useQuery({ queryKey: qk.users, queryFn: api.users, staleTime: 5 * 60_000, retry: false, meta: { silent: true } })
  const put = (s: ReportSchedule) => qc.setQueryData<ReportSchedule[]>(qk.reportSchedules, (l) => l?.map((x) => (x.id === s.id ? s : x)))
  const toggle = useMutation({
    mutationFn: (s: ReportSchedule) => api.updateReportSchedule(s.id, { enabled: !s.enabled }),
    onMutate: (s) => put({ ...s, enabled: !s.enabled }),
    onSuccess: (s) => s && put(s),
    onError: () => void qc.invalidateQueries({ queryKey: qk.reportSchedules }),
  })
  const run = useMutation({
    meta: { silent: true },
    mutationFn: (s: ReportSchedule) => api.runReportSchedule(s.id),
    onSuccess: (run, s) => {
      if (run && run.status === 'error') toast.error(`${s.name}: not fully delivered`, run.error || 'Check the run history for details.')
      else {
        const n = Array.isArray(run?.recipients) ? run.recipients.length : s.telegramUserIds.length + s.emails.length
        toast.success('Report sent', `${s.name} delivered to ${n} recipient${n === 1 ? '' : 's'}`)
      }
      void qc.invalidateQueries({ queryKey: qk.reportSchedules })
      void qc.invalidateQueries({ queryKey: qk.scheduleRuns(s.id) })
    },
    onError: (e) => toast.error('Send failed', e instanceof ApiError ? e.message : String(e)),
  })
  const del = useMutation({
    mutationFn: (s: ReportSchedule) => api.deleteReportSchedule(s.id),
    onSuccess: (_, s) => {
      qc.setQueryData<ReportSchedule[]>(qk.reportSchedules, (l) => l?.filter((x) => x.id !== s.id))
      toast.success('Schedule deleted', s.name)
      setDeleting(null)
    },
  })
  const rows = [...(list.data ?? [])].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
  const who = (s: ReportSchedule) => {
    const tg = s.telegramUserIds.map((id) => users.data?.find((u) => u.id === id)?.name ?? `user #${id}`)
    return [...(tg.length ? [`Telegram: ${tg.map((n) => n.split(' ')[0]).join(', ')}`] : []), ...s.emails]
  }

  return (
    <div className="card relative flex min-h-[420px] flex-1 flex-col overflow-hidden lg:min-h-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200/80 px-4 py-3 dark:border-white/[0.06]">
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold text-slate-900 dark:text-white">Scheduled reports</h3>
          <p className="text-[12px] text-slate-500 dark:text-slate-400">Delivered automatically as PDF, Excel or CSV by email and Telegram</p>
        </div>
        {canManage && (
          <Button variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => (onNew ? onNew() : setEditing('new'))}>
            New schedule
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : list.isError ? (
          <EmptyState icon={<TriangleAlert className="h-5 w-5" />} title="Couldn’t load schedules" description={list.error instanceof Error ? list.error.message : undefined} action={<Button onClick={() => void list.refetch()}>Try again</Button>} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="h-5 w-5" />}
            title="No scheduled reports"
            description="Send a daily summary to managers at 07:00, or a weekly driver scorecard every Saturday."
            action={canManage && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>New schedule</Button>}
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
            {rows.map((s) => {
              const d = reportDef(s.reportType)
              const Icon = d?.icon ?? CalendarClock
              const rec = who(s)
              return (
                <li key={s.id} className={cn('flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4', !s.enabled && 'opacity-60')}>
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/15 text-navy-700 dark:bg-brand-400/15 dark:text-brand-300">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-semibold text-slate-900 dark:text-white">{s.name}</p>
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 text-[10px] font-semibold uppercase text-slate-500 dark:bg-white/[0.07] dark:text-slate-300">{FORMAT_LABEL[s.format]}</span>
                      </div>
                      <p className="truncate text-[12px] text-slate-500 dark:text-slate-400">
                        {d?.label ?? s.reportType} · {periodLabel(s.period).toLowerCase()} · {cadence(s, false)}
                      </p>
                      <p className="mt-0.5 truncate text-[11.5px] text-slate-500 dark:text-slate-400" title={rec.join(', ')}>
                        {rec.length ? rec.join(' · ') : <span className="text-amber-600">No recipients</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 pl-12 sm:pl-0">
                    <div className="w-[150px] text-[11.5px]">
                      <p className="text-slate-500 dark:text-slate-400">
                        Next: <span className="tabular font-medium text-slate-800 dark:text-slate-100">{s.enabled && s.nextRunAt ? fmtShortDateTime(s.nextRunAt) : 'Paused'}</span>
                      </p>
                      {s.lastRunAt ? (
                        <p className={cn('flex items-center gap-1', s.lastStatus === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')} title={s.lastError || undefined}>
                          {s.lastStatus === 'error' ? <CircleAlert className="h-3 w-3" /> : <CircleCheck className="h-3 w-3" />}
                          {s.lastStatus === 'error' ? 'Failed' : 'Sent'} {timeAgo(s.lastRunAt)}
                        </p>
                      ) : (
                        <p className="text-slate-400">Never run</p>
                      )}
                    </div>
                    {canManage && <Switch checked={s.enabled} onChange={() => toggle.mutate(s)} label={`${s.name} enabled`} size="sm" />}
                    <div className="ml-auto flex items-center gap-0.5 sm:ml-0">
                      {canManage && (
                        <IconButton size="sm" label={`Send ${s.name} now`} onClick={() => run.mutate(s)} disabled={run.isPending && run.variables?.id === s.id}>
                          <Send className={cn('h-3.5 w-3.5', run.isPending && run.variables?.id === s.id && 'animate-pulse')} />
                        </IconButton>
                      )}
                      <IconButton size="sm" label={`Run history of ${s.name}`} onClick={() => setRuns(s)}>
                        <History className="h-3.5 w-3.5" />
                      </IconButton>
                      {canManage && (
                        <Menu
                          trigger={({ toggle: t, open }) => (
                            <IconButton size="sm" label={`More actions for ${s.name}`} onClick={t} aria-expanded={open}>
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </IconButton>
                          )}
                        >
                          {(close) => (
                            <>
                              <MenuItem icon={<Pencil className="text-slate-500" />} title="Edit" onClick={() => (close(), setEditing(s))} />
                              <MenuItem icon={<Trash2 className="text-rose-500" />} title="Delete" onClick={() => (close(), setDeleting(s))} />
                            </>
                          )}
                        </Menu>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {editing && <ScheduleDrawer initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {runs && <RunsModal s={runs} onClose={() => setRuns(null)} />}
      <Modal
        open={!!deleting}
        onClose={() => !del.isPending && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'schedule'}?`}
        description="Recipients stop receiving this report. Past deliveries are not affected."
        footer={
          <>
            <Button onClick={() => setDeleting(null)} disabled={del.isPending} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" loading={del.isPending} onClick={() => deleting && del.mutate(deleting)}>
              Delete schedule
            </Button>
          </>
        }
      />
    </div>
  )
}
