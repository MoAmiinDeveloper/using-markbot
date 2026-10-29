import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { subDays } from 'date-fns'
import {
  ChartColumn,
  IdCard,
  Map,
  Nfc,
  Pencil,
  Phone,
  Plus,
  Search,
  SearchX,
  Trash2,
  TriangleAlert,
  UserRound,
  Smartphone,
  Eye,
  EyeOff,
  KeyRound,
} from 'lucide-react'
import { api, ApiError, qk } from '@/api/client'
import type { Driver, DriverInput } from '@/api/types'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Input'
import { Drawer, Modal } from '@/components/ui/Modal'
import { EmptyState, Skeleton, StatusDot } from '@/components/ui/Misc'
import { ScoreBadge } from '@/components/ui/Badges'
import { Segmented } from '@/components/ui/Tabs'
import { useDrivers } from '@/features/common/queries'
import { useAccess } from '@/lib/access'
import { useDeviceList, useLive } from '@/store/live'
import { toast } from '@/store/toast'
import { CategoryIcon } from '@/lib/category'
import { daysUntil, fmtDate } from '@/lib/format'
import { cn } from '@/lib/cn'

const EXPIRY_WARN_DAYS = 30

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  )
}

/** Behaviour scores for the last 30 days (driver report), keyed by driver id and by name as a fallback. */
function useDriverScores() {
  const [from, to] = useMemo(() => {
    const now = new Date()
    return [subDays(now, 30).toISOString(), now.toISOString()]
  }, [])
  const q = { from, to }
  return useQuery({
    queryKey: qk.report('driver', q),
    queryFn: () => api.report('driver', q),
    staleTime: 5 * 60_000,
    meta: { silent: true },
    select: (r) => {
      const byId = new globalThis.Map<number, number>()
      const byName = new globalThis.Map<string, number>()
      for (const row of r.rows) {
        if (typeof row.score !== 'number') continue
        if (typeof row.driverId === 'number') byId.set(row.driverId, row.score)
        if (typeof row.driver === 'string') byName.set(row.driver.toLowerCase(), row.score)
      }
      return { byId, byName }
    },
  })
}

export function LicenseExpiry({ date, compact }: { date: string; compact?: boolean }) {
  const days = daysUntil(date)
  if (!date || days == null) return <span className="text-slate-400">—</span>
  const expired = days < 0
  const soon = !expired && days <= EXPIRY_WARN_DAYS
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={cn('tabular', (expired || soon) && 'font-medium text-slate-900 dark:text-white')}>{fmtDate(date)}</span>
      {(expired || soon) && (
        <span
          className={cn(
            'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-px text-[10.5px] font-semibold ring-1 ring-inset',
            expired ? 'bg-rose-500/12 text-rose-700 ring-rose-500/30 dark:text-rose-300' : 'bg-amber-500/14 text-amber-700 ring-amber-500/30 dark:text-amber-300',
          )}
        >
          <TriangleAlert className="h-2.5 w-2.5" />
          {expired ? (compact ? 'Expired' : `Expired ${-days}d ago`) : days === 0 ? 'Today' : `${days}d left`}
        </span>
      )}
    </span>
  )
}

type FormValues = Omit<DriverInput, 'deviceId'> & { deviceId: string }
const EMPTY: FormValues = { name: '', phone: '', licenseNumber: '', licenseExpiry: '', tag: '', deviceId: '', notes: '' }

function DriverForm({ initial, onClose }: { initial: Driver | null; onClose: () => void }) {
  const qc = useQueryClient()
  const devices = useDeviceList()
  const [v, setV] = useState<FormValues>(() =>
    initial
      ? {
          name: initial.name,
          phone: initial.phone ?? '',
          licenseNumber: initial.licenseNumber ?? '',
          licenseExpiry: initial.licenseExpiry ?? '',
          tag: initial.tag ?? '',
          deviceId: initial.deviceId != null ? String(initial.deviceId) : '',
          notes: initial.notes ?? '',
        }
      : EMPTY,
  )
  const [touched, setTouched] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const errors: Partial<Record<keyof FormValues, string>> = {}
  if (!v.name.trim()) errors.name = 'Name is required'
  if (v.phone && !/^\+?[\d\s-]{5,20}$/.test(v.phone.trim())) errors.phone = 'Enter a valid phone number'
  if (v.tag && !/^[0-9a-fA-F]{2,32}$/.test(v.tag.trim())) errors.tag = 'Hexadecimal, as reported by the reader (e.g. 00000A1B2C3D)'
  const show = (k: keyof FormValues) => (touched ? errors[k] : undefined)
  const set = <K extends keyof FormValues>(k: K, val: FormValues[K]) => setV((s) => ({ ...s, [k]: val }))
  const expDays = daysUntil(v.licenseExpiry)

  const m = useMutation({
    meta: { silent: true },
    mutationFn: (input: FormValues) => {
      const clean: DriverInput = {
        name: input.name.trim(),
        phone: input.phone.trim(),
        licenseNumber: input.licenseNumber.trim(),
        licenseExpiry: input.licenseExpiry,
        tag: input.tag.trim().toUpperCase(),
        deviceId: input.deviceId ? Number(input.deviceId) : null,
        notes: input.notes.trim(),
      }
      return initial ? api.updateDriver(initial.id, clean) : api.createDriver(clean)
    },
    onSuccess: (d) => {
      qc.setQueryData<Driver[]>(qk.drivers, (l) => (l ? [...l.filter((x) => x.id !== d.id), d] : [d]))
      void qc.invalidateQueries({ queryKey: qk.drivers })
      toast.success(initial ? 'Driver updated' : 'Driver added', d.name)
      onClose()
    },
    onError: (e) => setServerError(e instanceof ApiError ? e.message : 'Could not save the driver'),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    setServerError(null)
    if (Object.keys(errors).length) return
    m.mutate(v)
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={initial ? 'Edit driver' : 'Add driver'}
      subtitle={initial ? initial.name : 'Identify drivers by iButton/RFID tag or assign them to a vehicle'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="driver-form" loading={m.isPending}>
            {initial ? 'Save changes' : 'Add driver'}
          </Button>
        </>
      }
    >
      <form id="driver-form" onSubmit={submit} className="space-y-4" noValidate>
        {serverError && (
          <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-700 dark:text-rose-300">
            {serverError}
          </div>
        )}
        <Field label="Full name" required error={show('name')}>
          {(id, d) => <Input id={id} aria-describedby={d} data-autofocus value={v.name} invalid={!!show('name')} placeholder="Ahmed Ali Warsame" onChange={(e) => set('name', e.target.value)} />}
        </Field>
        <Field label="Phone" error={show('phone')}>
          {(id, d) => (
            <Input id={id} aria-describedby={d} type="tel" icon={<Phone className="h-4 w-4" />} value={v.phone} invalid={!!show('phone')} placeholder="+252 61 555 0123" onChange={(e) => set('phone', e.target.value)} />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Licence number">
            {(id) => <Input id={id} value={v.licenseNumber} placeholder="DL-448812" onChange={(e) => set('licenseNumber', e.target.value)} />}
          </Field>
          <Field label="Licence expiry">
            {(id) => (
              <Input id={id} type="date" value={v.licenseExpiry} onChange={(e) => set('licenseExpiry', e.target.value)} className="dark:[&_input]:[color-scheme:dark]" />
            )}
          </Field>
        </div>
        {expDays != null && expDays <= EXPIRY_WARN_DAYS && (
          <div
            role="status"
            className={cn(
              'flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px]',
              expDays < 0 ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'bg-amber-500/12 text-amber-800 dark:text-amber-200',
            )}
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {expDays < 0
              ? `This licence expired ${-expDays} day${expDays === -1 ? '' : 's'} ago.`
              : expDays === 0
                ? 'This licence expires today.'
                : `This licence expires in ${expDays} day${expDays === 1 ? '' : 's'}. Add a reminder under Maintenance → Documents.`}
          </div>
        )}
        <Field label="iButton / RFID tag" error={show('tag')} hint={show('tag') ? undefined : 'Matched against attributes.driverId sent by the tracker'}>
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              icon={<Nfc className="h-4 w-4" />}
              className="font-mono"
              value={v.tag}
              invalid={!!show('tag')}
              placeholder="00000A1B2C3D"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => set('tag', e.target.value.replace(/\s/g, '').toUpperCase())}
            />
          )}
        </Field>
        <Field label="Assigned vehicle" hint="Used when no tag is read. The tag always wins.">
          {(id, d) => (
            <Select id={id} aria-describedby={d} value={v.deviceId} onChange={(e) => set('deviceId', e.target.value)}>
              <option value="">— Not assigned —</option>
              {devices.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {x.plate ? ` · ${x.plate}` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Notes">
          {(id) => <Textarea id={id} rows={3} value={v.notes} placeholder="Shift, depot, certifications…" onChange={(e) => set('notes', e.target.value)} />}
        </Field>
      </form>
      {initial ? (
        <AppLogin driver={initial} />
      ) : (
        <p className="mt-5 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[12px] text-slate-500 dark:bg-white/[0.03] dark:text-slate-400">
          <Smartphone className="mt-0.5 h-4 w-4 shrink-0" /> After saving, edit the driver to create a login for the driver app.
        </p>
      )}
    </Drawer>
  )
}

/** Driver-app login (Phase 4a): a User with role `driver` linked to this Driver. */
function AppLogin({ driver }: { driver: Driver }) {
  const qc = useQueryClient()
  const live = useDrivers().data?.find((d) => d.id === driver.id) ?? driver
  const linked = live.userId != null
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [touched, setTouched] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)
  const users = useQuery({ queryKey: qk.users, queryFn: api.users, enabled: linked, staleTime: 5 * 60_000, retry: false, meta: { silent: true } })
  const loginEmail = users.data?.find((u) => u.id === live.userId)?.email
  const emailErr = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? 'Enter a valid email' : undefined
  const pwErr = password.length < 8 ? 'At least 8 characters' : undefined
  const patch = (userId: number | null) => qc.setQueryData<Driver[]>(qk.drivers, (l) => l?.map((d) => (d.id === driver.id ? { ...d, userId } : d)))
  const create = useMutation({
    meta: { silent: true },
    mutationFn: () => api.createDriverAccount(driver.id, email.trim(), password),
    onSuccess: (u) => {
      patch(u?.id ?? -1)
      void qc.invalidateQueries({ queryKey: qk.drivers })
      toast.success(linked ? 'Driver app login updated' : 'Driver app login created', `${driver.name} can sign in with ${email.trim()}`)
      setResetting(false)
      setEmail('')
      setPassword('')
      setTouched(false)
    },
    onError: (e) => toast.error('Could not create the login', e instanceof ApiError ? e.message : String(e)),
  })
  const remove = useMutation({
    mutationFn: () => api.deleteDriverAccount(driver.id),
    onSuccess: () => {
      patch(null)
      void qc.invalidateQueries({ queryKey: qk.drivers })
      toast.success('Driver app login removed', driver.name)
      setConfirm(false)
    },
  })
  return (
    <section aria-labelledby="app-login-title" className="mt-5 rounded-xl border border-slate-200/80 p-3.5 dark:border-white/[0.07]">
      <div className="flex items-start gap-3">
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', linked ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400' : 'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400')}>
          <Smartphone className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="app-login-title" className="text-[13.5px] font-semibold text-slate-900 dark:text-white">
            App login
          </h3>
          <p className={cn('text-[12px]', linked ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400')}>
            {linked ? 'Linked — the driver can sign in to the Android driver app' : 'No login yet — create one so the driver can receive jobs on their phone'}
          </p>
        </div>
      </div>
      {linked && !resetting ? (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600 dark:bg-white/[0.03] dark:text-slate-300">
          {loginEmail && (
            <p className="mb-1">
              Signs in as <b className="font-medium text-slate-900 dark:text-white">{loginEmail}</b>
            </p>
          )}
          <p>Jobs, status updates, photos and signatures sync live.</p>
          <div className="mt-2 flex flex-wrap justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              icon={<KeyRound className="h-3.5 w-3.5" />}
              onClick={() => {
                setEmail(loginEmail ?? '')
                setPassword('')
                setTouched(false)
                setResetting(true)
              }}
            >
              Reset password
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} className="hover:!text-rose-600 dark:hover:!text-rose-400">
              Remove login
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="mt-3 space-y-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            setTouched(true)
            if (!emailErr && !pwErr) create.mutate()
          }}
        >
          <Field label="Email" error={touched ? emailErr : undefined}>
            {(id, d) => <Input id={id} aria-describedby={d} type="email" autoComplete="off" value={email} invalid={touched && !!emailErr} placeholder="ahmed.driver@somtel.so" onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Field label="Password" error={touched ? pwErr : undefined} hint={touched && pwErr ? undefined : 'Share it with the driver in person'}>
            {(id, d) => (
              <Input
                id={id}
                aria-describedby={d}
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                invalid={touched && !!pwErr}
                onChange={(e) => setPassword(e.target.value)}
                trailing={
                  <button type="button" onClick={() => setShow((x) => !x)} aria-label={show ? 'Hide password' : 'Show password'} className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-white">
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                }
              />
            )}
          </Field>
          <div className="flex justify-end gap-2">
            {resetting && (
              <Button size="sm" onClick={() => setResetting(false)}>
                Cancel
              </Button>
            )}
            <Button type="submit" size="sm" variant="primary" icon={<KeyRound className="h-3.5 w-3.5" />} loading={create.isPending}>
              {resetting ? 'Save new password' : 'Create app login'}
            </Button>
          </div>
        </form>
      )}
      <Modal
        open={confirm}
        onClose={() => !remove.isPending && setConfirm(false)}
        title={`Remove ${driver.name}’s app login?`}
        description="The driver is signed out of the app and stops receiving jobs. Their job history is kept."
        footer={
          <>
            <Button onClick={() => setConfirm(false)} disabled={remove.isPending} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
              Remove login
            </Button>
          </>
        }
      />
    </section>
  )
}

function AppBadge() {
  return (
    <span title="Has a driver-app login" className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-emerald-500/12 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
      <Smartphone className="h-2.5 w-2.5" /> App
    </span>
  )
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'warn' | 'bad' }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div
        className={cn(
          'tabular mt-1 text-[22px] font-semibold leading-none tracking-tight text-slate-900 dark:text-white',
          tone === 'warn' && 'text-amber-600 dark:text-amber-400',
          tone === 'bad' && 'text-rose-600 dark:text-rose-400',
        )}
      >
        {value}
      </div>
    </div>
  )
}

type Filter = 'all' | 'assigned' | 'expiring'

export default function DriversPage() {
  const { canManage } = useAccess()
  const qc = useQueryClient()
  const nav = useNavigate()
  const drivers = useDrivers()
  const scores = useDriverScores()
  const byId = useLive((s) => s.byId)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<Driver | null | 'new'>(null)
  const [deleting, setDeleting] = useState<Driver | null>(null)

  const list = useMemo(() => drivers.data ?? [], [drivers.data])
  const scoreOf = (d: Driver) => scores.data?.byId.get(d.id) ?? scores.data?.byName.get(d.name.toLowerCase()) ?? null
  const expiring = (d: Driver) => {
    const n = daysUntil(d.licenseExpiry)
    return n != null && n <= EXPIRY_WARN_DAYS
  }
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return list
      .filter(
        (d) =>
          (filter === 'all' || (filter === 'assigned' ? d.deviceId != null : expiring(d))) &&
          (!s ||
            d.name.toLowerCase().includes(s) ||
            d.phone?.includes(s) ||
            d.licenseNumber?.toLowerCase().includes(s) ||
            d.tag?.toLowerCase().includes(s) ||
            (d.deviceId != null && byId[d.deviceId]?.name.toLowerCase().includes(s))),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, q, filter, byId])

  const del = useMutation({
    mutationFn: (d: Driver) => api.deleteDriver(d.id),
    onSuccess: (_, d) => {
      qc.setQueryData<Driver[]>(qk.drivers, (l) => l?.filter((x) => x.id !== d.id))
      toast.success('Driver removed', d.name)
      setDeleting(null)
    },
  })

  const scored = list.map(scoreOf).filter((x): x is number => x != null)
  const avg = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null
  const expCount = list.filter(expiring).length

  const vehicle = (d: Driver) => {
    const dev = d.deviceId != null ? byId[d.deviceId] : undefined
    if (!dev) return <span className="text-slate-400">—</span>
    return (
      <button type="button" onClick={() => nav(`/live?device=${dev.id}`)} className="inline-flex max-w-full items-center gap-1.5 rounded text-left hover:text-navy-600 dark:hover:text-brand-300">
        <StatusDot status={dev.status} />
        <CategoryIcon category={dev.category} icon={dev.icon} className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span className="truncate">{dev.name}</span>
      </button>
    )
  }
  const actions = (d: Driver) => (
    <>
      <IconButton size="sm" label={`Behaviour report for ${d.name}`} onClick={() => nav(`/reports?type=driver&driverId=${d.id}`)}>
        <ChartColumn className="h-3.5 w-3.5" />
      </IconButton>
      {d.deviceId != null && (
        <IconButton size="sm" label={`Show ${d.name}’s vehicle on the map`} onClick={() => nav(`/live?device=${d.deviceId}`)}>
          <Map className="h-3.5 w-3.5" />
        </IconButton>
      )}
      {canManage && (
        <>
          <IconButton size="sm" label={`Edit ${d.name}`} onClick={() => setEditing(d)}>
            <Pencil className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton size="sm" label={`Delete ${d.name}`} onClick={() => setDeleting(d)} className="hover:!bg-rose-500/10 hover:!text-rose-500">
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </>
      )}
    </>
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 p-3 sm:p-5 lg:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight text-slate-900 dark:text-white">Drivers</h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400">Identification, licences and driving behaviour (last 30 days)</p>
          </div>
          {canManage && (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
              Add driver
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Drivers" value={drivers.isLoading ? '…' : list.length} />
          <Stat label="Assigned to a vehicle" value={drivers.isLoading ? '…' : list.filter((d) => d.deviceId != null).length} />
          <Stat label="Licences expiring ≤ 30d" value={drivers.isLoading ? '…' : expCount} tone={expCount ? 'warn' : undefined} />
          <div className="card px-4 py-3">
            <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400">Average score</div>
            <div className="mt-1.5">{avg == null ? <span className="text-[22px] font-semibold text-slate-300 dark:text-slate-600">—</span> : <ScoreBadge score={avg} showLabel className="!px-2.5 !py-1 !text-[15px]" />}</div>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-slate-200/80 p-3 dark:border-white/[0.06] sm:flex-row sm:items-center">
            <Input
              icon={<Search className="h-4 w-4" />}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, phone, licence, tag, vehicle…"
              aria-label="Search drivers"
              className="sm:max-w-xs sm:flex-1"
            />
            <Segmented<Filter>
              label="Filter drivers"
              value={filter}
              onChange={setFilter}
              className="sm:w-auto"
              options={[
                { id: 'all', label: 'All' },
                { id: 'assigned', label: 'Assigned' },
                { id: 'expiring', label: `Licence expiring${expCount ? ` (${expCount})` : ''}` },
              ]}
            />
            <span className="text-[12px] text-slate-400 sm:ml-auto">
              {rows.length} of {list.length}
            </span>
          </div>

          {drivers.isLoading ? (
            <div className="space-y-px p-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : drivers.isError ? (
            <EmptyState
              icon={<TriangleAlert className="h-5 w-5" />}
              title="Couldn’t load drivers"
              description={drivers.error instanceof Error ? drivers.error.message : undefined}
              action={<Button onClick={() => void drivers.refetch()}>Try again</Button>}
            />
          ) : list.length === 0 ? (
            <EmptyState
              icon={<IdCard className="h-5 w-5" />}
              title="No drivers yet"
              description="Add drivers to see who was behind the wheel in trips, alerts and the behaviour report."
              action={
                canManage && (
                  <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
                    Add driver
                  </Button>
                )
              }
            />
          ) : rows.length === 0 ? (
            <EmptyState icon={<SearchX className="h-5 w-5" />} title="No drivers match" description="Adjust the search or filter." />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-[13px]">
                  <thead className="bg-slate-50/80 text-left text-[12px] text-slate-500 dark:bg-white/[0.02] dark:text-slate-400">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 font-medium">Driver</th>
                      <th scope="col" className="px-4 py-2.5 font-medium">Licence</th>
                      <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">Tag</th>
                      <th scope="col" className="px-4 py-2.5 font-medium">Vehicle</th>
                      <th scope="col" className="px-4 py-2.5 font-medium">Score</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-medium"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                    {rows.map((d) => (
                      <tr key={d.id} className="group transition-colors hover:bg-slate-50/70 dark:hover:bg-white/[0.02]">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-3">
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy-700 text-[12px] font-semibold text-brand-400 dark:bg-white/[0.08] dark:text-brand-300">
                              {initials(d.name)}
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 truncate font-medium text-slate-900 dark:text-white">
                                {d.name}
                                {d.userId != null && <AppBadge />}
                              </div>
                              <div className="truncate text-[12px] text-slate-500 dark:text-slate-400">{d.phone || 'No phone'}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="text-slate-700 dark:text-slate-200">{d.licenseNumber || '—'}</div>
                          <div className="text-[12px] text-slate-500 dark:text-slate-400">
                            <LicenseExpiry date={d.licenseExpiry} />
                          </div>
                        </td>
                        <td className="hidden px-4 py-2.5 font-mono text-[12px] text-slate-600 dark:text-slate-300 lg:table-cell">{d.tag || '—'}</td>
                        <td className="max-w-[220px] px-4 py-2.5 text-slate-700 dark:text-slate-200">{vehicle(d)}</td>
                        <td className="px-4 py-2.5">
                          {scores.isLoading ? <Skeleton className="h-5 w-10 rounded-full" /> : <ScoreBadge score={scoreOf(d)} />}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end gap-0.5 opacity-70 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">{actions(d)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y divide-slate-100 dark:divide-white/[0.05] md:hidden">
                {rows.map((d) => (
                  <li key={d.id} className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-navy-700 text-[12.5px] font-semibold text-brand-400 dark:bg-white/[0.08] dark:text-brand-300">
                        {initials(d.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-slate-900 dark:text-white">{d.name}</span>
                          {d.userId != null && <AppBadge />}
                          <ScoreBadge score={scoreOf(d)} />
                        </div>
                        <div className="mt-0.5 truncate text-[12px] text-slate-500 dark:text-slate-400">{vehicle(d)}</div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 pl-[52px] text-[12px] text-slate-500 dark:text-slate-400">
                      <span className="min-w-0 truncate">
                        <LicenseExpiry date={d.licenseExpiry} compact />
                      </span>
                      <span className="-mr-1 flex shrink-0">{actions(d)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        {!canManage && (
          <p className="flex items-center gap-1.5 text-[12px] text-slate-500 dark:text-slate-400">
            <UserRound className="h-3.5 w-3.5" /> You have read-only access. Ask a manager to add or edit drivers.
          </p>
        )}
      </div>

      {editing && <DriverForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <Modal
        open={!!deleting}
        onClose={() => !del.isPending && setDeleting(null)}
        title={`Remove ${deleting?.name ?? 'driver'}?`}
        description="Past trips keep their history, but new positions will no longer be attributed to this driver."
        footer={
          <>
            <Button onClick={() => setDeleting(null)} disabled={del.isPending} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" loading={del.isPending} icon={<Trash2 className="h-4 w-4" />} onClick={() => deleting && del.mutate(deleting)}>
              Remove driver
            </Button>
          </>
        }
      />
    </div>
  )
}
