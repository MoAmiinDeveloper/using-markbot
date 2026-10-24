import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { format, startOfDay, endOfDay, subDays } from 'date-fns'
import { ArrowRight, History } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import type { FleetRoute, Trip } from '@/api/types'
import { MapCanvas } from '@/components/map/MapCanvas'
import { RoutesLayer } from '@/components/map/RoutesLayer'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Misc'
import { FitStops } from '@/features/dispatch/StopsLayer'
import { useDeviceList } from '@/store/live'
import { fmtDistance, fmtDuration } from '@/lib/format'
import { toast } from '@/store/toast'
import { cn } from '@/lib/cn'

/** Pick a recorded trip (vehicle + time range), preview it, and turn it into a route on the server. */
export function FromTripDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (r: FleetRoute) => void }) {
  const devices = useDeviceList().filter((d) => d.position)
  const [deviceId, setDeviceId] = useState<number | null>(devices[0]?.id ?? null)
  const [day, setDay] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [trip, setTrip] = useState<Trip | null>(null)
  const [name, setName] = useState('')
  const dayFrom = startOfDay(new Date(`${day}T00:00:00`)).toISOString()
  const dayTo = endOfDay(new Date(`${day}T00:00:00`)).toISOString()
  const trips = useQuery({ queryKey: ['trips', deviceId, dayFrom, dayTo], queryFn: () => api.trips(deviceId!, dayFrom, dayTo), enabled: deviceId != null })
  useEffect(() => setTrip(trips.data?.[0] ?? null), [trips.data])
  const positions = useQuery({
    queryKey: ['positions', deviceId, trip?.start, trip?.end],
    queryFn: () => api.positions(deviceId!, trip!.start, trip!.end, 5000),
    enabled: deviceId != null && !!trip,
  })
  const preview = useMemo(() => {
    const ps = positions.data ?? []
    const step = Math.max(1, Math.floor(ps.length / 300))
    return ps.filter((_, i) => i % step === 0 || i === ps.length - 1).map((p) => [p.lng, p.lat] as [number, number])
  }, [positions.data])
  const dev = devices.find((d) => d.id === deviceId)
  useEffect(() => {
    if (trip && dev) setName(`${dev.name} · ${format(Date.parse(trip.start), 'd MMM HH:mm')}`)
  }, [trip, dev])

  const create = useMutation({
    meta: { silent: true },
    mutationFn: () => api.routeFromTrip({ deviceId: deviceId!, from: trip!.start, to: trip!.end, name: name.trim() }),
    onSuccess: (r) => {
      toast.success('Route created from trip', `${r.name} · ${r.path.length} points`)
      onCreated(r)
    },
    onError: (e) => toast.error('Could not create the route', e instanceof ApiError ? e.message : String(e)),
  })

  return (
    <Modal open onClose={onClose} title="Create route from a trip" description="The recorded track is simplified (~20 m) into a route you can then adjust." className="!max-w-3xl" phoneFull>
      <div className="mt-4 grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-3">
          <Field label="Vehicle">
            {(id) => (
              <Select id={id} value={deviceId ?? ''} onChange={(e) => setDeviceId(Number(e.target.value))}>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Day">
            {(id) => (
              <Input id={id} type="date" value={day} max={format(new Date(), 'yyyy-MM-dd')} min={format(subDays(new Date(), 90), 'yyyy-MM-dd')} onChange={(e) => setDay(e.target.value)} className="dark:[&_input]:[color-scheme:dark]" />
            )}
          </Field>
          <div>
            <span className="mb-1.5 block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Trip</span>
            {trips.isLoading ? (
              <Skeleton className="h-28 rounded-xl" />
            ) : !trips.data?.length ? (
              <p className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-center text-[12.5px] text-slate-500 dark:border-white/10">No trips that day.</p>
            ) : (
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {trips.data.map((t) => {
                  const on = trip?.start === t.start
                  return (
                    <li key={t.start}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => setTrip(t)}
                        className={cn(
                          'w-full rounded-lg border px-2.5 py-2 text-left text-[12.5px]',
                          on ? 'border-brand-500/50 bg-brand-500/10' : 'border-slate-200/80 hover:border-slate-300 dark:border-white/[0.07]',
                        )}
                      >
                        <span className="tabular flex items-center gap-1.5 font-medium text-slate-900 dark:text-white">
                          {format(Date.parse(t.start), 'HH:mm')} <ArrowRight className="h-3 w-3 text-slate-400" /> {format(Date.parse(t.end), 'HH:mm')}
                          <span className="ml-auto font-normal text-slate-500">{fmtDistance(t.distance)}</span>
                        </span>
                        <span className="text-[11.5px] text-slate-500">{fmtDuration(t.duration)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <Field label="Route name">
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Mogadishu → Afgooye" />}
          </Field>
        </div>
        <div className="relative h-[260px] overflow-hidden rounded-xl border border-slate-200/80 dark:border-white/[0.07] md:h-auto md:min-h-[360px]">
          <MapCanvas className="absolute inset-0" attribution={false}>
            {preview.length >= 2 && <RoutesLayer routes={[{ id: -1, name: 'Preview', color: '#8b5cf6', path: preview, corridor: 150 }]} prefix="trip-preview" labels={false} />}
            <FitStops points={preview} fitKey={`${trip?.start}:${preview.length}`} padding={30} />
          </MapCanvas>
          {!trip && (
            <div className="absolute inset-0 grid place-items-center text-[12.5px] text-slate-500">
              <span className="flex items-center gap-2">
                <History className="h-4 w-4" /> Pick a trip to preview it
              </span>
            </div>
          )}
          {preview.length > 0 && (
            <span className="glass absolute left-2 top-2 rounded-lg px-2 py-1 text-[11.5px] font-medium text-slate-700 dark:text-slate-200">
              {positions.data?.length.toLocaleString()} recorded fixes
            </span>
          )}
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!trip || !name.trim()} loading={create.isPending} onClick={() => create.mutate()}>
          Create route
        </Button>
      </div>
    </Modal>
  )
}
