import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ArrowUpDown, Cpu, History, Map, Pencil, Plus, Search, SearchX, Trash2 } from 'lucide-react'
import { api } from '@/api/client'
import type { Device, DeviceStatus } from '@/api/types'
import { Button, IconButton } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState, Skeleton, StatusPill } from '@/components/ui/Misc'
import { useDeviceList, useLive } from '@/store/live'
import { SourceBadge } from '@/components/ui/SourceBadge'
import { useNow } from '@/store/now'
import { toast } from '@/store/toast'
import { categoryMeta, DeviceGlyph } from '@/lib/category'
import { STATUS_META, STATUSES } from '@/lib/status'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useAccess } from '@/lib/access'
import { useDrivers, useGroups } from '@/features/common/queries'
import { DeviceEditor, type EditorTab } from '@/features/devices/DeviceEditor'
import { GroupChip } from '@/components/ui/Badges'
import { fmtHours, fmtKm } from '@/lib/format'
import { Gauge as GaugeIcon, SlidersHorizontal, Timer, UserRound } from 'lucide-react'

type SortKey = 'name' | 'status' | 'lastSeen' | 'imei' | 'category'
const STATUS_ORDER: Record<DeviceStatus, number> = { moving: 0, idle: 1, stopped: 2, offline: 3, never: 4 }

function SortHeader({
  k,
  label,
  sort,
  onSort,
  className,
}: {
  k: SortKey
  label: string
  sort: { key: SortKey; dir: 1 | -1 }
  onSort: (k: SortKey) => void
  className?: string
}) {
  const active = sort.key === k
  const Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={cn('px-4 py-2.5 text-left font-medium', className)}>
      <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 rounded hover:text-slate-900 dark:hover:text-white">
        {label}
        <Icon className={cn('h-3 w-3', !active && 'opacity-40')} />
      </button>
    </th>
  )
}

export default function DevicesPage() {
  const { isAdmin, canManageDevice } = useAccess()
  const groups = useGroups()
  const drivers = useDrivers()
  const [groupId, setGroupId] = useState<number | null>(null)
  const devices = useDeviceList()
  const loaded = useLive((s) => s.loaded)
  const remove = useLive((s) => s.remove)
  const now = useNow()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<DeviceStatus | 'all'>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 })
  const [editing, setEditing] = useState<Device | null | 'new'>(null)
  const [startTab, setStartTab] = useState<EditorTab>('tracker')
  // deep link from the live panel: /devices?sensors=<id>
  const sensorsParam = new URLSearchParams(window.location.search).get('sensors')
  const [linked, setLinked] = useState(false)
  if (!linked && sensorsParam && loaded) {
    const d = devices.find((x) => x.id === Number(sensorsParam))
    setLinked(true)
    if (d && canManageDevice(d)) {
      setStartTab('sensors')
      setEditing(d)
    }
  }
  const [deleting, setDeleting] = useState<Device | null>(null)

  const del = useMutation({
    mutationFn: (d: Device) => api.deleteDevice(d.id),
    onSuccess: (_, d) => {
      remove(d.id)
      toast.success('Device deleted', d.name)
      setDeleting(null)
    },
  })

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    const g = groups.data?.find((x) => x.id === groupId)
    const list = devices.filter(
      (d) =>
        (status === 'all' || d.status === status) &&
        (!g || g.deviceIds.includes(d.id) || !!d.groupIds?.includes(g.id)) &&
        (!s ||
          d.name.toLowerCase().includes(s) ||
          d.imei.includes(s) ||
          d.plate.toLowerCase().includes(s) ||
          d.model.toLowerCase().includes(s) ||
          d.phone.includes(s)),
    )
    const cmp = (a: Device, b: Device): number => {
      switch (sort.key) {
        case 'name':
          return a.name.localeCompare(b.name, undefined, { numeric: true })
        case 'imei':
          return a.imei.localeCompare(b.imei)
        case 'category':
          return a.category.localeCompare(b.category)
        case 'status':
          return STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        case 'lastSeen':
          return (a.lastSeen ? Date.parse(a.lastSeen) : 0) - (b.lastSeen ? Date.parse(b.lastSeen) : 0)
      }
    }
    return [...list].sort((a, b) => cmp(a, b) * sort.dir)
  }, [devices, q, status, sort, groupId, groups.data])

  const groupsOf = (d: Device) => (groups.data ?? []).filter((g) => g.deviceIds.includes(d.id) || !!d.groupIds?.includes(g.id))
  const driverOf = (d: Device) => drivers.data?.find((x) => x.id === d.driverId) ?? drivers.data?.find((x) => x.deviceId === d.id)
  const onSort = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 p-3 sm:p-5 lg:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight text-slate-900 dark:text-white">Devices</h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400">
              {loaded ? `${devices.length} tracker${devices.length === 1 ? '' : 's'} registered` : 'Loading…'}
            </p>
          </div>
          {isAdmin && (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
              Add device
            </Button>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-slate-200/80 p-3 dark:border-white/[0.06] sm:flex-row sm:items-center">
            <Input
              icon={<Search className="h-4 w-4" />}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, IMEI, plate, model…"
              aria-label="Search devices"
              className="sm:max-w-xs sm:flex-1"
            />
            <Select value={status} onChange={(e) => setStatus(e.target.value as DeviceStatus | 'all')} aria-label="Filter by status" className="sm:w-44">
              <option value="all">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </Select>
            {!!groups.data?.length && (
              <Select value={groupId ?? ''} onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : null)} aria-label="Filter by group" className="sm:w-44">
                <option value="">All groups</option>
                {groups.data.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            )}
            <span className="text-[12px] text-slate-400 sm:ml-auto">
              {rows.length} of {devices.length}
            </span>
          </div>

          {!loaded ? (
            <div className="space-y-px p-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : devices.length === 0 ? (
            <EmptyState
              icon={<Cpu className="h-5 w-5" />}
              title="No devices yet"
              description="Add your first tracker, or simply point it at the server — unknown IMEIs register themselves."
              action={
                isAdmin && (
                  <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
                    Add device
                  </Button>
                )
              }
            />
          ) : rows.length === 0 ? (
            <EmptyState icon={<SearchX className="h-5 w-5" />} title="No devices match" description="Adjust the search or status filter." />
          ) : (
            <>
              {/* table on >= md */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-[13px]">
                  <thead className="bg-navy-50/80 text-navy-700/80 [&_th]:font-semibold text-[12px] dark:bg-white/[0.02] dark:text-slate-400">
                    <tr>
                      <SortHeader k="name" label="Name" sort={sort} onSort={onSort} />
                      <SortHeader k="status" label="Status" sort={sort} onSort={onSort} />
                      <SortHeader k="imei" label="IMEI" sort={sort} onSort={onSort} />
                      <th scope="col" className="px-4 py-2.5 text-left font-medium">
                        Source
                      </th>
                      <SortHeader k="category" label="Type" sort={sort} onSort={onSort} className="hidden lg:table-cell" />
                      <th scope="col" className="hidden px-4 py-2.5 text-left font-medium xl:table-cell">
                        Groups
                      </th>
                      <th scope="col" className="hidden px-4 py-2.5 text-left font-medium lg:table-cell">
                        Driver
                      </th>
                      <th scope="col" className="hidden px-4 py-2.5 text-right font-medium lg:table-cell">
                        Odometer
                      </th>
                      <SortHeader k="lastSeen" label="Last seen" sort={sort} onSort={onSort} />
                      <th scope="col" className="px-4 py-2.5 text-right font-medium">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                    {rows.map((d) => (
                      <tr key={d.id} className="group transition-colors hover:bg-slate-50/70 dark:hover:bg-white/[0.02]">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-3">
                            <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/[0.05] dark:text-slate-300">
                              <DeviceGlyph device={d} className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-slate-900 dark:text-white">{d.name}</div>
                              <div className="truncate text-[12px] text-slate-500 dark:text-slate-400">{d.plate || '—'}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusPill status={d.status} />
                        </td>
                        <td className="tabular px-4 py-2.5 font-mono text-[12px] text-slate-600 dark:text-slate-300">{d.imei}</td>
                        <td className="px-4 py-2.5">
                          <SourceBadge source={d.source} />
                        </td>
                        <td className="hidden px-4 py-2.5 text-slate-600 dark:text-slate-300 lg:table-cell">{categoryMeta(d.category).label}</td>
                        <td className="hidden max-w-[200px] px-4 py-2.5 xl:table-cell">
                          <div className="flex flex-wrap gap-1">
                            {groupsOf(d).length ? groupsOf(d).map((g) => <GroupChip key={g.id} name={g.name} color={g.color} />) : <span className="text-slate-400">—</span>}
                          </div>
                        </td>
                        <td className="hidden max-w-[160px] truncate px-4 py-2.5 text-slate-700 dark:text-slate-200 lg:table-cell">
                          {driverOf(d) ? (
                            <span className="inline-flex items-center gap-1.5">
                              <UserRound className="h-3.5 w-3.5 text-slate-400" />
                              {driverOf(d)!.name}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="tabular hidden whitespace-nowrap px-4 py-2.5 text-right lg:table-cell">
                          <div className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-200">
                            <GaugeIcon className="h-3 w-3 text-slate-400" />
                            {fmtKm(d.odometer)}
                          </div>
                          <div className="flex items-center justify-end gap-1 text-[12px] text-slate-400">
                            <Timer className="h-3 w-3" />
                            {fmtHours(d.engineHours)}
                          </div>
                        </td>
                        <td className="tabular whitespace-nowrap px-4 py-2.5 text-slate-600 dark:text-slate-300" title={d.lastSeen ?? undefined}>
                          {timeAgo(d.lastSeen, now)}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end gap-0.5 opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                            <IconButton size="sm" label={`Show ${d.name} on map`} onClick={() => nav(`/live?device=${d.id}`)}>
                              <Map className="h-3.5 w-3.5" />
                            </IconButton>
                            <IconButton size="sm" label={`History of ${d.name}`} onClick={() => nav(`/history?device=${d.id}`)}>
                              <History className="h-3.5 w-3.5" />
                            </IconButton>
                            {canManageDevice(d) && (
                              <>
                              <IconButton size="sm" label={`Sensors of ${d.name}`} onClick={() => (setStartTab('sensors'), setEditing(d))}>
                                <GaugeIcon className="h-3.5 w-3.5" />
                              </IconButton>
                              <IconButton size="sm" label={`Parameters of ${d.name}`} onClick={() => (setStartTab('params'), setEditing(d))} className="max-md:hidden">
                                <SlidersHorizontal className="h-3.5 w-3.5" />
                              </IconButton>
                              <IconButton size="sm" label={`Edit ${d.name}`} onClick={() => setEditing(d)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </IconButton>
                            </>
                            )}
                            {isAdmin && (
                              <IconButton size="sm" label={`Delete ${d.name}`} onClick={() => setDeleting(d)} className="hover:!bg-rose-500/10 hover:!text-rose-500">
                                <Trash2 className="h-3.5 w-3.5" />
                              </IconButton>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* cards on phones */}
              <ul className="divide-y divide-slate-100 dark:divide-white/[0.05] md:hidden">
                {rows.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 px-3 py-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/[0.05] dark:text-slate-300">
                      <DeviceGlyph device={d} className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-slate-900 dark:text-white">{d.name}</span>
                        <StatusPill status={d.status} />
                      </div>
                      <div className="tabular mt-0.5 truncate font-mono text-[11.5px] text-slate-500 dark:text-slate-400">
                        {d.source === 'traccar' && <SourceBadge source={d.source} className="mr-1.5 align-[1px] font-sans" />}
                        {d.imei}
                        {d.plate ? ` · ${d.plate}` : ''}
                      </div>
                      <div className="tabular mt-0.5 truncate text-[11.5px] text-slate-500 dark:text-slate-400">
                        {fmtKm(d.odometer)} · {fmtHours(d.engineHours)}
                        {driverOf(d) ? ` · ${driverOf(d)!.name}` : ''}
                      </div>
                    </div>
                    {canManageDevice(d) && (
                      <>
                      <IconButton size="sm" label={`Sensors of ${d.name}`} onClick={() => (setStartTab('sensors'), setEditing(d))}>
                                <GaugeIcon className="h-3.5 w-3.5" />
                              </IconButton>
                              <IconButton size="sm" label={`Parameters of ${d.name}`} onClick={() => (setStartTab('params'), setEditing(d))} className="max-md:hidden">
                                <SlidersHorizontal className="h-3.5 w-3.5" />
                              </IconButton>
                              <IconButton size="sm" label={`Edit ${d.name}`} onClick={() => setEditing(d)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                    </>
                    )}
                    {isAdmin && (
                      <IconButton size="sm" label={`Delete ${d.name}`} onClick={() => setDeleting(d)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {editing && (
        <DeviceEditor
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? null : editing}
          startTab={startTab}
          onClose={() => {
            setEditing(null)
            setStartTab('tracker')
          }}
        />
      )}

      <Modal
        open={!!deleting}
        onClose={() => !del.isPending && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'device'}?`}
        description="This permanently removes the device and its entire position history. This can’t be undone."
        footer={
          <>
            <Button onClick={() => setDeleting(null)} disabled={del.isPending} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" loading={del.isPending} icon={<Trash2 className="h-4 w-4" />} onClick={() => deleting && del.mutate(deleting)}>
              Delete device
            </Button>
          </>
        }
      />
    </div>
  )
}
