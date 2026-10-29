import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronUp, FolderTree, Gauge, List, Search, SearchX, X } from 'lucide-react'
import type { Device, DeviceStatus } from '@/api/types'
import { STATUS_META, STATUSES, countByStatus } from '@/lib/status'
import { useNow } from '@/store/now'
import { EmptyState, Skeleton } from '@/components/ui/Misc'
import { cn } from '@/lib/cn'
import { useDrivers, useGroups } from '@/features/common/queries'
import { useAccess } from '@/lib/access'
import { CARD_H, VehicleCard } from './VehicleCard'

const ShareDialog = lazy(() => import('./ShareDialog').then((m) => ({ default: m.ShareDialog })))

const ROW_H = CARD_H + 8

export type StatusFilter = DeviceStatus | 'all'

/** Simple fixed-height list virtualisation so 1000s of rows stay smooth. */
function VirtualList({ items, render, resetKey }: { items: Device[]; render: (d: Device) => ReactNode; resetKey: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState(0)
  const [height, setHeight] = useState(600)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 })
    setScroll(0)
  }, [resetKey])
  const first = Math.max(0, Math.floor(scroll / ROW_H) - 4)
  const last = Math.min(items.length, Math.ceil((scroll + height) / ROW_H) + 4)
  return (
    <div ref={ref} onScroll={(e) => setScroll(e.currentTarget.scrollTop)} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      <div style={{ height: items.length * ROW_H, position: 'relative' }}>
        {items.slice(first, last).map((d, i) => (
          <div key={d.id} style={{ position: 'absolute', top: (first + i) * ROW_H, left: 0, right: 0, height: ROW_H }}>
            {render(d)}
          </div>
        ))}
      </div>
    </div>
  )
}

export function DeviceList({
  devices,
  loaded,
  selectedId,
  onSelect,
  expanded,
  onToggleExpanded,
  onShowTable,
}: {
  devices: Device[]
  loaded: boolean
  selectedId: number | null
  onSelect: (id: number) => void
  expanded: boolean
  onToggleExpanded: () => void
  /** switch to the table view (desktop) */
  onShowTable?: () => void
}) {
  const now = useNow()
  const drivers = useDrivers()
  const { canManageDevice } = useAccess()
  const [sharing, setSharing] = useState<Device | null>(null)
  const driverName = (d: Device) => {
    const tag = typeof d.position?.attributes?.driverId === 'string' ? (d.position.attributes.driverId as string).toLowerCase() : null
    return (
      (tag ? drivers.data?.find((x) => x.tag && x.tag.toLowerCase() === tag) : undefined) ??
      (d.driverId != null ? drivers.data?.find((x) => x.id === d.driverId) : undefined) ??
      drivers.data?.find((x) => x.deviceId === d.id)
    )?.name
  }
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const groups = useGroups()
  const [groupId, setGroupId] = useState<number | null>(null)
  const group = groups.data?.find((g) => g.id === groupId) ?? null
  const inGroup = useMemo(
    () => (group ? devices.filter((d) => group.deviceIds.includes(d.id) || d.groupIds?.includes(group.id)) : devices),
    [devices, group],
  )
  const counts = useMemo(() => countByStatus(inGroup), [inGroup])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return inGroup.filter(
      (d) =>
        (filter === 'all' || d.status === filter) &&
        (!s || d.name.toLowerCase().includes(s) || d.plate.toLowerCase().includes(s) || d.imei.includes(s)),
    )
  }, [inGroup, q, filter])

  const chips: Array<{ id: StatusFilter; label: string; count: number; color?: string }> = [
    { id: 'all', label: 'All', count: inGroup.length },
    ...STATUSES.filter((s) => s !== 'never' || counts.never > 0).map((s) => ({
      id: s,
      label: s === 'never' ? 'Never' : STATUS_META[s].label,
      count: counts[s],
      color: STATUS_META[s].color,
    })),
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* mobile sheet handle */}
      <button
        type="button"
        onClick={onToggleExpanded}
        aria-label={expanded ? 'Collapse vehicle list' : 'Expand vehicle list'}
        aria-expanded={expanded}
        className="flex w-full items-center justify-center gap-2 pt-2 text-[12px] font-medium text-slate-500 md:hidden"
      >
        <span className="h-1 w-10 rounded-full bg-slate-300 dark:bg-white/20" />
      </button>
      <div className="flex items-center justify-between px-4 pb-2 pt-2 md:pt-4">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">Vehicles</h2>
          <p className="text-[12px] text-slate-500 dark:text-slate-400">
            {loaded ? `${counts.moving} moving · ${devices.length} total` : 'Loading fleet…'}
          </p>
        </div>
        {onShowTable && (
          <button
            type="button"
            onClick={onShowTable}
            title="Table view"
            aria-label="Show vehicles as a table"
            className="hidden h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-[12px] font-medium text-slate-600 hover:border-navy-200 hover:text-navy-700 dark:border-white/10 dark:text-slate-300 md:inline-flex"
          >
            <List className="h-3.5 w-3.5" /> Table
          </button>
        )}
        <button
          type="button"
          onClick={onToggleExpanded}
          className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-900/5 dark:hover:bg-white/10 md:hidden"
          aria-label={expanded ? 'Collapse vehicle list' : 'Expand vehicle list'}
        >
          <ChevronUp className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>
      <div className="px-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => !expanded && onToggleExpanded()}
            placeholder="Filter by name, plate or IMEI"
            aria-label="Filter vehicles"
            className="h-9 w-full rounded-lg border border-slate-200/90 bg-white/70 pl-9 pr-8 text-[13px] placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-white/[0.08] dark:bg-white/[0.04] dark:placeholder:text-slate-500"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              aria-label="Clear filter"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div role="group" aria-label="Status filter" className="-mx-1 mt-2.5 flex gap-1.5 overflow-x-auto px-1 pb-2.5 md:flex-wrap md:overflow-visible">
          {!!groups.data?.length && (
            <label
              className={cn(
                'relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border pl-2 pr-2.5 text-[12px] font-medium transition-colors',
                group
                  ? 'border-brand-500 bg-brand-500/15 text-navy-800 dark:text-brand-100'
                  : 'border-slate-200 bg-white/60 text-slate-600 hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300',
              )}
            >
              {group ? <span className="h-2 w-2 rounded-full" style={{ background: group.color }} /> : <FolderTree className="h-3.5 w-3.5" />}
              <span className="max-w-[110px] truncate">{group ? group.name : 'Group'}</span>
              <ChevronUp className="h-3 w-3 rotate-180 opacity-60" />
              <select
                aria-label="Filter by group"
                value={groupId ?? ''}
                onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : null)}
                className="absolute inset-0 cursor-pointer opacity-0"
              >
                <option value="">All groups</option>
                {groups.data.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.deviceIds.length})
                  </option>
                ))}
              </select>
            </label>
          )}
          {chips.map((c) => {
            const active = filter === c.id
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(c.id)}
                className={cn(
                  'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border pl-2.5 pr-1 text-[12px] font-medium transition-colors',
                  active
                    ? 'border-navy-600 bg-navy-700 text-white dark:border-brand-500 dark:bg-brand-500 dark:text-navy-900'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-navy-200 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 dark:hover:border-white/20',
                )}
              >
                {c.color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />}
                {c.label}
                <span
                  className={cn(
                    'tabular min-w-[20px] rounded-full px-1.5 text-center text-[11px] font-semibold',
                    active ? 'bg-white/20 text-white dark:bg-navy-900/15 dark:text-navy-900' : 'bg-navy-50 text-navy-700 dark:bg-white/10 dark:text-slate-200',
                  )}
                >
                  {c.count}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="mx-3 h-px bg-slate-200/80 dark:bg-white/[0.06]" />
      {!loaded ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-1 py-1.5">
              <Skeleton className="h-10 w-10 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : devices.length === 0 ? (
        <EmptyState
          icon={<Gauge className="h-5 w-5" />}
          title="No vehicles yet"
          description="Add a device on the Devices page, or point a tracker at the server — unknown IMEIs register automatically."
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<SearchX className="h-5 w-5" />} title="No matches" description="Try a different search or status filter." />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col pt-2">
          <VirtualList
            items={filtered}
            resetKey={`${filter}|${q}|${groupId}`}
            render={(d) => (
              <VehicleCard
                d={d}
                now={now}
                selected={d.id === selectedId}
                onSelect={() => onSelect(d.id)}
                onShare={canManageDevice(d) ? () => setSharing(d) : undefined}
                driverName={driverName(d)}
              />
            )}
          />
        </div>
      )}
      {sharing && (
        <Suspense fallback={null}>
          <ShareDialog device={sharing} open onClose={() => setSharing(null)} />
        </Suspense>
      )}
    </div>
  )
}
