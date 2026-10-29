import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { format, isToday, isYesterday, startOfDay, subDays, subHours } from 'date-fns'
import { BellOff, ChevronRight, History, Map as MapIcon, MapPin, RefreshCw, X } from 'lucide-react'
import { api, qk } from '@/api/client'
import { EVENT_TYPES, type EventQuery, type EventType, type FleetEvent } from '@/api/types'
import { MapCanvas, useMapCtx } from '@/components/map/MapCanvas'
import { EventPin } from '@/components/map/EventPin'
import { GeofenceLayer } from '@/components/map/GeofenceLayer'
import { Button, IconButton } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { EmptyState, Skeleton } from '@/components/ui/Misc'
import { useGeofences } from '@/features/geofences/useGeofences'
import { useDeviceList, useLive } from '@/store/live'
import { EVENT_META, eventDetail, eventMeta } from '@/lib/events'
import { fmtCoord, fmtDateTime, fmtSpeed } from '@/lib/format'
import { useMedia } from '@/lib/useMedia'
import { cn } from '@/lib/cn'

type Preset = 'today' | '24h' | '7d' | '30d' | 'custom'
/** always offered as filter chips; Phase 3 types appear once they occur */
const CORE_TYPES: string[] = ['geofenceEnter', 'geofenceExit', 'overspeed', 'ignitionOn', 'ignitionOff', 'alarm']

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: '24h', label: '24h' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'custom', label: 'Custom' },
]
const LIMIT = 500
const toLocalInput = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm")

function presetFrom(p: Exclude<Preset, 'custom'>): Date {
  const now = new Date()
  switch (p) {
    case 'today':
      return startOfDay(now)
    case '24h':
      return subHours(now, 24)
    case '7d':
      return subDays(now, 7)
    case '30d':
      return subDays(now, 30)
  }
}

function dayLabel(t: number) {
  if (isToday(t)) return `Today · ${format(t, 'EEE d MMM')}`
  if (isYesterday(t)) return `Yesterday · ${format(t, 'EEE d MMM')}`
  return format(t, 'EEEE d MMM yyyy')
}

/** Keeps the preview map centred on the selected event. */
function Focus({ lng, lat }: { lng: number; lat: number }) {
  const { map } = useMapCtx()
  useEffect(() => {
    map?.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 14), duration: 500 })
  }, [map, lng, lat])
  return null
}

function detailLabel(t: string): string {
  if (t === 'alarm') return 'Alarm'
  if (t.startsWith('geofence')) return 'Geofence'
  if (t.startsWith('job')) return 'Job'
  if (t.startsWith('route')) return 'Route'
  if (t === 'fuelDrain' || t === 'refuel') return 'Fuel'
  if (t.startsWith('sensor')) return 'Sensor'
  return 'Details'
}

function EventPreview({ e, onClose, compact }: { e: FleetEvent; onClose?: () => void; compact?: boolean }) {
  const nav = useNavigate()
  const dev = useLive((s) => s.byId[e.deviceId])
  const geofences = useGeofences(e.geofenceId != null, true)
  const fence = geofences.data?.filter((g) => g.id === e.geofenceId) ?? []
  const m = eventMeta(e.type)
  const Icon = m.icon
  const a = e.attributes ?? {}
  return (
    <div className="flex flex-col">
      <div className={cn('relative overflow-hidden', compact ? 'h-[200px] rounded-xl' : 'h-[300px] rounded-t-2xl')}>
        <MapCanvas className="absolute inset-0" center={[e.lng, e.lat]} zoom={14} attribution={!compact}>
          {fence.length > 0 && <GeofenceLayer geofences={fence} />}
          <EventPin lng={e.lng} lat={e.lat} color={m.color} />
          <Focus lng={e.lng} lat={e.lat} />
        </MapCanvas>
        {onClose && (
          <IconButton
            label="Close preview"
            size="sm"
            onClick={onClose}
            className="glass absolute right-2 top-2 z-10 !rounded-lg !text-slate-600 dark:!text-slate-300"
          >
            <X className="h-4 w-4" />
          </IconButton>
        )}
      </div>
      <div className={cn(compact ? 'pt-3' : 'p-4')}>
        {!compact && (
          <div className="flex items-start gap-3">
            <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', m.chip)}>
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="label-xs">{m.label}</div>
              <p className="mt-0.5 font-semibold leading-snug text-slate-900 dark:text-white">{e.message}</p>
            </div>
          </div>
        )}
        <dl className={cn('grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-[12.5px]', !compact && 'mt-3')}>
          <dt className="text-slate-500 dark:text-slate-400">Time</dt>
          <dd className="tabular text-right text-slate-900 dark:text-white">{fmtDateTime(e.time)}</dd>
          <dt className="text-slate-500 dark:text-slate-400">Vehicle</dt>
          <dd className="truncate text-right text-slate-900 dark:text-white">{dev?.name ?? `#${e.deviceId}`}</dd>
          {typeof a.speed === 'number' && (
            <>
              <dt className="text-slate-500 dark:text-slate-400">Speed</dt>
              <dd className="tabular text-right font-medium text-orange-600 dark:text-orange-400">
                {fmtSpeed(a.speed)}
                {typeof a.limit === 'number' && <span className="font-normal text-slate-400"> / limit {Math.round(a.limit)}</span>}
              </dd>
            </>
          )}
          {typeof a.maxSpeed === 'number' && (
            <>
              <dt className="text-slate-500 dark:text-slate-400">Peak speed</dt>
              <dd className="tabular text-right text-slate-900 dark:text-white">{fmtSpeed(a.maxSpeed)}</dd>
            </>
          )}
          {eventDetail(e) && e.type !== 'overspeed' && (
            <>
              <dt className="text-slate-500 dark:text-slate-400">{detailLabel(e.type)}</dt>
              <dd className="truncate text-right text-slate-900 dark:text-white">{eventDetail(e)}</dd>
            </>
          )}
          <dt className="text-slate-500 dark:text-slate-400">Location</dt>
          <dd className="tabular truncate text-right font-mono text-[11.5px] text-slate-900 dark:text-white">{fmtCoord(e.lat, e.lng)}</dd>
        </dl>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant="primary"
            icon={<MapIcon className="h-3.5 w-3.5" />}
            onClick={() => nav(`/live?device=${e.deviceId}&at=${e.lat.toFixed(6)},${e.lng.toFixed(6)}&evt=${e.type}`)}
          >
            Live Map
          </Button>
          <Button size="sm" icon={<History className="h-3.5 w-3.5" />} onClick={() => nav(`/history?device=${e.deviceId}`)}>
            History
          </Button>
        </div>
      </div>
    </div>
  )
}

function EventRow({
  e,
  deviceName,
  selected,
  onClick,
}: {
  e: FleetEvent
  deviceName?: string
  selected: boolean
  onClick: () => void
}) {
  const m = eventMeta(e.type)
  const Icon = m.icon
  const detail = eventDetail(e)
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={selected}
      className={cn(
        'group relative flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors sm:px-4',
        selected ? 'bg-brand-500/[0.07] dark:bg-brand-400/[0.08]' : 'hover:bg-slate-50 dark:hover:bg-white/[0.025]',
      )}
    >
      {(selected || e.type === 'alarm') && (
        <span className={cn('absolute inset-y-1 left-0 w-[3px] rounded-r-full', selected ? 'bg-brand-500' : 'bg-rose-500')} />
      )}
      <span className="tabular w-[42px] shrink-0 text-[12px] text-slate-500 dark:text-slate-400">{format(Date.parse(e.time), 'HH:mm')}</span>
      <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', m.chip)}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-slate-900 dark:text-white', e.type === 'alarm' ? 'font-semibold' : 'font-medium')}>
          {e.message}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-slate-500 dark:text-slate-400">
          <span className={cn('shrink-0 rounded px-1.5 py-px text-[10.5px] font-semibold ring-1 ring-inset', m.pill)}>{m.short}</span>
          {detail && <span className="truncate">{detail}</span>}
          {deviceName && !e.message.includes(deviceName) && <span className="truncate">· {deviceName}</span>}
        </span>
      </span>
      <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-300 transition-transform dark:text-slate-600', selected && 'rotate-90 lg:rotate-0 text-navy-600')} />
    </button>
  )
}

export default function AlertsPage() {
  const [params, setParams] = useSearchParams()
  const devices = useDeviceList()
  const byId = useLive((s) => s.byId)
  const wide = useMedia('(min-width: 1024px)')
  const deviceId = params.get('device') ? Number(params.get('device')) : undefined
  const type = (params.get('type') as EventType | null) ?? undefined
  const [preset, setPreset] = useState<Preset>('7d')
  const [custom, setCustom] = useState(() => ({ from: toLocalInput(subDays(new Date(), 1)), to: toLocalInput(new Date()) }))
  const [presetTick, setPresetTick] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const setParam = (k: string, v: string | undefined) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }

  const query: EventQuery = useMemo(() => {
    if (preset === 'custom') {
      const f = Date.parse(custom.from)
      const t = Date.parse(custom.to)
      return {
        deviceId,
        type,
        from: Number.isFinite(f) ? new Date(f).toISOString() : undefined,
        to: Number.isFinite(t) ? new Date(t).toISOString() : undefined,
        limit: LIMIT,
      }
    }
    // presets leave `to` open so live events keep appearing
    return { deviceId, type, from: presetFrom(preset).toISOString(), limit: LIMIT }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, type, preset, custom, presetTick])

  const events = useQuery({ queryKey: qk.events(query), queryFn: () => api.events(query), placeholderData: (p) => p })
  const list = useMemo(() => events.data ?? [], [events.data])
  const selected = list.find((e) => e.id === selectedId) ?? null

  // select the newest event by default on wide screens
  useEffect(() => {
    if (wide && !selected && list.length) setSelectedId(list[0].id)
  }, [wide, selected, list])

  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; items: FleetEvent[] }> = []
    for (const e of list) {
      const t = Date.parse(e.time)
      const key = format(t, 'yyyy-MM-dd')
      let g = out[out.length - 1]
      if (!g || g.key !== key) {
        g = { key, label: dayLabel(t), items: [] }
        out.push(g)
      }
      g.items.push(e)
    }
    return out
  }, [list])

  const counts = useMemo(() => {
    const c: Partial<Record<EventType, number>> = {}
    for (const e of list) c[e.type] = (c[e.type] ?? 0) + 1
    return c
  }, [list])

  const hasFilters = deviceId != null || type != null

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 p-3 sm:p-5 lg:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-title">Alerts</h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400">
              {events.isLoading
                ? 'Loading…'
                : `${list.length === LIMIT ? `Latest ${LIMIT}` : list.length} event${list.length === 1 ? '' : 's'}${
                    counts.alarm ? ` · ${counts.alarm} alarm${counts.alarm === 1 ? '' : 's'}` : ''
                  }`}
            </p>
          </div>
          <Button
            size="sm"
            icon={<RefreshCw className={cn('h-3.5 w-3.5', events.isFetching && 'animate-spin')} />}
            onClick={() => (preset === 'custom' ? void events.refetch() : setPresetTick((t) => t + 1))}
          >
            Refresh
          </Button>
        </div>

        {/* filters */}
        <div className="card space-y-3 p-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <Select
              aria-label="Vehicle"
              value={deviceId ?? ''}
              onChange={(e) => setParam('device', e.target.value || undefined)}
              className="lg:w-56"
            >
              <option value="">All vehicles</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <div role="group" aria-label="Period" className="grid grid-cols-5 gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-white/[0.05] lg:w-[380px]">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={preset === p.id}
                  onClick={() => setPreset(p.id)}
                  className={cn(
                    'h-8 rounded-md text-[12px] font-medium transition-colors',
                    preset === p.id
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-white/15 dark:text-white'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="grid grid-cols-2 gap-2 lg:flex">
                <Input
                  type="datetime-local"
                  aria-label="From"
                  value={custom.from}
                  max={custom.to}
                  onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                  className="dark:[&_input]:[color-scheme:dark]"
                />
                <Input
                  type="datetime-local"
                  aria-label="To"
                  value={custom.to}
                  min={custom.from}
                  onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                  className="dark:[&_input]:[color-scheme:dark]"
                />
              </div>
            )}
            {hasFilters && (
              <button
                type="button"
                onClick={() => setParams({}, { replace: true })}
                className="inline-flex items-center gap-1 self-start rounded text-[12px] font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white lg:ml-auto lg:self-center"
              >
                <X className="h-3.5 w-3.5" /> Clear filters
              </button>
            )}
          </div>
          <div role="group" aria-label="Event type" className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5">
            <TypeChip active={!type} onClick={() => setParam('type', undefined)} label="All types" />
            {EVENT_TYPES.filter((t) => t === type || CORE_TYPES.includes(t) || (counts[t] ?? 0) > 0).map((t) => (
              <TypeChip
                key={t}
                active={type === t}
                onClick={() => setParam('type', type === t ? undefined : t)}
                label={EVENT_META[t].label}
                color={EVENT_META[t].color}
                count={!type ? counts[t] : undefined}
              />
            ))}
          </div>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="card overflow-hidden">
            {events.isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : events.isError && !list.length ? (
              <EmptyState
                icon={<BellOff className="h-5 w-5" />}
                title="Couldn’t load alerts"
                description={events.error instanceof Error ? events.error.message : undefined}
                action={<Button onClick={() => void events.refetch()}>Try again</Button>}
              />
            ) : list.length === 0 ? (
              <EmptyState
                icon={<BellOff className="h-5 w-5" />}
                title="No alerts in this period"
                description={
                  hasFilters
                    ? 'Try another vehicle, type or a longer period.'
                    : 'Create geofences and set speed limits to start receiving alerts.'
                }
              />
            ) : (
              <div className={cn(events.isFetching && events.isPlaceholderData && 'opacity-60')}>
                {groups.map((g) => (
                  <section key={g.key} aria-label={g.label}>
                    <h2 className="sticky top-0 z-[1] border-y border-slate-200/80 bg-slate-50/95 px-4 py-1.5 text-[11.5px] font-semibold text-slate-500 backdrop-blur first:border-t-0 dark:border-white/[0.06] dark:bg-ink-850/95 dark:text-slate-400">
                      {g.label}
                      <span className="ml-1.5 font-normal text-slate-400">{g.items.length}</span>
                    </h2>
                    <ul className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                      {g.items.map((e) => (
                        <li key={e.id}>
                          <EventRow
                            e={e}
                            deviceName={byId[e.deviceId]?.name}
                            selected={e.id === selectedId}
                            onClick={() => setSelectedId((s) => (s === e.id && !wide ? null : e.id))}
                          />
                          {!wide && e.id === selectedId && (
                            <div className="animate-fade-in border-t border-slate-100 bg-slate-50/60 px-3 pb-3 pt-3 dark:border-white/[0.04] dark:bg-white/[0.015]">
                              <EventPreview e={e} compact />
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </div>

          {wide && (
            <aside className="card sticky top-0 overflow-hidden">
              {selected ? (
                <EventPreview key="preview" e={selected} />
              ) : (
                <EmptyState icon={<MapPin className="h-5 w-5" />} title="Select an alert" description="See where it happened on the map." />
              )}
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}

function TypeChip({
  active,
  onClick,
  label,
  color,
  count,
}: {
  active: boolean
  onClick: () => void
  label: string
  color?: string
  count?: number
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors',
        active
          ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 dark:hover:border-white/20 dark:hover:text-white',
      )}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {label}
      {count != null && <span className={cn('tabular text-[11px]', active ? 'opacity-70' : 'text-slate-400')}>{count}</span>}
    </button>
  )
}
