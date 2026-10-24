import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { endOfDay, format, startOfDay, subDays, subHours } from 'date-fns'
import { ArrowRight, ChevronDown, Clock, Gauge, MapPinOff, Route, Ruler, TrendingUp } from 'lucide-react'
import { api, qk } from '@/api/client'
import type { Trip } from '@/api/types'
import { MapCanvas, useMapCtx } from '@/components/map/MapCanvas'
import { MapControls } from '@/components/map/MapControls'
import { Field, Input, Select } from '@/components/ui/Input'
import { EmptyState, Skeleton, StatusDot } from '@/components/ui/Misc'
import { RouteLayer } from '@/features/history/RouteLayer'
import { Playback } from '@/features/history/Playback'
import { buildTrack, computeStats, SPEED_STOPS, virtualAt, type Track } from '@/features/history/track'
import { useDeviceList } from '@/store/live'
import { boundsOf } from '@/lib/geo'
import { fmtDistance, fmtDuration } from '@/lib/format'
import { useIsDesktop } from '@/lib/useMedia'
import { useAddress } from '@/lib/geocode'
import { cn } from '@/lib/cn'

type Preset = 'today' | 'yesterday' | '24h' | '7d' | 'custom'
const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '24h', label: '24h' },
  { id: '7d', label: '7 days' },
  { id: 'custom', label: 'Custom' },
]
const LIMIT = 50000

function presetRange(p: Exclude<Preset, 'custom'>): [Date, Date] {
  const now = new Date()
  switch (p) {
    case 'today':
      return [startOfDay(now), now]
    case 'yesterday': {
      const y = subDays(now, 1)
      return [startOfDay(y), endOfDay(y)]
    }
    case '24h':
      return [subHours(now, 24), now]
    case '7d':
      return [subDays(now, 7), now]
  }
}

const toLocalInput = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm")

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white/60 px-3 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.025]">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:text-slate-400">
        {icon}
        {label}
      </div>
      <div className="tabular mt-1 text-[15px] font-semibold text-slate-900 dark:text-white">{value}</div>
    </div>
  )
}

function Addr({ lat, lng }: { lat: number; lng: number }) {
  const g = useAddress(lat, lng, 0)
  if (g.isLoading) return <span className="skeleton inline-block h-3 w-28 align-middle" />
  const text = g.data?.place?.name ?? g.data?.address
  return <span className={cn('truncate', g.data?.place && 'font-medium text-slate-700 dark:text-slate-200')}>{text || `${lat.toFixed(4)}, ${lng.toFixed(4)}`}</span>
}

/** Start → end addresses of a trip (reverse-geocoded through the server, cached). */
function TripAddresses({ trip }: { trip: Trip }) {
  return (
    <div className="mt-1.5 space-y-0.5 pl-7 text-[11.5px] text-slate-500 dark:text-slate-400">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
        <Addr lat={trip.startLat} lng={trip.startLng} />
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
        <Addr lat={trip.endLat} lng={trip.endLng} />
      </div>
    </div>
  )
}

function FitTo({ track, trip, tick, desktop }: { track: Track | null; trip: Trip | null; tick: number; desktop: boolean }) {
  const { map } = useMapCtx()
  useEffect(() => {
    if (!map || !track || track.positions.length === 0) return
    let pts = track.positions
    if (trip) {
      const a = Date.parse(trip.start)
      const b = Date.parse(trip.end)
      pts = pts.filter((_, i) => track.t[i] >= a && track.t[i] <= b)
      if (pts.length === 0) pts = track.positions
    }
    const b = boundsOf(pts.map((p) => [p.lng, p.lat]))
    if (b)
      map.fitBounds(b, {
        padding: desktop ? { top: 60, bottom: 130, left: 400, right: 80 } : { top: 40, bottom: 150, left: 30, right: 60 },
        maxZoom: 16,
        duration: tick === 0 ? 0 : 700,
      })
  }, [map, track, trip, tick, desktop])
  return null
}

export default function HistoryPage() {
  const devices = useDeviceList()
  const desktop = useIsDesktop()
  const [params, setParams] = useSearchParams()
  const deviceId = params.get('device') ? Number(params.get('device')) : null
  // deep link from reports: ?device=&from=&to= (ISO) opens a custom range
  const linkFrom = params.get('from')
  const linkTo = params.get('to')
  const linked = !!linkFrom && !!linkTo && !Number.isNaN(Date.parse(linkFrom)) && !Number.isNaN(Date.parse(linkTo))
  const [preset, setPreset] = useState<Preset>(linked ? 'custom' : 'today')
  const [custom, setCustom] = useState<[string, string]>(() => {
    if (linked) return [toLocalInput(new Date(linkFrom!)), toLocalInput(new Date(linkTo!))]
    const [a, b] = presetRange('24h')
    return [toLocalInput(a), toLocalInput(b)]
  })
  useEffect(() => {
    if (linked) {
      setPreset('custom')
      setCustom([toLocalInput(new Date(linkFrom!)), toLocalInput(new Date(linkTo!))])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkFrom, linkTo])
  const [rangeKey, setRangeKey] = useState(0) // bump to recompute "now"-relative presets
  const [trip, setTrip] = useState<Trip | null>(null)
  const [seek, setSeek] = useState<{ v: number; n: number } | null>(null)
  const [fitTick, setFitTick] = useState(0)
  const [panelOpen, setPanelOpen] = useState(false) // mobile only: show stats & trips

  const [from, to] = useMemo(() => {
    if (preset === 'custom') {
      const a = new Date(custom[0])
      const b = new Date(custom[1])
      return [a.toISOString(), b.toISOString()]
    }
    const [a, b] = presetRange(preset)
    return [a.toISOString(), b.toISOString()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, custom, rangeKey])
  const rangeValid = !Number.isNaN(Date.parse(from)) && !Number.isNaN(Date.parse(to)) && Date.parse(from) < Date.parse(to)

  const enabled = deviceId != null && rangeValid
  const positionsQ = useQuery({
    queryKey: ['positions', deviceId, from, to, 'sensors'],
    queryFn: () => api.positions(deviceId!, from, to, LIMIT, true),
    enabled,
  })
  const tripsQ = useQuery({
    queryKey: ['trips', deviceId, from, to],
    queryFn: () => api.trips(deviceId!, from, to),
    enabled,
  })

  const sensorsQ = useQuery({ queryKey: qk.sensors(deviceId ?? 0), queryFn: () => api.sensors(deviceId!), enabled: deviceId != null, staleTime: 5 * 60_000, meta: { silent: true } })
  const track = useMemo(() => (positionsQ.data ? buildTrack(positionsQ.data) : null), [positionsQ.data])
  const stats = useMemo(() => (track ? computeStats(track) : null), [track])
  const trips = useMemo(() => tripsQ.data ?? [], [tripsQ.data])

  useEffect(() => setTrip(null), [track])

  // default to first device with a position
  useEffect(() => {
    if (deviceId == null && devices.length) {
      const d = devices.find((x) => x.position) ?? devices[0]
      setParams({ device: String(d.id) }, { replace: true })
    }
  }, [deviceId, devices, setParams])

  const device = devices.find((d) => d.id === deviceId)
  const loading = enabled && (positionsQ.isLoading || tripsQ.isLoading)
  const empty = track && track.positions.length === 0

  return (
    <div className="absolute inset-0">
      <MapCanvas className="absolute inset-0">
        <RouteLayer track={track} trips={trips} highlight={trip} />
        <FitTo track={track} trip={trip} tick={fitTick} desktop={desktop} />

        <div className="pointer-events-none absolute inset-0 z-10">
          <aside
            aria-label="History filters"
            className={cn(
              'glass pointer-events-auto absolute flex flex-col overflow-hidden rounded-2xl',
              'inset-x-2 top-2 md:inset-x-auto md:bottom-3 md:left-3 md:top-3 md:w-[360px]',
              'max-h-[calc(100%-200px)] md:max-h-none',
            )}
          >
            <div className="flex items-center justify-between px-4 pt-3.5 md:pt-4">
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">History</h2>
                <p className="text-[12px] text-slate-500 dark:text-slate-400">
                  {device ? (
                    <span className="inline-flex items-center gap-1.5">
                      <StatusDot status={device.status} /> {device.name}
                      {device.plate && <span className="text-slate-400">· {device.plate}</span>}
                    </span>
                  ) : (
                    'Route playback & trips'
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPanelOpen((o) => !o)}
                aria-expanded={panelOpen}
                className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-slate-500 hover:bg-slate-900/5 dark:text-slate-400 dark:hover:bg-white/10 md:hidden"
              >
                {panelOpen ? 'Hide trips' : `Trips${trips.length ? ` (${trips.length})` : ''}`}
                <ChevronDown className={cn('h-4 w-4 transition-transform', panelOpen && 'rotate-180')} />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <div className="space-y-3 px-4 pb-3 pt-3">
                <Field label="Vehicle">
                  {(id) => (
                    <Select
                      id={id}
                      value={deviceId ?? ''}
                      onChange={(e) => setParams(linked ? { device: e.target.value, from: linkFrom!, to: linkTo! } : { device: e.target.value }, { replace: true })}
                    >
                      {deviceId == null && <option value="">Select a vehicle…</option>}
                      {devices.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                          {d.plate ? ` · ${d.plate}` : ''}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <div>
                  <span className="mb-1.5 block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Period</span>
                  <div role="group" aria-label="Period" className="grid grid-cols-5 gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-white/[0.05]">
                    {PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={preset === p.id}
                        onClick={() => {
                          setPreset(p.id)
                          setRangeKey((k) => k + 1)
                        }}
                        className={cn(
                          'h-7 rounded-md text-[11.5px] font-medium transition-colors',
                          preset === p.id
                            ? 'bg-white text-slate-900 shadow-sm dark:bg-white/15 dark:text-white'
                            : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white',
                        )}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                {preset === 'custom' && (
                  <div className="grid animate-fade-in grid-cols-2 gap-2">
                    <Field label="From">
                      {(id) => (
                        <Input
                          id={id}
                          type="datetime-local"
                          value={custom[0]}
                          max={custom[1]}
                          onChange={(e) => setCustom([e.target.value, custom[1]])}
                          className="dark:[&_input]:[color-scheme:dark] [&_input]:px-2 [&_input]:text-[12px]"
                        />
                      )}
                    </Field>
                    <Field label="To">
                      {(id) => (
                        <Input
                          id={id}
                          type="datetime-local"
                          value={custom[1]}
                          min={custom[0]}
                          onChange={(e) => setCustom([custom[0], e.target.value])}
                          className="dark:[&_input]:[color-scheme:dark] [&_input]:px-2 [&_input]:text-[12px]"
                        />
                      )}
                    </Field>
                    {!rangeValid && <p className="col-span-2 text-[12px] text-rose-500">“From” must be before “To”.</p>}
                  </div>
                )}
              </div>

              <div className={cn('flex-col', panelOpen ? 'flex' : 'hidden md:flex')}>
              <div className="mx-4 h-px bg-slate-200/80 dark:bg-white/[0.06]" />

              {deviceId == null ? (
                <EmptyState icon={<Route className="h-5 w-5" />} title="Pick a vehicle" description="Choose a vehicle and a period to replay its route." />
              ) : loading ? (
                <div className="space-y-2 p-4">
                  <div className="grid grid-cols-2 gap-2">
                    {Array.from({ length: 4 }, (_, i) => (
                      <Skeleton key={i} className="h-[58px] rounded-xl" />
                    ))}
                  </div>
                  {Array.from({ length: 3 }, (_, i) => (
                    <Skeleton key={i} className="h-[68px] rounded-xl" />
                  ))}
                </div>
              ) : empty ? (
                <EmptyState
                  icon={<MapPinOff className="h-5 w-5" />}
                  title="No data in this period"
                  description="This vehicle didn’t report any positions in the selected time range."
                />
              ) : stats ? (
                <div className="space-y-3 p-4">
                  <div className="grid grid-cols-2 gap-2">
                    <Stat icon={<Ruler />} label="Distance" value={fmtDistance(stats.distance)} />
                    <Stat icon={<Clock />} label="Driving time" value={fmtDuration(stats.movingTime)} />
                    <Stat icon={<TrendingUp />} label="Max speed" value={`${Math.round(stats.maxSpeed)} km/h`} />
                    <Stat icon={<Gauge />} label="Avg speed" value={`${Math.round(stats.avgSpeed)} km/h`} />
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span>0</span>
                    <span
                      className="h-1.5 flex-1 rounded-full"
                      style={{ background: `linear-gradient(90deg, ${SPEED_STOPS.map(([, c]) => c).join(',')})` }}
                    />
                    <span>120+ km/h</span>
                  </div>
                  {stats.points >= LIMIT && (
                    <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
                      Showing the first {LIMIT.toLocaleString()} points — narrow the period for the full route.
                    </p>
                  )}

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="label-xs">Trips</h3>
                      <span className="text-[11.5px] text-slate-400">{trips.length}</span>
                    </div>
                    {trips.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-center text-[12.5px] text-slate-500 dark:border-white/10 dark:text-slate-400">
                        No trips detected.
                      </p>
                    ) : (
                      <ol className="space-y-1.5">
                        {trips.map((t, i) => {
                          const active = trip?.start === t.start
                          return (
                            <li key={t.start}>
                              <button
                                type="button"
                                aria-pressed={active}
                                onClick={() => {
                                  if (active) {
                                    setTrip(null)
                                    setFitTick((x) => x + 1)
                                    return
                                  }
                                  setTrip(t)
                                  setFitTick((x) => x + 1)
                                  if (track) setSeek({ v: virtualAt(track, Date.parse(t.start)), n: Date.now() })
                                }}
                                className={cn(
                                  'w-full rounded-xl border px-3 py-2.5 text-left transition-colors',
                                  active
                                    ? 'border-brand-500/40 bg-brand-500/10 dark:bg-brand-400/10'
                                    : 'border-slate-200/80 bg-white/60 hover:border-slate-300 dark:border-white/[0.06] dark:bg-white/[0.025] dark:hover:border-white/15',
                                )}
                              >
                                <div className="flex items-center gap-2 text-[12.5px] font-medium text-slate-900 dark:text-white">
                                  <span className="grid h-5 w-5 place-items-center rounded-md bg-slate-900/5 text-[10.5px] font-semibold text-slate-500 dark:bg-white/10 dark:text-slate-300">
                                    {i + 1}
                                  </span>
                                  <span className="tabular">{format(Date.parse(t.start), 'HH:mm')}</span>
                                  <ArrowRight className="h-3 w-3 text-slate-400" />
                                  <span className="tabular">{format(Date.parse(t.end), 'HH:mm')}</span>
                                  {preset === '7d' || preset === 'custom' ? (
                                    <span className="text-[11.5px] font-normal text-slate-400">{format(Date.parse(t.start), 'd MMM')}</span>
                                  ) : null}
                                  <span className="tabular ml-auto text-slate-500 dark:text-slate-400">{fmtDuration(t.duration)}</span>
                                </div>
                                <TripAddresses trip={t} />
                                <div className="tabular mt-1 flex gap-3 pl-7 text-[11.5px] text-slate-500 dark:text-slate-400">
                                  <span>{fmtDistance(t.distance)}</span>
                                  <span>max {Math.round(t.maxSpeed)} km/h</span>
                                  <span>avg {Math.round(t.avgSpeed)} km/h</span>
                                </div>
                              </button>
                            </li>
                          )
                        })}
                      </ol>
                    )}
                  </div>
                </div>
              ) : null}
              </div>
            </div>
          </aside>

          <MapControls className="absolute bottom-[184px] right-2 md:bottom-auto md:right-3 md:top-3" />

          {track && track.positions.length > 1 && (
            <div className="absolute inset-x-2 bottom-2 md:bottom-4 md:left-[384px] md:right-16 lg:left-[400px] lg:right-auto lg:w-[min(720px,calc(100%-480px))]">
              <Playback track={track} seek={seek} sensors={sensorsQ.data} />
            </div>
          )}
        </div>
      </MapCanvas>
    </div>
  )
}
