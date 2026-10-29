import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, Pause, Play, Radio, Search, TableProperties } from 'lucide-react'
import { api } from '@/api/client'
import type { Position } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { EmptyState, Skeleton } from '@/components/ui/Misc'
import { Segmented } from '@/components/ui/Tabs'
import { useParamDefs } from '@/features/common/queries'
import { CATALOG, effectiveDefs, formatValue } from '@/lib/params'
import { useDevice, useDeviceList } from '@/store/live'
import { cn } from '@/lib/cn'

type Period = 'live' | '1h' | '6h' | '24h' | 'today'
const PERIODS: Array<{ id: Period; label: string }> = [
  { id: 'live', label: 'Live' },
  { id: '1h', label: '1 h' },
  { id: '6h', label: '6 h' },
  { id: '24h', label: '24 h' },
  { id: 'today', label: 'Today' },
]
const MAX_ROWS = 2000

function rangeOf(p: Period): [Date, Date] {
  const now = new Date()
  const h = (n: number) => new Date(now.getTime() - n * 3_600_000)
  switch (p) {
    case 'live':
      return [h(1), now]
    case '1h':
      return [h(1), now]
    case '6h':
      return [h(6), now]
    case '24h':
      return [h(24), now]
    case 'today': {
      const d = new Date(now)
      d.setHours(0, 0, 0, 0)
      return [d, now]
    }
  }
}

/** Fixed record fields shown before the IO parameters. */
const FIELDS: Array<{ key: string; name: string; get: (p: Position) => unknown }> = [
  { key: 'serverTime', name: 'Received', get: (p) => p.serverTime },
  { key: 'lat', name: 'Latitude', get: (p) => p.lat },
  { key: 'lng', name: 'Longitude', get: (p) => p.lng },
  { key: 'speed', name: 'Speed km/h', get: (p) => p.speed },
  { key: 'course', name: 'Heading °', get: (p) => p.course },
  { key: 'altitude', name: 'Altitude m', get: (p) => p.altitude },
  { key: 'satellites', name: 'Satellites', get: (p) => p.satellites },
  { key: 'valid', name: 'GPS valid', get: (p) => p.valid },
  { key: 'priority', name: 'Priority', get: (p) => p.priority },
  { key: 'eventId', name: 'Event IO', get: (p) => p.eventId },
]

const ioNum = (k: string) => (/^io(\d+)$/.exec(k) ? Number(k.slice(2)) : null)

function fmtTime(iso: string) {
  const d = new Date(iso)
  return `${d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString(undefined, { hour12: false })}`
}

function csvCell(v: unknown) {
  const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Data window: every record a tracker sent, newest first, with all its
 * parameters as columns (raw IO, named and calculated). Live mode appends
 * records as they arrive.
 */
export default function DataWindowPage() {
  const devices = useDeviceList()
  const [params, setParams] = useSearchParams()
  const defsQ = useParamDefs()
  const fallbackId = devices.find((d) => d.position)?.id ?? devices[0]?.id
  const wanted = Number(params.get('device'))
  const deviceId = devices.some((d) => d.id === wanted) ? wanted : fallbackId
  const device = useDevice(deviceId)
  const [period, setPeriod] = useState<Period>('live')
  const [paused, setPaused] = useState(false)
  const [names, setNames] = useState(true)
  const [colQ, setColQ] = useState('')
  const [rows, setRows] = useState<Position[]>([]) // newest first
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const newest = useRef<string | null>(null)

  // initial load for the vehicle / period
  useEffect(() => {
    if (deviceId == null) return
    let cancelled = false
    const [from, to] = rangeOf(period)
    setLoading(true)
    setError(null)
    api
      .positions(deviceId, from.toISOString(), to.toISOString(), period === 'live' ? 200 : MAX_ROWS)
      .then((ps) => {
        if (cancelled) return
        const list = period === 'live' ? ps.slice(-200) : ps
        list.reverse()
        setRows(list)
        newest.current = list[0]?.time ?? null
      })
      .catch(() => !cancelled && setError('Could not load the records'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [deviceId, period])

  // live: when the vehicle reports, fetch everything since the newest row (buffered records included)
  const liveTime = device?.position?.time
  useEffect(() => {
    if (period !== 'live' || paused || deviceId == null || !liveTime || loading) return
    if (newest.current && Date.parse(liveTime) <= Date.parse(newest.current)) return
    const from = newest.current ? new Date(Date.parse(newest.current) + 1).toISOString() : new Date(Date.now() - 3_600_000).toISOString()
    const t = window.setTimeout(() => {
      api
        .positions(deviceId, from, new Date(Date.now() + 60_000).toISOString(), 500)
        .then((ps) => {
          if (!ps.length) return
          ps.reverse()
          setRows((cur) => {
            const seen = new Set(cur.map((r) => r.time))
            return [...ps.filter((p) => !seen.has(p.time)), ...cur].slice(0, MAX_ROWS)
          })
          newest.current = ps[0].time
        })
        .catch(() => undefined)
    }, 300)
    return () => window.clearTimeout(t)
  }, [liveTime, period, paused, deviceId, loading])

  // columns: union of attribute keys, defined parameters first, then named ones, then io<N> in order
  const defs = useMemo(() => (deviceId != null ? effectiveDefs(defsQ.data ?? [], deviceId) : new Map()), [defsQ.data, deviceId])
  const attrKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const r of rows) for (const k of Object.keys(r.attributes ?? {})) keys.add(k)
    return [...keys].sort((a, b) => {
      const ra = defs.has(a) ? 0 : CATALOG[a] && ioNum(a) == null ? 1 : 2
      const rb = defs.has(b) ? 0 : CATALOG[b] && ioNum(b) == null ? 1 : 2
      if (ra !== rb) return ra - rb
      const na = ioNum(a)
      const nb = ioNum(b)
      if (na != null && nb != null) return na - nb
      return a.localeCompare(b)
    })
  }, [rows, defs])
  const nameOf = (k: string) => defs.get(k)?.name || CATALOG[k]?.name || k
  const unitOf = (k: string) => defs.get(k)?.unit || CATALOG[k]?.unit || ''
  const s = colQ.trim().toLowerCase()
  const cols = attrKeys.filter((k) => !s || k.toLowerCase().includes(s) || nameOf(k).toLowerCase().includes(s))
  const fields = FIELDS.filter((f) => !s || f.key.toLowerCase().includes(s) || f.name.toLowerCase().includes(s))

  const cell = (k: string, v: unknown) => {
    if (v === undefined) return ''
    const d = defs.get(k)
    if (d) return formatValue(v, d.decimals)
    const fmt = CATALOG[k]?.format
    return fmt ? fmt(v) : formatValue(v, 6)
  }

  const exportCsv = () => {
    const head = ['deviceTime', ...FIELDS.map((f) => f.key), ...attrKeys]
    const label = ['Device time', ...FIELDS.map((f) => f.name), ...attrKeys.map((k) => `${nameOf(k)}${unitOf(k) ? ` (${unitOf(k)})` : ''}`)]
    const lines = [label.map(csvCell).join(','), head.map(csvCell).join(',')]
    for (const r of [...rows].reverse()) lines.push([r.time, ...FIELDS.map((f) => f.get(r)), ...attrKeys.map((k) => r.attributes?.[k])].map(csvCell).join(','))
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${device?.name ?? 'device'}-data.csv`.replace(/[^\w.-]+/g, '_')
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Vehicle" value={deviceId ?? ''} onChange={(e) => setParams({ device: e.target.value }, { replace: true })} className="w-full sm:w-64">
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} · {d.imei}
            </option>
          ))}
        </Select>
        <Segmented<Period> label="Period" value={period} onChange={setPeriod} options={PERIODS} />
        {period === 'live' && (
          <Button size="sm" icon={paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />} onClick={() => setPaused((p) => !p)}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
        )}
        <div className="relative w-full sm:ml-auto sm:w-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={colQ}
            onChange={(e) => setColQ(e.target.value)}
            placeholder="Find a parameter (io66, power…)"
            aria-label="Filter columns"
            className="h-9 w-full rounded-full border border-slate-200 bg-white pl-9 pr-3 text-[13px] placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-white/10 dark:bg-white/[0.04]"
          />
        </div>
        <Segmented<'names' | 'keys'>
          label="Column titles"
          value={names ? 'names' : 'keys'}
          onChange={(v) => setNames(v === 'names')}
          options={[
            { id: 'names', label: 'Names' },
            { id: 'keys', label: 'Keys' },
          ]}
        />
        <Button size="sm" icon={<Download className="h-3.5 w-3.5" />} disabled={!rows.length} onClick={exportCsv}>
          CSV
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-500 dark:text-slate-400">
        {period === 'live' && (
          <span className={cn('inline-flex items-center gap-1.5 font-medium', paused ? 'text-slate-500' : 'text-emerald-600 dark:text-emerald-400')}>
            <Radio className={cn('h-3.5 w-3.5', !paused && 'animate-pulse')} /> {paused ? 'Paused' : 'Live — new records appear at the top'}
          </span>
        )}
        <span>
          {rows.length.toLocaleString()} record{rows.length === 1 ? '' : 's'} · {attrKeys.length} parameters
          {rows.length >= MAX_ROWS && ` (showing the latest ${MAX_ROWS.toLocaleString()})`}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-brand-500/30" /> changed since the previous record
        </span>
      </div>
      <div className="card min-h-0 flex-1 overflow-auto">
        {loading && !rows.length ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : error ? (
          <EmptyState icon={<TableProperties className="h-5 w-5" />} title={error} />
        ) : !rows.length ? (
          <EmptyState
            icon={<TableProperties className="h-5 w-5" />}
            title={devices.length ? 'No records in this period' : 'No devices yet'}
            description={devices.length ? 'Records show up here as soon as the tracker sends data. Try a longer period.' : 'Register a tracker on the Devices page.'}
          />
        ) : (
          <table className="w-max min-w-full border-separate border-spacing-0 text-[12px]">
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="sticky left-0 z-30 border-b border-r border-navy-100 bg-navy-50 px-3 py-2 text-left font-semibold text-navy-700 dark:border-white/10 dark:bg-ink-850 dark:text-slate-300">
                  Device time
                </th>
                {fields.map((f) => (
                  <th key={f.key} className="whitespace-nowrap border-b border-navy-100 bg-navy-50 px-3 py-2 text-right font-semibold text-navy-700/80 dark:border-white/10 dark:bg-ink-850 dark:text-slate-400">
                    {names ? f.name : f.key}
                  </th>
                ))}
                {cols.map((k) => (
                  <th key={k} title={`${nameOf(k)} · ${k}`} className="whitespace-nowrap border-b border-navy-100 bg-navy-50 px-3 py-1.5 text-right align-bottom dark:border-white/10 dark:bg-ink-850">
                    <span className="block font-semibold text-navy-800 dark:text-slate-200">{names ? nameOf(k) : k}</span>
                    <span className="block font-mono text-[10px] font-normal text-slate-400">
                      {names ? k : nameOf(k) !== k ? nameOf(k) : ''}
                      {unitOf(k) && ` · ${unitOf(k)}`}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const prev = rows[i + 1]
                const changed = (a: unknown, b: unknown) => prev !== undefined && JSON.stringify(a) !== JSON.stringify(b)
                return (
                  <tr key={r.time} className="group">
                    <td className="tabular sticky left-0 z-10 whitespace-nowrap border-b border-r border-slate-100 bg-white px-3 py-1.5 font-medium text-slate-900 group-hover:bg-navy-50 dark:border-white/[0.05] dark:bg-ink-900 dark:text-white dark:group-hover:bg-ink-850">
                      {fmtTime(r.time)}
                    </td>
                    {fields.map((f) => {
                      const v = f.get(r)
                      // position fields change on every record while driving: no highlight
                      const c = !['serverTime', 'lat', 'lng'].includes(f.key) && prev && changed(v, f.get(prev))
                      return (
                        <td key={f.key} className={cn('tabular whitespace-nowrap border-b border-slate-100 px-3 py-1.5 text-right text-slate-700 group-hover:bg-navy-50/60 dark:border-white/[0.05] dark:text-slate-300 dark:group-hover:bg-white/[0.03]', c && 'bg-brand-500/15')}>
                          {f.key === 'serverTime' ? fmtTime(String(v)) : formatValue(v, f.key === 'lat' || f.key === 'lng' ? 6 : 1)}
                        </td>
                      )
                    })}
                    {cols.map((k) => {
                      const v = r.attributes?.[k]
                      const c = prev && changed(v, prev.attributes?.[k])
                      return (
                        <td key={k} className={cn('tabular whitespace-nowrap border-b border-slate-100 px-3 py-1.5 text-right group-hover:bg-navy-50/60 dark:border-white/[0.05] dark:group-hover:bg-white/[0.03]', v === undefined ? 'text-slate-300 dark:text-slate-600' : 'text-slate-800 dark:text-slate-200', c && 'bg-brand-500/15')}>
                          {v === undefined ? '·' : cell(k, v)}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
