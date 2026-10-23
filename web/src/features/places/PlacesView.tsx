import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import maplibregl, { type MapMouseEvent } from 'maplibre-gl'
import { ArrowLeft, Check, MapPin, MapPinPlus, Maximize, MousePointerClick, Pencil, Search, SearchX, Trash2, TriangleAlert, Users, X } from 'lucide-react'
import { api, ApiError, qk } from '@/api/client'
import { PLACE_CATEGORIES, type Place, type PlaceCategory, type PlaceInput } from '@/api/types'
import { MapCanvas, useMapCtx } from '@/components/map/MapCanvas'
import { ControlButton, ControlGroup, MapControls } from '@/components/map/MapControls'
import { PlacesLayer } from '@/components/map/PlacesLayer'
import { VehicleLayer } from '@/components/map/VehicleLayer'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState, Skeleton } from '@/components/ui/Misc'
import { usePlaces } from '@/features/common/queries'
import { useAccess } from '@/lib/access'
import { boundsOf } from '@/lib/geo'
import { PLACE_META, placeMeta } from '@/lib/ops'
import { fmtCoord, fmtDistance } from '@/lib/format'
import { useAddress } from '@/lib/geocode'
import { useIsDesktop } from '@/lib/useMedia'
import { useDeviceList } from '@/store/live'
import { toast } from '@/store/toast'
import { cn } from '@/lib/cn'

interface Draft {
  id: number | null
  name: string
  category: PlaceCategory
  lat: number | null
  lng: number | null
  radius: number
  color: string
  touched: boolean
}

const pad = (desktop: boolean) => (desktop ? { top: 70, bottom: 60, left: 410, right: 80 } : { top: 70, bottom: Math.round(window.innerHeight * 0.5), left: 30, right: 60 })

/** Map clicks while picking a location; a draggable pin for the draft. */
function DraftPin({ draft, picking, onPick }: { draft: Draft | null; picking: boolean; onPick: (lat: number, lng: number) => void }) {
  const { map } = useMapCtx()
  const marker = useRef<maplibregl.Marker | null>(null)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick

  useEffect(() => {
    if (!map || !picking) return
    const onClick = (e: MapMouseEvent) => onPickRef.current(e.lngLat.lat, e.lngLat.lng)
    map.getCanvas().style.cursor = 'crosshair'
    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
      map.getCanvas().style.cursor = ''
    }
  }, [map, picking])

  const has = draft?.lat != null && draft?.lng != null
  useEffect(() => {
    if (!map || !has) return
    const el = document.createElement('div')
    el.className = 'event-pin'
    el.style.setProperty('--pin', draft!.color)
    el.title = 'Drag to move'
    el.appendChild(document.createElement('span'))
    const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([draft!.lng!, draft!.lat!]).addTo(map)
    m.on('dragend', () => {
      const p = m.getLngLat()
      onPickRef.current(p.lat, p.lng)
    })
    marker.current = m
    return () => {
      m.remove()
      marker.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, has, draft?.color])
  useEffect(() => {
    if (has) marker.current?.setLngLat([draft!.lng!, draft!.lat!])
  }, [has, draft?.lat, draft?.lng]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

function Camera({ places, focus, tick, desktop }: { places: Place[]; focus: { lat: number; lng: number } | null; tick: number; desktop: boolean }) {
  const { map } = useMapCtx()
  const did = useRef(false)
  const fit = (animate: boolean) => {
    const b = boundsOf(places.map((p) => [p.lng, p.lat]))
    if (map && b) map.fitBounds(b, { padding: pad(desktop), maxZoom: 14, duration: animate ? 700 : 0 })
  }
  useEffect(() => {
    if (!map || did.current || !places.length) return
    did.current = true
    fit(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, places])
  useEffect(() => {
    if (tick) fit(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])
  const key = focus ? `${focus.lat.toFixed(5)},${focus.lng.toFixed(5)}` : null
  useEffect(() => {
    if (!map || !focus) return
    map.easeTo({ center: [focus.lng, focus.lat], zoom: Math.max(map.getZoom(), 15), padding: pad(desktop), duration: 700 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key])
  return null
}

function AddressLine({ lat, lng }: { lat: number; lng: number }) {
  const g = useAddress(lat, lng)
  return <span className="truncate">{g.data?.address && !g.data.place ? g.data.address : fmtCoord(lat, lng)}</span>
}

export function PlacesView({ tabs }: { tabs: ReactNode }) {
  const { canManage } = useAccess()
  const desktop = useIsDesktop()
  const qc = useQueryClient()
  const devices = useDeviceList()
  const q = usePlaces()
  const places = useMemo(() => q.data ?? [], [q.data])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState<Place | null>(null)
  const [tick, setTick] = useState(0)
  const [showVehicles, setShowVehicles] = useState(false)
  const selected = places.find((p) => p.id === selectedId) ?? null
  const picking = !!draft && draft.lat == null
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return places.filter((p) => !s || p.name.toLowerCase().includes(s) || placeMeta(p.category).label.toLowerCase().includes(s)).sort((a, b) => a.name.localeCompare(b.name))
  }, [places, search])

  const startNew = () => {
    setSelectedId(null)
    setDraft({ id: null, name: '', category: 'customer', lat: null, lng: null, radius: 150, color: PLACE_META.customer.color, touched: false })
  }
  const startEdit = (p: Place) => setDraft({ id: p.id, name: p.name, category: p.category, lat: p.lat, lng: p.lng, radius: p.radius, color: p.color || placeMeta(p.category).color, touched: false })

  const save = useMutation({
    meta: { silent: true },
    mutationFn: (d: Draft) => {
      const input: PlaceInput = { name: d.name.trim(), category: d.category, lat: +d.lat!.toFixed(7), lng: +d.lng!.toFixed(7), radius: Math.round(d.radius), color: d.color }
      return d.id == null ? api.createPlace(input) : api.updatePlace(d.id, input)
    },
    onSuccess: (p, d) => {
      qc.setQueryData<Place[]>(qk.places, (l) => (l ? [...l.filter((x) => x.id !== p.id), p] : [p]))
      void qc.invalidateQueries({ queryKey: qk.places })
      toast.success(d.id == null ? 'Place created' : 'Place saved', p.name)
      setDraft(null)
      setSelectedId(p.id)
    },
    onError: (e) => toast.error('Could not save the place', e instanceof ApiError ? e.message : String(e)),
  })
  const del = useMutation({
    mutationFn: (p: Place) => api.deletePlace(p.id),
    onSuccess: (_, p) => {
      qc.setQueryData<Place[]>(qk.places, (l) => l?.filter((x) => x.id !== p.id))
      toast.success('Place deleted', p.name)
      setDeleting(null)
      setSelectedId(null)
      setDraft(null)
    },
  })

  const nameErr = draft && !draft.name.trim() ? 'Name the place' : undefined
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!draft) return
    setDraft({ ...draft, touched: true })
    if (nameErr || draft.lat == null) return
    save.mutate(draft)
  }
  const mode: 'list' | 'detail' | 'edit' = draft ? 'edit' : selected ? 'detail' : 'list'
  const focus = draft?.lat != null ? { lat: draft.lat, lng: draft.lng! } : selected ? { lat: selected.lat, lng: selected.lng } : null
  const draftPlace: Place[] =
    draft && draft.lat != null ? [{ id: -1, name: draft.name || 'New place', category: draft.category, lat: draft.lat, lng: draft.lng!, radius: draft.radius, color: draft.color, createdAt: '' }] : []

  return (
    <div className="absolute inset-0">
      <MapCanvas className="absolute inset-0">
        {showVehicles && <VehicleLayer devices={devices} hover={!draft} />}
        <PlacesLayer places={[...places, ...draftPlace]} selectedId={draft ? -1 : selectedId} hiddenId={draft?.id ?? null} onSelect={draft ? undefined : (id) => setSelectedId(id)} />
        <DraftPin draft={draft} picking={!!draft} onPick={(lat, lng) => setDraft((d) => (d ? { ...d, lat, lng } : d))} />
        <Camera places={places} focus={focus} tick={tick} desktop={desktop} />

        <div className="pointer-events-none absolute inset-0 z-10">
          {picking && (
            <div role="status" className="glass pointer-events-auto absolute inset-x-2 top-2 z-20 flex animate-slide-up items-center gap-2 rounded-2xl py-1.5 pl-3 pr-1.5 md:inset-x-auto md:left-1/2 md:top-3 md:-translate-x-1/2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-500/12 text-navy-600 dark:text-brand-300">
                <MousePointerClick className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 text-[12.5px] font-medium text-slate-800 dark:text-slate-100 md:whitespace-nowrap">Click the map where the place is</span>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          )}

          <section
            aria-label="Places"
            className={cn(
              'glass pointer-events-auto absolute flex flex-col overflow-hidden rounded-2xl transition-[height,transform,opacity] duration-300 ease-out',
              'inset-x-2 bottom-2 md:inset-x-auto md:bottom-3 md:left-3 md:top-3 md:h-auto md:w-[360px]',
              mode === 'edit' ? 'h-[62%]' : 'h-[46%]',
              picking && 'max-md:pointer-events-none max-md:translate-y-8 max-md:opacity-0',
            )}
          >
            <div className="flex justify-center pt-2 md:hidden">
              <span className="h-1 w-10 rounded-full bg-slate-300 dark:bg-white/20" />
            </div>
            {mode === 'list' && (
              <>
                <div className="px-4 pt-2 md:pt-4">{tabs}</div>
                <div className="px-4 pb-3 pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">Places</h2>
                      <p className="text-[12px] text-slate-500 dark:text-slate-400">
                        {q.isLoading ? 'Loading…' : `${places.length} point${places.length === 1 ? '' : 's'} of interest · shown as addresses`}
                      </p>
                    </div>
                    {canManage && (
                      <Button size="sm" variant="primary" icon={<MapPinPlus className="h-3.5 w-3.5" />} onClick={startNew}>
                        New
                      </Button>
                    )}
                  </div>
                  {places.length > 5 && (
                    <Input icon={<Search className="h-4 w-4" />} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter places" aria-label="Filter places" className="mt-3" />
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-200/80 p-1.5 dark:border-white/[0.06]">
                  {q.isLoading ? (
                    <div className="space-y-1.5 p-1.5">
                      {Array.from({ length: 4 }, (_, i) => (
                        <Skeleton key={i} className="h-14 w-full rounded-xl" />
                      ))}
                    </div>
                  ) : q.isError ? (
                    <EmptyState icon={<TriangleAlert className="h-5 w-5" />} title="Couldn’t load places" action={<Button size="sm" onClick={() => void q.refetch()}>Retry</Button>} />
                  ) : places.length === 0 ? (
                    <EmptyState
                      icon={<MapPin className="h-5 w-5" />}
                      title="No places yet"
                      description="Name your depots, customers and fuel stations — vehicles at a place show its name instead of a street address."
                      action={canManage && <Button size="sm" variant="primary" icon={<MapPinPlus className="h-3.5 w-3.5" />} onClick={startNew}>New place</Button>}
                    />
                  ) : rows.length === 0 ? (
                    <EmptyState icon={<SearchX className="h-5 w-5" />} title="No places match" />
                  ) : (
                    <ul>
                      {rows.map((p) => {
                        const m = placeMeta(p.category)
                        return (
                          <li key={p.id}>
                            <button type="button" onClick={() => setSelectedId(p.id)} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-slate-900/[0.04] dark:hover:bg-white/[0.05]">
                              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `${p.color || m.color}24`, color: p.color === '#ffd700' || (!p.color && m.color === '#ffd700') ? '#b89b00' : p.color || m.color }}>
                                <m.icon className="h-[18px] w-[18px]" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium text-slate-900 dark:text-white">{p.name}</span>
                                <span className="mt-0.5 block truncate text-[12px] text-slate-500 dark:text-slate-400">
                                  {m.label} · {fmtDistance(p.radius)} radius
                                </span>
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </>
            )}

            {mode === 'detail' && selected && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex items-start gap-3 px-4 pb-3 pt-2 md:pt-4">
                  <IconButton size="sm" label="Back to list" onClick={() => setSelectedId(null)} className="-ml-1.5 mt-0.5">
                    <ArrowLeft className="h-4 w-4" />
                  </IconButton>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">{selected.name}</h2>
                    <p className="text-[12px] text-slate-500 dark:text-slate-400">{placeMeta(selected.category).label}</p>
                  </div>
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
                  <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 rounded-xl border border-slate-200/80 bg-white/60 px-3 py-2.5 text-[12.5px] dark:border-white/[0.06] dark:bg-white/[0.025]">
                    <dt className="text-slate-500 dark:text-slate-400">Radius</dt>
                    <dd className="tabular text-right text-slate-900 dark:text-white">{fmtDistance(selected.radius)}</dd>
                    <dt className="text-slate-500 dark:text-slate-400">Location</dt>
                    <dd className="tabular truncate text-right font-mono text-[12px] text-slate-900 dark:text-white">{fmtCoord(selected.lat, selected.lng)}</dd>
                    <dt className="text-slate-500 dark:text-slate-400">Street</dt>
                    <dd className="flex justify-end text-right text-slate-900 dark:text-white">
                      <AddressLine lat={selected.lat} lng={selected.lng} />
                    </dd>
                  </dl>
                  <p className="text-[12px] text-slate-500 dark:text-slate-400">Vehicles within the radius are shown “At {selected.name}” on the Live Map and in reports.</p>
                  {canManage && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" icon={<Pencil className="h-3.5 w-3.5" />} className="flex-1" onClick={() => startEdit(selected)}>
                        Edit
                      </Button>
                      <Button size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} className="flex-1 hover:!text-rose-600" onClick={() => setDeleting(selected)}>
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {mode === 'edit' && draft && (
              <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
                <div className="flex items-center gap-2 px-4 pb-3 pt-2 md:pt-4">
                  <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">{draft.id == null ? 'New place' : `Edit ${places.find((p) => p.id === draft.id)?.name ?? 'place'}`}</h2>
                  <IconButton size="sm" label="Cancel editing" onClick={() => setDraft(null)}>
                    <X className="h-4 w-4" />
                  </IconButton>
                </div>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto border-t border-slate-200/80 px-4 py-4 dark:border-white/[0.06]">
                  {draft.lat == null ? (
                    <div className={cn('flex gap-3 rounded-xl border border-dashed px-3 py-3', draft.touched ? 'border-rose-400' : 'border-brand-500/40 bg-brand-500/[0.04]')}>
                      <MousePointerClick className="mt-0.5 h-4 w-4 shrink-0 text-navy-600 dark:text-brand-300" />
                      <p className="text-[12.5px] text-slate-600 dark:text-slate-300">
                        <span className="font-medium text-slate-900 dark:text-white">Click the map</span> to drop the pin. You can drag it afterwards.
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white/60 px-3 py-2 text-[12px] dark:border-white/[0.06] dark:bg-white/[0.025]">
                      <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1 text-slate-600 dark:text-slate-300">
                        <AddressLine lat={draft.lat} lng={draft.lng!} />
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-400">drag pin to move</span>
                    </div>
                  )}
                  <Field label="Name" required error={draft.touched ? nameErr : undefined}>
                    {(id, d) => <Input id={id} aria-describedby={d} value={draft.name} maxLength={64} invalid={draft.touched && !!nameErr} placeholder="e.g. Hodan Market customer" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}
                  </Field>
                  <div className="space-y-1.5">
                    <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Category</span>
                    <div role="radiogroup" aria-label="Category" className="grid grid-cols-3 gap-1.5">
                      {PLACE_CATEGORIES.map((c) => {
                        const m = PLACE_META[c]
                        const on = draft.category === c
                        return (
                          <button
                            key={c}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => setDraft({ ...draft, category: c, color: draft.color === placeMeta(draft.category).color ? m.color : draft.color })}
                            className={cn(
                              'flex items-center gap-1.5 rounded-lg border px-2 py-2 text-[11.5px] font-medium transition-colors',
                              on ? 'border-brand-500 bg-brand-500/10 text-navy-800 dark:text-brand-100' : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-white/10 dark:text-slate-300',
                            )}
                          >
                            <m.icon className="h-3.5 w-3.5 shrink-0" style={{ color: m.color === '#ffd700' ? '#b89b00' : m.color }} />
                            <span className="truncate">{m.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <label className="block space-y-1.5">
                    <span className="flex items-baseline justify-between text-[12.5px] font-medium text-slate-700 dark:text-slate-300">
                      Radius <span className="tabular text-slate-500">{fmtDistance(draft.radius)}</span>
                    </span>
                    <input type="range" min={25} max={2000} step={25} value={draft.radius} onChange={(e) => setDraft({ ...draft, radius: Number(e.target.value) })} className="w-full accent-[#ffd700]" aria-label="Radius" />
                  </label>
                  <div className="space-y-1.5">
                    <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Colour</span>
                    <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-2">
                      {[...new Set(Object.values(PLACE_META).map((m) => m.color))].map((c) => (
                        <button
                          key={c}
                          type="button"
                          role="radio"
                          aria-checked={draft.color === c}
                          aria-label={c}
                          onClick={() => setDraft({ ...draft, color: c })}
                          className={cn('grid h-7 w-7 place-items-center rounded-full ring-offset-2 ring-offset-white transition-transform hover:scale-110 dark:ring-offset-ink-900', draft.color === c && 'ring-2 ring-slate-900 dark:ring-white')}
                          style={{ background: c }}
                        >
                          {draft.color === c && <Check className={cn('h-3.5 w-3.5', c === '#ffd700' ? 'text-navy-900' : 'text-white')} strokeWidth={3} />}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 border-t border-slate-200/80 px-4 py-3 dark:border-white/[0.06]">
                  <Button className="ml-auto" onClick={() => setDraft(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" loading={save.isPending} disabled={draft.lat == null}>
                    {draft.id == null ? 'Create place' : 'Save changes'}
                  </Button>
                </div>
              </form>
            )}
          </section>

          <MapControls className={cn('absolute right-2 top-2 md:right-3 md:top-3', picking && 'max-md:top-[68px]')}>
            <ControlGroup>
              <ControlButton label="Fit all places" onClick={() => setTick((t) => t + 1)}>
                <Maximize className="h-[16px] w-[16px]" />
              </ControlButton>
              <ControlButton label={showVehicles ? 'Hide vehicles' : 'Show vehicles'} active={showVehicles} onClick={() => setShowVehicles((v) => !v)}>
                <Users className="h-[16px] w-[16px]" />
              </ControlButton>
            </ControlGroup>
          </MapControls>
        </div>
      </MapCanvas>
      <Modal
        open={!!deleting}
        onClose={() => !del.isPending && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'place'}?`}
        description="Addresses will fall back to the street name for this location."
        footer={
          <>
            <Button onClick={() => setDeleting(null)} disabled={del.isPending} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" loading={del.isPending} icon={<Trash2 className="h-4 w-4" />} onClick={() => deleting && del.mutate(deleting)}>
              Delete place
            </Button>
          </>
        }
      />
    </div>
  )
}
