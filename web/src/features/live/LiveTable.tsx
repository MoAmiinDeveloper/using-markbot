import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { History, Map as MapIcon, Search, SearchX } from 'lucide-react'
import type { Device, DeviceStatus } from '@/api/types'
import { EmptyState } from '@/components/ui/Misc'
import { IconButton } from '@/components/ui/Button'
import { useDrivers } from '@/features/common/queries'
import { CategoryIcon } from '@/lib/category'
import { STATUS_META, STATUSES, countByStatus } from '@/lib/status'
import { fmtSince, timeAgo } from '@/lib/format'
import { useNow } from '@/store/now'
import { cn } from '@/lib/cn'
import { CardAddress, vehicleTiles } from './VehicleCard'

type Filter = DeviceStatus | 'all'

/** Whole-fleet table: where every vehicle is, what it is doing and who drives it. */
export function LiveTable({ devices, onShowMap, onOpen }: { devices: Device[]; onShowMap: () => void; onOpen: (id: number) => void }) {
  const now = useNow()
  const nav = useNavigate()
  const drivers = useDrivers()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const counts = useMemo(() => countByStatus(devices), [devices])
  const s = q.trim().toLowerCase()
  const rows = devices.filter((d) => (filter === 'all' || d.status === filter) && (!s || d.name.toLowerCase().includes(s) || d.plate.toLowerCase().includes(s) || d.imei.includes(s)))
  const driverOf = (d: Device) => drivers.data?.find((x) => x.id === d.driverId) ?? drivers.data?.find((x) => x.deviceId === d.id)

  return (
    <div className="flex h-full flex-col gap-3 p-3 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        {(['all', ...STATUSES.filter((x) => x !== 'never' || counts.never > 0)] as Filter[]).map((f) => {
          const active = filter === f
          const n = f === 'all' ? devices.length : counts[f]
          return (
            <button
              key={f}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(f)}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-full border pl-3 pr-1 text-[12.5px] font-medium transition-colors',
                active ? 'border-navy-600 bg-navy-700 text-white dark:border-brand-500 dark:bg-brand-500 dark:text-navy-900' : 'border-slate-200 bg-white text-slate-600 hover:border-navy-200 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300',
              )}
            >
              {f !== 'all' && <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_META[f].color }} />}
              {f === 'all' ? 'All' : f === 'never' ? 'Never' : STATUS_META[f].label}
              <span className={cn('tabular min-w-[22px] rounded-full px-1.5 text-center text-[11px] font-semibold', active ? 'bg-white/20' : 'bg-navy-50 text-navy-700 dark:bg-white/10 dark:text-slate-200')}>{n}</span>
            </button>
          )
        })}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search vehicle, plate or IMEI"
            aria-label="Search vehicles"
            className="h-9 w-full rounded-full border border-slate-200 bg-white pl-9 pr-3 text-[13px] placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-white/10 dark:bg-white/[0.04]"
          />
        </div>
        <button
          type="button"
          onClick={onShowMap}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-700 hover:border-navy-200 hover:text-navy-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"
        >
          <MapIcon className="h-4 w-4" /> Map view
        </button>
      </div>
      <p className="text-[12px] text-slate-500 dark:text-slate-400">Results: {rows.length} vehicle{rows.length === 1 ? '' : 's'}</p>
      <div className="card min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <EmptyState icon={<SearchX className="h-5 w-5" />} title="No vehicles match" description="Try another status or search." />
        ) : (
          <table className="w-full min-w-[980px] text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-navy-50 text-left text-[12px] text-navy-700/80 dark:bg-ink-850 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 font-semibold">Vehicle</th>
                <th className="px-4 py-3 font-semibold">Movement</th>
                <th className="px-4 py-3 font-semibold">Current location</th>
                <th className="px-4 py-3 font-semibold">Ignition</th>
                <th className="px-4 py-3 font-semibold">Readings</th>
                <th className="px-4 py-3 font-semibold">Driver</th>
                <th className="w-20 px-2 py-3" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
              {rows.map((d) => {
                const m = STATUS_META[d.status] ?? STATUS_META.offline
                const ign = d.position?.attributes?.ignition
                const tiles = vehicleTiles(d).filter((t) => t.label !== 'Ignition').slice(0, 3)
                const drv = driverOf(d)
                return (
                  <tr key={d.id} className="group cursor-pointer" onClick={() => onOpen(d.id)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: `${m.color}1a`, color: m.color }}>
                          <CategoryIcon category={d.category} icon={d.icon} className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-navy-800 hover:underline dark:text-white">{d.name}</p>
                          <p className="truncate text-[11px] text-slate-400">
                            {d.plate ? `${d.plate} · ` : ''}Last data {timeAgo(d.lastSeen, now)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <p className={cn('font-semibold', m.text)}>
                        {m.label}
                        {d.statusSince ? `: ${fmtSince(d.statusSince, now)}` : ''}
                      </p>
                      <p className="text-[11.5px] text-slate-500 dark:text-slate-400">Today: {(d.todayKm ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} km</p>
                    </td>
                    <td className="max-w-[300px] px-4 py-3">
                      <CardAddress d={d} className="[&>span]:whitespace-normal [&>span]:line-clamp-2" />
                    </td>
                    <td className="px-4 py-3">
                      {typeof ign === 'boolean' ? (
                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', ign ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' : 'bg-slate-500/10 text-slate-500')}>{ign ? 'ON' : 'OFF'}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {tiles.map((t) => (
                          <span key={t.label} className="rounded-md bg-navy-50/70 px-1.5 py-0.5 text-[11px] dark:bg-white/[0.05]" title={t.label}>
                            <b className="tabular font-semibold text-navy-800 dark:text-white">{t.value}</b> <span className="text-slate-500">{t.label}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {drv ? (
                        <>
                          <p className="font-medium text-slate-800 dark:text-slate-100">{drv.name}</p>
                          {drv.phone && <p className="text-[11px] text-slate-400">{drv.phone}</p>}
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-0.5 opacity-70 group-hover:opacity-100">
                        <IconButton size="sm" label={`Show ${d.name} on the map`} onClick={() => onOpen(d.id)}>
                          <MapIcon className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton size="sm" label={`History of ${d.name}`} onClick={() => nav(`/history?device=${d.id}`)}>
                          <History className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </td>
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
