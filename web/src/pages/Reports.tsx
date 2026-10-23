import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { subMinutes, addMinutes, startOfDay, endOfDay } from 'date-fns'
import {
  CalendarClock,
  ChevronDown,
  FileDown,
  FileSpreadsheet,
  FileText,
  FileX2,
  RefreshCw,
  Search,
  SearchX,
  TriangleAlert,
  X,
} from 'lucide-react'
import { api, ApiError, downloadReport, qk } from '@/api/client'
import { EXPENSE_CATEGORIES, type Report, type ReportQuery, type ReportRow, type ReportType, type ReportValue } from '@/api/types'
import { Button, IconButton } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { EmptyState, Skeleton } from '@/components/ui/Misc'
import { ScoreBadge } from '@/components/ui/Badges'
import { DeviceMultiSelect } from '@/features/common/DeviceMultiSelect'
import { useCurrency, useDrivers, useGroups } from '@/features/common/queries'
import { REPORTS, REPORT_GROUPS, reportDef, type ReportDef } from '@/features/reports/catalog'
import { ReportTable } from '@/features/reports/ReportTable'
import { aggregate, fmtValue } from '@/features/reports/format'
import { MAX_RANGE_DAYS, PERIOD_PRESETS, fmtPeriod, presetRange, toLocalInput, type PeriodPreset } from '@/features/reports/period'
import { expenseMeta } from '@/lib/ops'
import { fmtMoney } from '@/lib/format'
import { readLS, writeLS } from '@/lib/storage'
import { toast } from '@/store/toast'
import { cn } from '@/lib/cn'

interface Filters {
  type: ReportType
  deviceIds: number[]
  groupId: number | null
  driverId: number | null
  preset: PeriodPreset
  custom: [string, string]
}

const LS_KEY = 'fleet.reports.filters'

/** Stored filters, overridden by deep-link params (?type=&driverId=&deviceId=). */
function initialFilters(): Filters {
  const f = loadFilters()
  const sp = new URLSearchParams(window.location.search)
  const t = reportDef(sp.get('type'))?.type
  if (t) f.type = t
  if (sp.get('driverId')) f.driverId = Number(sp.get('driverId'))
  if (sp.get('deviceId')) f.deviceIds = [Number(sp.get('deviceId'))]
  return f
}

function loadFilters(): Filters {
  const [a, b] = presetRange('7d')
  const base: Filters = { type: 'summary', deviceIds: [], groupId: null, driverId: null, preset: 'today', custom: [toLocalInput(a), toLocalInput(b)] }
  try {
    const raw = readLS(LS_KEY)
    if (!raw) return base
    const s = JSON.parse(raw) as Partial<Filters>
    return {
      type: reportDef(s.type)?.type ?? base.type,
      deviceIds: Array.isArray(s.deviceIds) ? s.deviceIds.filter((x) => typeof x === 'number') : [],
      groupId: typeof s.groupId === 'number' ? s.groupId : null,
      driverId: typeof s.driverId === 'number' ? s.driverId : null,
      preset: PERIOD_PRESETS.some((p) => p.id === s.preset) ? s.preset! : base.preset,
      custom: Array.isArray(s.custom) && s.custom.length === 2 ? (s.custom as [string, string]) : base.custom,
    }
  } catch {
    return base
  }
}

const num = (v: ReportValue) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: ReportValue) => (typeof v === 'string' && v ? v : null)

/** Where a row click goes (Live Map at the spot, History over the span…). null = not clickable. */
function rowTarget(type: string, r: ReportRow, rep: Report): { to: string; hint: string } | null {
  const dev = num(r.deviceId)
  const lat = num(r.lat) ?? num(r.startLat)
  const lng = num(r.lng) ?? num(r.startLng)
  const start = str(r.start) ?? str(r.on) ?? str(r.enter)
  const end = str(r.end) ?? str(r.off) ?? str(r.exit)
  const time = str(r.time)
  const hist = (from: string | Date, to: string | Date) =>
    `/history?device=${dev}&from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`
  switch (type) {
    case 'overspeed':
    case 'alerts':
      if (dev != null && lat != null && lng != null)
        return { to: `/live?device=${dev}&at=${lat},${lng}&evt=${type === 'alerts' ? (str(r.type) ?? 'alarm') : 'overspeed'}`, hint: 'Show where it happened on the Live Map' }
      if (dev != null && time) return { to: hist(subMinutes(new Date(time), 15), addMinutes(new Date(time), 15)), hint: 'Replay in History' }
      return null
    case 'stops':
    case 'idle':
      if (dev != null && start) return { to: hist(subMinutes(new Date(start), 20), addMinutes(new Date(end ?? start), 20)), hint: 'Replay around this stop in History' }
      return null
    case 'trips':
    case 'ignition':
    case 'geofence':
      if (dev != null && start) return { to: hist(start, end ?? rep.to), hint: 'Replay this span in History' }
      return null
    case 'daily': {
      const d = str(r.date)
      if (dev != null && d) {
        const day = new Date(`${d.slice(0, 10)}T00:00:00`)
        return { to: hist(startOfDay(day), endOfDay(day)), hint: 'Replay this day in History' }
      }
      return null
    }
    case 'driver': {
      const drv = num(r.driverId)
      if (drv != null) return { to: `/reports?type=trips&driverId=${drv}`, hint: 'Show this driver’s trips' }
      if (dev != null) return { to: hist(rep.from, rep.to), hint: 'Replay in History' }
      return null
    }
    case 'maintenance':
      return { to: `/maintenance?tab=schedules${dev != null ? `&device=${dev}` : ''}`, hint: 'Open maintenance' }
    case 'expenses':
      return { to: `/maintenance?tab=expenses${dev != null ? `&device=${dev}` : ''}`, hint: 'Open expenses' }
    default:
      if (dev != null) return { to: hist(rep.from, rep.to), hint: 'Replay the period in History' }
      return null
  }
}

function Catalogue({ value, onPick, autoFocus }: { value: ReportType; onPick: (t: ReportType) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState('')
  const s = q.trim().toLowerCase()
  const list = s ? REPORTS.filter((r) => `${r.label} ${r.group} ${r.description}`.toLowerCase().includes(s)) : REPORTS
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="p-3">
        <Input
          icon={<Search className="h-4 w-4" />}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Quick search reports"
          aria-label="Quick search reports"
          data-autofocus={autoFocus || undefined}
          trailing={
            q ? (
              <button type="button" aria-label="Clear" onClick={() => setQ('')} className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:text-slate-700 dark:hover:text-white">
                <X className="h-3.5 w-3.5" />
              </button>
            ) : undefined
          }
        />
      </div>
      <nav aria-label="Report catalogue" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {list.length === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-slate-500">No report matches “{q}”</p>}
        {REPORT_GROUPS.map((g) => {
          const items = list.filter((r) => r.group === g)
          if (!items.length) return null
          return (
            <div key={g} className="mb-2">
              <p className="label-xs px-3 pb-1 pt-2 !text-[10.5px]">{g}</p>
              <ul className="space-y-0.5">
                {items.map((r) => {
                  const on = r.type === value
                  return (
                    <li key={r.type}>
                      <button
                        type="button"
                        aria-current={on || undefined}
                        onClick={() => onPick(r.type)}
                        className={cn(
                          'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors',
                          on
                            ? 'bg-brand-500/15 text-navy-800 dark:bg-brand-400/[0.13] dark:text-brand-100'
                            : 'text-slate-600 hover:bg-slate-900/[0.04] hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.05] dark:hover:text-white',
                        )}
                      >
                        <span
                          className={cn(
                            'grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors',
                            on ? 'bg-brand-500 text-navy-900' : 'bg-slate-100 text-slate-500 group-hover:text-slate-700 dark:bg-white/[0.06] dark:text-slate-400 dark:group-hover:text-slate-200',
                          )}
                        >
                          <r.icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{r.label}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>
    </div>
  )
}

function KpiChip({ label, value, accent }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div
      className={cn(
        'min-w-[118px] shrink-0 rounded-xl border px-3 py-2',
        accent
          ? 'border-brand-500/40 bg-brand-500/10 dark:border-brand-400/25 dark:bg-brand-400/[0.08]'
          : 'border-slate-200/80 bg-white dark:border-white/[0.06] dark:bg-ink-900',
      )}
    >
      <div className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className="tabular mt-0.5 truncate text-[16px] font-semibold tracking-tight text-slate-900 dark:text-white">{value}</div>
    </div>
  )
}

const ROW_NOUN: Partial<Record<ReportType, string>> = {
  summary: 'Vehicles',
  daily: 'Vehicle days',
  trips: 'Trips',
  stops: 'Stops',
  idle: 'Idle periods',
  ignition: 'Ignition spans',
  overspeed: 'Overspeeds',
  geofence: 'Visits',
  alerts: 'Alerts',
  driver: 'Drivers',
  maintenance: 'Items',
  expenses: 'Expenses',
  systemLog: 'Trackers',
}

function Kpis({ def, report, currency }: { def: ReportDef; report: Report; currency: string }) {
  const chips: ReactNode[] = [<KpiChip key="n" label={ROW_NOUN[def.type] ?? 'Rows'} value={report.rows.length.toLocaleString()} />]
  for (const key of def.kpis ?? []) {
    const col = report.columns.find((c) => c.key === key)
    if (!col) continue
    const v = aggregate(key, col, report.rows, report.totals)
    if (v == null) continue
    const label = key === 'score' ? 'Fleet score' : key === 'maxSpeed' ? 'Top speed' : col.label
    chips.push(
      <KpiChip
        key={key}
        label={label}
        accent={key === 'score' || key === 'distance' || key === 'amount'}
        value={key === 'score' ? <ScoreBadge score={v} showLabel className="!text-[13px]" /> : fmtValue(col, v, currency)}
      />,
    )
  }
  // expenses: totals per category (flat keys or a nested object)
  if (def.type === 'expenses' && report.totals) {
    const t = report.totals as Record<string, unknown>
    const nested = (t.byCategory ?? t.categories) as Record<string, unknown> | undefined
    const src = nested && typeof nested === 'object' ? nested : t
    for (const c of EXPENSE_CATEGORIES) {
      const v = src[c]
      if (typeof v !== 'number' || !v) continue
      const m = expenseMeta(c)
      chips.push(
        <KpiChip
          key={`cat-${c}`}
          label={m.label}
          value={
            <span className="inline-flex items-center gap-1.5">
              <m.icon className="h-3.5 w-3.5" style={{ color: m.color }} />
              {fmtMoney(v, currency)}
            </span>
          }
        />,
      )
    }
  }
  if (chips.length < 2) return null
  return <div className="-mx-3 flex shrink-0 gap-2 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:px-0">{chips}</div>
}

function ExportMenu({ type, query, disabled }: { type: ReportType; query: ReportQuery; disabled: boolean }) {
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (fmt: 'csv' | 'xlsx' | 'pdf', close: () => void) => {
    close()
    setBusy(fmt)
    try {
      const name = await downloadReport(type, query, fmt)
      toast.success('Export ready', name)
    } catch (e) {
      toast.error('Export failed', e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <Menu
      className="w-64"
      trigger={({ open, toggle }) => (
        <Button
          variant="primary"
          icon={busy ? undefined : <FileDown className="h-4 w-4" />}
          loading={!!busy}
          disabled={disabled}
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          Export
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
        </Button>
      )}
    >
      {(close) => (
        <>
          <p className="label-xs px-2.5 pb-1 pt-1 !text-[10px]">Download this report as</p>
          <MenuItem
            icon={<FileText className="text-sky-500" />}
            title="CSV"
            text="Comma-separated, any spreadsheet"
            onClick={() => void run('csv', close)}
          />
          <MenuItem
            icon={<FileSpreadsheet className="text-emerald-500" />}
            title="Excel"
            text=".xlsx with formatted columns"
            onClick={() => void run('xlsx', close)}
          />
          <MenuItem
            icon={<FileDown className="text-rose-500" />}
            title="PDF"
            text="Somtel-branded, landscape A4"
            onClick={() => void run('pdf', close)}
          />
        </>
      )}
    </Menu>
  )
}

export default function ReportsPage() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const [f, setF] = useState<Filters>(initialFilters)
  const [tick, setTick] = useState(0)
  const [pickerOpen, setPickerOpen] = useState(false)
  const groups = useGroups()
  const drivers = useDrivers()
  const currency = useCurrency()
  const def = reportDef(f.type) ?? REPORTS[0]

  // deep links: /reports?type=trips&driverId=3&deviceId=4
  const paramKey = params.toString()
  useEffect(() => {
    const t = reportDef(params.get('type'))?.type
    const drv = params.get('driverId')
    const dev = params.get('deviceId')
    if (!t && !drv && !dev) return
    setF((s) => ({
      ...s,
      type: t ?? s.type,
      driverId: drv ? Number(drv) : s.driverId,
      deviceIds: dev ? [Number(dev)] : s.deviceIds,
    }))
    if (drv || dev) setParams(t ? { type: t } : {}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramKey])

  useEffect(() => {
    writeLS(LS_KEY, JSON.stringify(f))
    if (params.get('type') !== f.type && !params.get('driverId') && !params.get('deviceId')) setParams({ type: f.type }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f])

  const [from, to] = useMemo(() => {
    if (f.preset === 'custom') {
      const a = new Date(f.custom[0])
      const b = new Date(f.custom[1])
      return [Number.isNaN(a.getTime()) ? '' : a.toISOString(), Number.isNaN(b.getTime()) ? '' : b.toISOString()]
    }
    const [a, b] = presetRange(f.preset)
    return [a.toISOString(), b.toISOString()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.preset, f.custom, tick])
  const rangeError = !from || !to || from >= to ? '“From” must be before “To”.' : Date.parse(to) - Date.parse(from) > MAX_RANGE_DAYS * 86400e3 ? `Reports can cover at most ${MAX_RANGE_DAYS} days.` : null

  const query: ReportQuery = useMemo(
    () => ({ deviceIds: f.deviceIds, groupId: f.groupId ?? undefined, driverId: f.driverId ?? undefined, from, to }),
    [f.deviceIds, f.groupId, f.driverId, from, to],
  )
  const report = useQuery({
    queryKey: qk.report(f.type, query),
    queryFn: () => api.report(f.type, query),
    enabled: !rangeError,
    meta: { silent: true },
    staleTime: 60_000,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === f.type ? prev : undefined),
  })

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((s) => ({ ...s, [k]: v }))
  const pick = (type: ReportType) => {
    setF((s) => ({ ...s, type }))
    setPickerOpen(false)
  }
  const activeFilters = f.deviceIds.length + (f.groupId != null ? 1 : 0) + (f.driverId != null ? 1 : 0)
  const data = report.data
  const fetching = report.isFetching

  return (
    <div className="flex h-full min-h-0">
      {/* catalogue (desktop) */}
      <aside className="hidden w-[248px] shrink-0 flex-col border-r border-slate-200/80 bg-white dark:border-white/[0.06] dark:bg-ink-900 lg:flex">
        <div className="px-4 pb-0 pt-4">
          <h1 className="text-[16px] font-semibold tracking-tight text-slate-900 dark:text-white">Reports</h1>
          <p className="text-[12px] text-slate-500 dark:text-slate-400">{REPORTS.length} reports · CSV, Excel & PDF</p>
        </div>
        <Catalogue value={f.type} onPick={pick} />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3 sm:p-4 lg:overflow-hidden lg:p-5">
        {/* header */}
        <div className="flex shrink-0 flex-wrap items-start gap-3">
          <span className="hidden h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-500 text-navy-900 shadow-sm sm:grid">
            <def.icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex max-w-full items-center gap-1.5 rounded-lg text-left lg:pointer-events-none"
              aria-label="Choose report"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-500 text-navy-900 sm:hidden">
                <def.icon className="h-3.5 w-3.5" />
              </span>
              <h2 className="truncate text-[18px] font-semibold tracking-tight text-slate-900 dark:text-white">
                {data?.title || def.label}
              </h2>
              <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 lg:hidden" />
            </button>
            <p className="mt-0.5 line-clamp-2 text-[12.5px] text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-600 dark:text-slate-300">{def.group}</span> · {data?.subtitle || def.description}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <IconButton
              label="Refresh report"
              onClick={() => {
                setTick((t) => t + 1)
                void report.refetch()
              }}
            >
              <RefreshCw className={cn('h-4 w-4', fetching && 'animate-spin')} />
            </IconButton>
            <ExportMenu type={f.type} query={query} disabled={!!rangeError} />
          </div>
        </div>

        {/* filter bar */}
        <div className="card flex shrink-0 flex-col gap-2.5 p-2.5 sm:p-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <DeviceMultiSelect value={f.deviceIds} onChange={(ids) => set('deviceIds', ids)} />
            <Select
              aria-label="Group"
              value={f.groupId ?? ''}
              onChange={(e) => set('groupId', e.target.value ? Number(e.target.value) : null)}
              disabled={!groups.data?.length}
            >
              <option value="">All groups</option>
              {groups.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Driver"
              value={f.driverId ?? ''}
              onChange={(e) => set('driverId', e.target.value ? Number(e.target.value) : null)}
              disabled={!drivers.data?.length}
            >
              <option value="">All drivers</option>
              {drivers.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            {activeFilters > 0 ? (
              <Button variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => setF((s) => ({ ...s, deviceIds: [], groupId: null, driverId: null }))}>
                Clear {activeFilters}
              </Button>
            ) : (
              <span className="hidden xl:block" />
            )}
          </div>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div role="group" aria-label="Period" className="-mx-0.5 flex gap-0.5 overflow-x-auto rounded-lg bg-slate-100 p-0.5 dark:bg-white/[0.05] lg:shrink-0">
              {PERIOD_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={f.preset === p.id}
                  onClick={() => {
                    set('preset', p.id)
                    setTick((t) => t + 1)
                  }}
                  className={cn(
                    'h-8 shrink-0 whitespace-nowrap rounded-md px-3 text-[12.5px] font-medium transition-colors',
                    f.preset === p.id
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-white/15 dark:text-white'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {f.preset === 'custom' ? (
              <div className="flex animate-fade-in flex-wrap items-center gap-2">
                <Input
                  type="datetime-local"
                  aria-label="From"
                  value={f.custom[0]}
                  max={f.custom[1]}
                  onChange={(e) => set('custom', [e.target.value, f.custom[1]])}
                  className="min-w-0 flex-1 sm:w-[200px] sm:flex-none dark:[&_input]:[color-scheme:dark]"
                />
                <span className="text-slate-400">→</span>
                <Input
                  type="datetime-local"
                  aria-label="To"
                  value={f.custom[1]}
                  min={f.custom[0]}
                  onChange={(e) => set('custom', [f.custom[0], e.target.value])}
                  className="min-w-0 flex-1 sm:w-[200px] sm:flex-none dark:[&_input]:[color-scheme:dark]"
                />
              </div>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-500 dark:text-slate-400 lg:ml-1">
                <CalendarClock className="h-3.5 w-3.5" />
                <span className="tabular">{fmtPeriod(from, to)}</span>
              </span>
            )}
            {rangeError && <p className="text-[12px] font-medium text-rose-500">{rangeError}</p>}
          </div>
        </div>

        {data && !report.isError && <Kpis def={def} report={data} currency={currency} />}

        {/* table */}
        <div className="card relative flex min-h-[420px] shrink-0 flex-1 flex-col lg:shrink overflow-hidden lg:min-h-0">
          {fetching && data && <div className="absolute inset-x-0 top-0 z-40 h-0.5 animate-pulse bg-brand-500" />}
          {rangeError ? (
            <EmptyState icon={<CalendarClock className="h-5 w-5" />} title="Choose a valid period" description={rangeError} className="flex-1" />
          ) : report.isLoading ? (
            <div className="space-y-px p-3">
              <Skeleton className="mb-2 h-9 w-full rounded-lg" />
              {Array.from({ length: 9 }, (_, i) => (
                <Skeleton key={i} className="h-9 w-full rounded-md" />
              ))}
            </div>
          ) : report.isError ? (
            <EmptyState
              icon={<TriangleAlert className="h-5 w-5" />}
              title="Couldn’t run this report"
              description={report.error instanceof Error ? report.error.message : undefined}
              action={
                <Button icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void report.refetch()}>
                  Try again
                </Button>
              }
              className="flex-1"
            />
          ) : !data || data.rows.length === 0 ? (
            <EmptyState
              icon={activeFilters ? <SearchX className="h-5 w-5" /> : <FileX2 className="h-5 w-5" />}
              title="No data for this period"
              description={activeFilters ? 'Nothing matched the selected vehicles, group or driver. Try widening the filters.' : 'Try a longer period, e.g. Last 7 days.'}
              className="flex-1"
            />
          ) : (
            <ReportTable
              report={data}
              currency={currency}
              className="min-h-0 flex-1"
              rowHint={(r) => rowTarget(f.type, r, data)?.hint ?? null}
              onRowClick={(r) => {
                const t = rowTarget(f.type, r, data)
                if (t) nav(t.to)
              }}
            />
          )}
        </div>
      </div>

      {/* catalogue (phone / tablet) */}
      <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} title="Choose a report" className="flex max-h-[80vh] flex-col !p-0 [&>h2]:px-4 [&>h2]:pt-4">
        <Catalogue value={f.type} onPick={pick} />
      </Modal>
    </div>
  )
}
