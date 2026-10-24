import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { addDays, endOfDay, startOfDay } from 'date-fns'
import { ClipboardList, Columns3, List, Map as MapIcon, Plus, RefreshCw, Search, SearchX, TriangleAlert, X } from 'lucide-react'
import type { Job, JobQuery } from '@/api/types'
import { MapCanvas } from '@/components/map/MapCanvas'
import { VehicleLayer } from '@/components/map/VehicleLayer'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { EmptyState, Skeleton } from '@/components/ui/Misc'
import { Segmented } from '@/components/ui/Tabs'
import { useDrivers } from '@/features/common/queries'
import { useAccess } from '@/lib/access'
import { useMedia } from '@/lib/useMedia'
import { readLS, writeLS } from '@/lib/storage'
import { useDeviceList, useLive } from '@/store/live'
import { useNow } from '@/store/now'
import { cn } from '@/lib/cn'
import { DriverAvatar, JobCard, JobStatusPill, LateBadge, PriorityPill, StopProgress, fmtWhen } from '@/features/dispatch/JobBits'
import { JobForm } from '@/features/dispatch/JobForm'
import { JobPanel } from '@/features/dispatch/JobPanel'
import { BOARD_COLUMNS, columnOf, isTerminal, lateBy, priorityMeta, type BoardColumnId } from '@/features/dispatch/meta'
import { JobsOverviewLayer } from '@/features/dispatch/OverviewLayer'
import { useJob, useJobs } from '@/features/dispatch/queries'
import { FitStops } from '@/features/dispatch/StopsLayer'

type Range = 'today' | 'tomorrow' | 'week' | 'all'
type View = 'board' | 'list' | 'map'

function rangeOf(r: Range): { from?: string; to?: string } {
  const now = new Date()
  switch (r) {
    case 'today':
      return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() }
    case 'tomorrow': {
      const t = addDays(now, 1)
      return { from: startOfDay(t).toISOString(), to: endOfDay(t).toISOString() }
    }
    case 'week':
      return { from: startOfDay(now).toISOString(), to: endOfDay(addDays(now, 6)).toISOString() }
    default:
      return {}
  }
}

function Stat({ label, value, tone, onClick, active }: { label: string; value: ReactNode; tone?: 'bad' | 'gold'; onClick?: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'min-w-[104px] shrink-0 rounded-xl border px-3 py-2 text-left transition-colors',
        active ? 'border-brand-500 bg-brand-500/10 dark:bg-brand-400/10' : 'border-slate-200/80 bg-white hover:border-slate-300 dark:border-white/[0.06] dark:bg-ink-900 dark:hover:border-white/15',
      )}
    >
      <div className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div
        className={cn(
          'tabular mt-0.5 text-[18px] font-semibold leading-tight tracking-tight text-slate-900 dark:text-white',
          tone === 'bad' && 'text-rose-600 dark:text-rose-400',
          tone === 'gold' && 'text-navy-700 dark:text-brand-300',
        )}
      >
        {value}
      </div>
    </button>
  )
}

/** Below xl the job opens over the page: right sheet on tablets, full screen on phones. */
function JobSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[role="dialog"]') && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 hidden animate-fade-in bg-slate-950/40 backdrop-blur-[2px] md:block" onClick={onClose} />
      <section
        aria-label="Job details"
        className="absolute inset-0 flex animate-slide-in-right flex-col overflow-hidden bg-white pb-[env(safe-area-inset-bottom)] shadow-panel dark:bg-ink-900 md:inset-y-0 md:left-auto md:right-0 md:w-[480px] md:border-l md:border-slate-200 md:dark:border-white/10"
      >
        {children}
      </section>
    </div>,
    document.body,
  )
}

export default function DispatchPage() {
  const { canManage } = useAccess()
  const [params, setParams] = useSearchParams()
  const now = useNow()
  const xl = useMedia('(min-width: 1280px)')
  const md = useMedia('(min-width: 768px)')
  const [range, setRange] = useState<Range>(() => (['today', 'tomorrow', 'week', 'all'].includes(readLS('fleet.dispatch.range') ?? '') ? (readLS('fleet.dispatch.range') as Range) : 'today'))
  const [view, setView] = useState<View>(() => {
    const v = readLS('fleet.dispatch.view')
    return v === 'list' || v === 'map' ? v : 'board'
  })
  const [driverId, setDriverId] = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [q, setQ] = useState('')
  const [lateOnly, setLateOnly] = useState(false)
  const [phoneCol, setPhoneCol] = useState<BoardColumnId>('active')
  const [form, setForm] = useState<Job | 'new' | null>(params.get('new') === '1' && canManage ? 'new' : null)
  const drivers = useDrivers()
  const devices = useDeviceList()
  const byId = useLive((s) => s.byId)

  useEffect(() => writeLS('fleet.dispatch.range', range), [range])
  useEffect(() => writeLS('fleet.dispatch.view', view), [view])
  useEffect(() => {
    if (params.get('new') === '1') {
      if (canManage) setForm('new')
      const p = new URLSearchParams(params)
      p.delete('new')
      setParams(p, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('new')])

  const query: JobQuery = useMemo(
    () => ({ ...rangeOf(range), driverId: driverId ? Number(driverId) : undefined, deviceId: deviceId ? Number(deviceId) : undefined }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [range, driverId, deviceId, Math.floor(now / 3600e3)],
  )
  const jobsQ = useJobs(query)
  const all = useMemo(() => jobsQ.data ?? [], [jobsQ.data])
  const jobs = useMemo(() => {
    const s = q.trim().toLowerCase()
    return all
      .filter(
        (j) =>
          (!driverId || String(j.driverId) === driverId) &&
          (!deviceId || String(j.deviceId) === deviceId) &&
          (!lateOnly || lateBy(j, now) != null) &&
          (!s ||
            j.reference.toLowerCase().includes(s) ||
            j.title.toLowerCase().includes(s) ||
            j.customerName?.toLowerCase().includes(s) ||
            j.stops.some((x) => x.name.toLowerCase().includes(s) || x.address?.toLowerCase().includes(s))),
      )
      .sort((a, b) => {
        const la = lateBy(a, now) != null ? 1 : 0
        const lb = lateBy(b, now) != null ? 1 : 0
        if (la !== lb) return lb - la
        const p = priorityMeta(b.priority).rank - priorityMeta(a.priority).rank
        if (p) return p
        return (a.dueBy ?? a.scheduledStart ?? a.createdAt).localeCompare(b.dueBy ?? b.scheduledStart ?? b.createdAt)
      })
  }, [all, q, driverId, deviceId, lateOnly, now])

  const selectedId = params.get('job') ? Number(params.get('job')) : null
  const fromList = all.find((j) => j.id === selectedId)
  const jobQ = useJob(selectedId, fromList)
  const selected = jobQ.data ?? fromList ?? null
  const select = (id: number | null) => {
    const p = new URLSearchParams(params)
    if (id == null) p.delete('job')
    else p.set('job', String(id))
    setParams(p, { replace: true })
  }

  const byCol = useMemo(() => {
    const m = new Map<BoardColumnId, Job[]>()
    for (const c of BOARD_COLUMNS) m.set(c.id, [])
    for (const j of jobs) m.get(columnOf(j.status))!.push(j)
    return m
  }, [jobs])
  const lateCount = all.filter((j) => lateBy(j, now) != null).length
  const active = all.filter((j) => columnOf(j.status) === 'active').length
  const driverOf = (j: Job) => drivers.data?.find((d) => d.id === j.driverId)
  const deviceOf = (j: Job) => {
    const id = j.deviceId ?? driverOf(j)?.deviceId
    return id != null ? byId[id] : undefined
  }
  const filtered = !!(q || driverId || deviceId || lateOnly)

  const panel = selected && (
    <JobPanel key={selected.id} job={selected} layout={xl ? 'pane' : 'sheet'} onClose={() => select(null)} onEdit={() => setForm(selected)} />
  )

  const overviewDevices = useMemo(
    () => jobs.filter((j) => !isTerminal(j.status)).map(deviceOf).filter((d): d is NonNullable<typeof d> => !!d),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobs, byId, drivers.data],
  )

  const overviewPoints = useMemo(() => {
    const pts = jobs
      .filter((j) => !isTerminal(j.status) && j.stops.length)
      .map((j) => {
        const st = j.stops.find((x) => x.status === 'pending' || x.status === 'arrived') ?? j.stops[j.stops.length - 1]
        return [st.lng, st.lat] as [number, number]
      })
    if (pts.length < 3) return pts
    const med = (a: number[]) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)]
    const mx = med(pts.map((p) => p[0]))
    const my = med(pts.map((p) => p[1]))
    return pts.filter(([x, y]) => Math.abs(x - mx) < 0.6 && Math.abs(y - my) < 0.6)
  }, [jobs])

  const card = (j: Job, showStatus = false) => (
    <JobCard key={j.id} job={j} driver={driverOf(j)} device={deviceOf(j)} now={now} selected={j.id === selectedId} onClick={() => select(j.id)} showStatus={showStatus} />
  )

  const body = jobsQ.isLoading ? (
    <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-36 rounded-xl" />
      ))}
    </div>
  ) : jobsQ.isError ? (
    <EmptyState
      icon={<TriangleAlert className="h-5 w-5" />}
      title="Couldn’t load jobs"
      description={jobsQ.error instanceof Error ? jobsQ.error.message : undefined}
      action={
        <Button icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void jobsQ.refetch()}>
          Try again
        </Button>
      }
      className="flex-1"
    />
  ) : all.length === 0 ? (
    <EmptyState
      icon={<ClipboardList className="h-5 w-5" />}
      title={range === 'all' ? 'No jobs yet' : 'No jobs in this period'}
      description={canManage ? 'Create a job with one or more stops, assign a driver and follow it live.' : 'Dispatchers create jobs here; you’ll see them as they arrive.'}
      action={
        canManage && (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setForm('new')}>
            New job
          </Button>
        )
      }
      className="flex-1"
    />
  ) : jobs.length === 0 ? (
    <EmptyState icon={<SearchX className="h-5 w-5" />} title="No jobs match" description="Adjust the search or filters." className="flex-1" />
  ) : !md ? (
    // phone: status tabs + cards
    <div className="flex flex-col">
      <div role="tablist" aria-label="Job status" className="sticky top-0 z-10 flex shrink-0 gap-1.5 overflow-x-auto bg-[var(--app-bg)] px-3 py-2">
        {BOARD_COLUMNS.map((c) => {
          const n = byCol.get(c.id)!.length
          const on = phoneCol === c.id
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setPhoneCol(c.id)}
              className={cn(
                'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium',
                on ? 'border-navy-700 bg-navy-700 text-white dark:border-brand-500 dark:bg-brand-500 dark:text-navy-900' : 'border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300',
              )}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
              {c.label}
              <span className="tabular text-[11px] opacity-70">{n}</span>
            </button>
          )
        })}
      </div>
      <div className="space-y-2 px-3 pb-3">
        {byCol.get(phoneCol)!.length ? (
          byCol.get(phoneCol)!.map((j) => card(j, phoneCol === 'active' || phoneCol === 'closed'))
        ) : (
          <p className="py-10 text-center text-[12.5px] text-slate-500">{BOARD_COLUMNS.find((c) => c.id === phoneCol)!.empty}</p>
        )}
      </div>
    </div>
  ) : view === 'map' ? (
    <div className="relative mx-3 mb-3 min-h-[420px] flex-1 overflow-hidden rounded-2xl border border-slate-200/80 dark:border-white/[0.06] sm:mx-5 lg:mx-6">
      <MapCanvas className="absolute inset-0">
        <VehicleLayer devices={overviewDevices} cluster={false} hover />
        <JobsOverviewLayer jobs={jobs} now={now} onSelect={select} />
        <FitStops points={overviewPoints} fitKey={`${range}:${driverId}:${deviceId}:${overviewPoints.length > 0}`} padding={70} maxZoom={14} />
      </MapCanvas>
      <div className="glass pointer-events-none absolute bottom-3 left-3 max-w-[300px] rounded-xl px-3 py-2">
        <p className="text-[12.5px] font-semibold text-slate-900 dark:text-white">Open jobs · next stop</p>
        <p className="text-[11.5px] text-slate-500 dark:text-slate-400">Pins show the job number and the stop it is heading to. Red ring = late.</p>
      </div>
    </div>
  ) : view === 'board' ? (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-3 pb-3 sm:px-5 lg:px-6">
      {BOARD_COLUMNS.map((c) => {
        const list = byCol.get(c.id)!
        return (
          <section key={c.id} aria-label={c.label} className="flex min-h-0 w-[264px] min-w-[248px] flex-1 flex-col rounded-2xl bg-slate-100/80 dark:bg-white/[0.025]">
            <header className="flex items-center gap-2 px-3 pb-2 pt-3">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
              <h3 className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-100">{c.label}</h3>
              <span className="tabular rounded-full bg-white px-1.5 text-[11px] font-semibold text-slate-500 shadow-soft dark:bg-white/10 dark:text-slate-300">{list.length}</span>
              {c.id === 'unassigned' && canManage && (
                <button
                  type="button"
                  aria-label="New job"
                  onClick={() => setForm('new')}
                  className="ml-auto grid h-6 w-6 place-items-center rounded-md text-slate-500 hover:bg-white hover:text-slate-900 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}
            </header>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
              {list.length ? list.map((j) => card(j, c.id === 'active' || c.id === 'closed')) : <p className="px-2 py-6 text-center text-[12px] text-slate-400">{c.empty}</p>}
            </div>
          </section>
        )
      })}
    </div>
  ) : (
    <div className="min-h-0 flex-1 overflow-auto px-3 pb-3 sm:px-5 lg:px-6">
      <div className="card overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50/80 text-left text-[12px] text-slate-500 dark:bg-white/[0.02] dark:text-slate-400">
            <tr>
              <th className="px-4 py-2.5 font-medium">Job</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Driver · vehicle</th>
              <th className="px-3 py-2.5 font-medium">Stops</th>
              <th className="px-3 py-2.5 font-medium">Due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
            {jobs.map((j) => {
              const late = lateBy(j, now)
              const drv = driverOf(j)
              const dev = deviceOf(j)
              return (
                <tr
                  key={j.id}
                  onClick={() => select(j.id)}
                  className={cn('cursor-pointer transition-colors hover:bg-slate-50/70 dark:hover:bg-white/[0.02]', j.id === selectedId && 'bg-brand-500/[0.07]', late != null && 'bg-rose-500/[0.04]')}
                >
                  <td className="max-w-[340px] px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] font-semibold text-slate-400">{j.reference}</span>
                      <PriorityPill priority={j.priority} hideNormal />
                    </div>
                    <div className="truncate font-medium text-slate-900 dark:text-white">{j.title}</div>
                    {j.customerName && <div className="truncate text-[12px] text-slate-500">{j.customerName}</div>}
                  </td>
                  <td className="px-3 py-2.5">
                    <JobStatusPill status={j.status} />
                  </td>
                  <td className="hidden px-3 py-2.5 lg:table-cell">
                    <div className="flex items-center gap-2">
                      <DriverAvatar name={drv?.name} />
                      <div className="min-w-0">
                        <div className="truncate text-slate-800 dark:text-slate-100">{drv?.name ?? <span className="text-slate-400">Unassigned</span>}</div>
                        <div className="truncate text-[11.5px] text-slate-500">{dev?.name ?? '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <StopProgress job={j} />
                  </td>
                  <td className="tabular whitespace-nowrap px-3 py-2.5">
                    {late != null ? <LateBadge minutes={late} /> : <span className="text-slate-600 dark:text-slate-300">{fmtWhen(j.dueBy)}</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col max-md:overflow-y-auto">
        {/* header */}
        <div className="shrink-0 space-y-3 px-3 pb-3 pt-3 sm:px-5 sm:pt-5 lg:px-6">
          <div className="flex items-center justify-between gap-3 sm:items-end">
            <div className="min-w-0">
              <h1 className="text-[20px] font-semibold tracking-tight text-slate-900 dark:text-white">Dispatch</h1>
              <p className="hidden text-[13px] text-slate-500 dark:text-slate-400 sm:block">Jobs, stops and proof of delivery — updated live from the driver app</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden md:block">
                <Segmented<View>
                  label="View"
                  value={view}
                  onChange={setView}
                  options={[
                    { id: 'board', label: <span className="inline-flex items-center gap-1.5"><Columns3 className="h-3.5 w-3.5" /> Board</span> },
                    { id: 'list', label: <span className="inline-flex items-center gap-1.5"><List className="h-3.5 w-3.5" /> List</span> },
                    { id: 'map', label: <span className="inline-flex items-center gap-1.5"><MapIcon className="h-3.5 w-3.5" /> Map</span> },
                  ]}
                />
              </span>
              {canManage && (
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setForm('new')}>
                  New job
                </Button>
              )}
            </div>
          </div>
          <div className="-mx-3 flex gap-2 overflow-x-auto px-3 sm:mx-0 sm:px-0">
            <Stat label="Jobs" value={jobsQ.isLoading ? '…' : all.length} />
            <Stat label="Unassigned" value={byCol.get('unassigned')!.length} onClick={() => (setPhoneCol('unassigned'), setLateOnly(false))} />
            <Stat label="On the road" value={active} tone="gold" onClick={() => (setPhoneCol('active'), setLateOnly(false))} />
            <Stat label="Late" value={lateCount} tone={lateCount ? 'bad' : undefined} active={lateOnly} onClick={() => setLateOnly((x) => !x)} />
            <Stat label="Completed" value={all.filter((j) => j.status === 'completed').length} onClick={() => setPhoneCol('completed')} />
          </div>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <Segmented<Range>
              label="Period"
              value={range}
              onChange={setRange}
              className="lg:w-auto lg:shrink-0"
              options={[
                { id: 'today', label: 'Today' },
                { id: 'tomorrow', label: 'Tomorrow' },
                { id: 'week', label: '7 days' },
                { id: 'all', label: 'All' },
              ]}
            />
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-1 sm:items-center">
              <Input
                icon={<Search className="h-4 w-4" />}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search ref, title, customer, stop…"
                aria-label="Search jobs"
                className="col-span-2 sm:min-w-[200px] sm:flex-1"
              />
              <Select aria-label="Driver" value={driverId} onChange={(e) => setDriverId(e.target.value)} className="sm:w-44">
                <option value="">All drivers</option>
                {drivers.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
              <Select aria-label="Vehicle" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className="sm:w-44">
                <option value="">All vehicles</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
              {filtered && (
                <Button
                  variant="ghost"
                  icon={<X className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setQ('')
                    setDriverId('')
                    setDeviceId('')
                    setLateOnly(false)
                  }}
                  className="col-span-2 sm:col-span-1"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        </div>
        {jobsQ.isFetching && !jobsQ.isLoading && <div className="h-0.5 shrink-0 animate-pulse bg-brand-500" />}
        {body}
      </div>

      {/* right pane (xl): the selected job */}
      {xl && panel && (
        <aside className="flex w-[460px] shrink-0 animate-slide-in-right flex-col border-l border-slate-200/80 bg-white dark:border-white/[0.06] dark:bg-ink-900">{panel}</aside>
      )}
      {!xl && selected && <JobSheet onClose={() => select(null)}>{panel}</JobSheet>}

      {form && (
        <JobForm
          key={form === 'new' ? 'new' : form.id}
          initial={form === 'new' ? null : form}
          onClose={() => setForm(null)}
          onSaved={(j) => {
            setForm(null)
            select(j.id)
          }}
        />
      )}
    </div>
  )
}
