import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight } from 'lucide-react'
import type { Report, ReportRow } from '@/api/types'
import { cn } from '@/lib/cn'
import { colWidth, compareValues, fmtValue, isNumericKind, renderCell } from './format'

const ROW_H = 40
const VIRTUAL_AFTER = 120
const OVERSCAN = 10

/**
 * Generic report table driven by `report.columns`: typed formatting, sortable headers,
 * sticky header/first column/totals row and windowed rendering for large reports.
 */
export function ReportTable({
  report,
  currency,
  onRowClick,
  rowHint,
  className,
}: {
  report: Report
  currency: string
  onRowClick?: (row: ReportRow) => void
  /** tooltip / aria hint for clickable rows (null = row not clickable) */
  rowHint?: (row: ReportRow) => string | null
  className?: string
}) {
  const cols = report.columns
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState(0)
  const [height, setHeight] = useState(600)

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    setSort(null)
    scroller.current?.scrollTo({ top: 0 })
    setScroll(0)
  }, [report.type])

  const rows = useMemo(() => {
    if (!sort) return report.rows
    const col = cols.find((c) => c.key === sort.key)
    if (!col) return report.rows
    return [...report.rows].sort((a, b) => compareValues(col, a[sort.key], b[sort.key]) * sort.dir)
  }, [report.rows, cols, sort])

  const virtual = rows.length > VIRTUAL_AFTER
  const first = virtual ? Math.max(0, Math.floor(scroll / ROW_H) - OVERSCAN) : 0
  const last = virtual ? Math.min(rows.length, Math.ceil((scroll + height) / ROW_H) + OVERSCAN) : rows.length
  const totals = report.totals
  const hasTotals = !!totals && cols.some((c) => totals[c.key] !== undefined && totals[c.key] !== null)
  const width = cols.reduce((s, c) => s + colWidth(c), 0) + 36

  const onSort = (key: string) =>
    setSort((s) => (s?.key === key ? (s.dir === -1 ? null : { key, dir: -1 }) : { key, dir: isNumericKind(cols.find((c) => c.key === key)!.kind) ? -1 : 1 }))

  return (
    <div
      ref={scroller}
      onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      className={cn('relative overflow-auto overscroll-contain', className)}
    >
      <table className="w-full table-fixed border-separate border-spacing-0 text-[12.5px]" style={{ minWidth: width }}>
        <colgroup>
          {cols.map((c) => (
            <col key={c.key} style={{ width: colWidth(c) }} />
          ))}
          <col style={{ width: 36 }} />
        </colgroup>
        <thead>
          <tr>
            {cols.map((c, i) => {
              const active = sort?.key === c.key
              const Icon = !active ? ArrowUpDown : sort!.dir === 1 ? ArrowUp : ArrowDown
              const num = isNumericKind(c.kind)
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort!.dir === 1 ? 'ascending' : 'descending') : 'none'}
                  className={cn(
                    'sticky top-0 z-20 border-b border-navy-100 bg-navy-50 px-3 py-2.5 font-semibold text-navy-700/80 dark:border-white/[0.07] dark:bg-ink-850 dark:text-slate-400',
                    num ? 'text-right' : 'text-left',
                    i === 0 && 'left-0 z-30 shadow-[1px_0_0_rgb(226_232_240)] dark:shadow-[1px_0_0_rgb(255_255_255/0.07)]',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSort(c.key)}
                    className={cn('inline-flex max-w-full items-center gap-1 rounded hover:text-slate-900 dark:hover:text-white', num && 'flex-row-reverse', active && 'text-slate-900 dark:text-white')}
                  >
                    <span className="truncate" title={c.unit ? `${c.label} (${c.unit})` : c.label}>
                      {c.label}
                    </span>
                    <Icon className={cn('h-3 w-3 shrink-0', !active && 'opacity-35')} />
                  </button>
                </th>
              )
            })}
            <th className="sticky top-0 z-20 border-b border-navy-100 bg-navy-50 dark:border-white/[0.07] dark:bg-ink-850" aria-hidden />
          </tr>
        </thead>
        <tbody>
          {virtual && first > 0 && (
            <tr aria-hidden style={{ height: first * ROW_H }}>
              <td colSpan={cols.length + 1} />
            </tr>
          )}
          {rows.slice(first, last).map((r, i) => {
            const hint = onRowClick && rowHint ? rowHint(r) : null
            const clickable = !!onRowClick && hint !== null
            return (
              <tr
                key={first + i}
                onClick={clickable ? () => onRowClick!(r) : undefined}
                onKeyDown={clickable ? (e) => e.key === 'Enter' && onRowClick!(r) : undefined}
                tabIndex={clickable ? 0 : undefined}
                title={hint ?? undefined}
                style={{ height: ROW_H }}
                className={cn('group', clickable && 'cursor-pointer')}
              >
                {cols.map((c, ci) => (
                  <td
                    key={c.key}
                    className={cn(
                      'truncate border-b border-slate-100 bg-white px-3 text-slate-700 transition-colors dark:border-white/[0.045] dark:bg-ink-900 dark:text-slate-200',
                      isNumericKind(c.kind) ? 'tabular text-right' : 'text-left',
                      clickable && 'group-hover:bg-brand-50 dark:group-hover:bg-[#232d5c]',
                      ci === 0 && 'sticky left-0 z-10 shadow-[1px_0_0_rgb(241_245_249)] dark:shadow-[1px_0_0_rgb(255_255_255/0.05)]',
                    )}
                    title={fmtValue(c, r[c.key], currency)}
                  >
                    {renderCell(c, r, currency)}
                  </td>
                ))}
                <td
                  className={cn(
                    'border-b border-slate-100 bg-white pr-2 text-right dark:border-white/[0.045] dark:bg-ink-900',
                    clickable && 'group-hover:bg-brand-50 dark:group-hover:bg-[#232d5c]',
                  )}
                >
                  {clickable && <ChevronRight className="ml-auto h-3.5 w-3.5 text-slate-300 transition-colors group-hover:text-navy-600 dark:text-slate-600 dark:group-hover:text-brand-300" />}
                </td>
              </tr>
            )
          })}
          {virtual && last < rows.length && (
            <tr aria-hidden style={{ height: (rows.length - last) * ROW_H }}>
              <td colSpan={cols.length + 1} />
            </tr>
          )}
        </tbody>
        {hasTotals && (
          <tfoot>
            <tr>
              {cols.map((c, i) => {
                const v = totals![c.key]
                return (
                  <td
                    key={c.key}
                    className={cn(
                      'sticky bottom-0 z-20 truncate border-t-2 border-brand-500 bg-navy-50 px-3 py-2.5 font-semibold text-navy-800 dark:bg-ink-800 dark:text-white',
                      isNumericKind(c.kind) ? 'tabular text-right' : 'text-left',
                      i === 0 && 'left-0 z-30',
                    )}
                  >
                    {i === 0 && (v === undefined || v === null) ? (
                      <span className="text-[11px] font-semibold uppercase tracking-wider">Total · {report.rows.length}</span>
                    ) : v === undefined || v === null ? (
                      ''
                    ) : (
                      fmtValue(c, v, currency)
                    )}
                  </td>
                )
              })}
              <td className="sticky bottom-0 z-20 border-t-2 border-brand-500 bg-navy-50 dark:bg-ink-800" />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
