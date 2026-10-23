import type { ReactNode } from 'react'
import { format } from 'date-fns'
import type { ReportColumn, ReportRow, ReportValue } from '@/api/types'
import { DueStatusPill, ScoreBadge } from '@/components/ui/Badges'
import { eventMeta } from '@/lib/events'
import { expenseMeta } from '@/lib/ops'
import { fmtDurationHM, fmtMoney, fmtNumber } from '@/lib/format'
import { cn } from '@/lib/cn'

export const isNumericKind = (k: ReportColumn['kind']) => k === 'number' || k === 'duration' || k === 'speed' || k === 'money'

function parseTime(v: ReportValue): number | null {
  if (typeof v === 'number') return v > 1e11 ? v : v * 1000
  if (typeof v !== 'string' || !v) return null
  const t = Date.parse(v.length === 10 ? `${v}T00:00:00` : v)
  return Number.isNaN(t) ? null : t
}

/** Plain-text value (used for sorting fallbacks, KPI chips and titles). */
export function fmtValue(col: ReportColumn, v: ReportValue, currency: string): string {
  if (v === null || v === undefined || v === '') return '—'
  switch (col.kind) {
    case 'duration':
      return typeof v === 'number' ? fmtDurationHM(v) : String(v)
    case 'datetime': {
      const t = parseTime(v)
      if (t == null) return String(v)
      return typeof v === 'string' && v.length === 10 ? format(t, 'EEE d MMM yyyy') : format(t, 'd MMM yyyy, HH:mm')
    }
    case 'speed':
      return typeof v === 'number' ? `${Math.round(v)} km/h` : String(v)
    case 'money':
      return typeof v === 'number' ? fmtMoney(v, currency) : String(v)
    case 'number': {
      if (typeof v === 'boolean') return v ? 'Yes' : 'No'
      if (typeof v !== 'number') return String(v)
      const unit = col.unit ? ` ${col.unit}` : ''
      return `${fmtNumber(v, col.unit === 'km' || col.unit === 'l' || col.unit === 'h' ? 1 : 0)}${unit}`
    }
    default:
      if (typeof v === 'boolean') return v ? 'Yes' : 'No'
      return String(v)
  }
}

/** Rich cell content for a few well-known keys; everything else is formatted by kind. */
export function renderCell(col: ReportColumn, row: ReportRow, currency: string): ReactNode {
  const v = row[col.key]
  if (v === null || v === undefined || v === '') return <span className="text-slate-300 dark:text-slate-600">—</span>
  switch (col.key) {
    case 'score':
      return typeof v === 'number' ? <ScoreBadge score={v} /> : String(v)
    case 'status':
      if (v === 'ok' || v === 'dueSoon' || v === 'overdue') return <DueStatusPill status={v} />
      break
    case 'type': {
      const m = eventMeta(String(v))
      const Icon = m.icon
      return (
        <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', m.pill)}>
          <Icon className="h-3 w-3" />
          {m.label}
        </span>
      )
    }
    case 'category': {
      const m = expenseMeta(String(v))
      const Icon = m.icon
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="grid h-5 w-5 place-items-center rounded-md" style={{ background: `${m.color}22`, color: m.color }}>
            <Icon className="h-3 w-3" />
          </span>
          {m.label}
        </span>
      )
    }
    case 'ignition':
      if (typeof v === 'boolean')
        return (
          <span
            className={cn(
              'rounded-md px-1.5 py-0.5 text-[11px] font-semibold',
              v ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300' : 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
            )}
          >
            {v ? 'Engine on' : 'Engine off'}
          </span>
        )
      break
    case 'device':
    case 'driver':
      return <span className="font-medium text-slate-900 dark:text-white">{String(v)}</span>
  }
  if (col.kind === 'link')
    return <span className="font-medium text-navy-600 underline-offset-2 group-hover:underline dark:text-brand-300">{String(v)}</span>
  return fmtValue(col, v, currency)
}

/** Fixed column widths (table-layout: fixed keeps virtualised rows from jumping). */
export function colWidth(col: ReportColumn): number {
  if (/address|message|notes/i.test(col.key)) return 260
  if (col.key === 'device' || col.key === 'driver' || col.key === 'geofence' || col.key === 'item') return 180
  if (col.key === 'type') return 170
  if (col.key === 'score' || col.key === 'status') return 110
  switch (col.kind) {
    case 'datetime':
      return 156
    case 'duration':
      return 104
    case 'speed':
      return 112
    case 'money':
      return 120
    case 'number':
      return 118
    case 'link':
      return 170
    default:
      return 150
  }
}

export function compareValues(col: ReportColumn, a: ReportValue, b: ReportValue): number {
  const na = a === null || a === undefined || a === ''
  const nb = b === null || b === undefined || b === ''
  if (na || nb) return na === nb ? 0 : na ? 1 : -1
  if (col.kind === 'datetime') return (parseTime(a) ?? 0) - (parseTime(b) ?? 0)
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/** KPI aggregate for a key: server totals win, else sum (max for speeds, mean for scores). */
export function aggregate(key: string, col: ReportColumn | undefined, rows: ReportRow[], totals?: Record<string, ReportValue>): number | null {
  const t = totals?.[key]
  if (typeof t === 'number') return t
  const nums = rows.map((r) => r[key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (!nums.length) return null
  if (key === 'score') return nums.reduce((s, v) => s + v, 0) / nums.length
  if (col?.kind === 'speed' || /^max/i.test(key)) return Math.max(...nums)
  if (/^avg/i.test(key)) return nums.reduce((s, v) => s + v, 0) / nums.length
  return nums.reduce((s, v) => s + v, 0)
}
