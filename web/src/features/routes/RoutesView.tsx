import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, History, Maximize, MousePointerClick, Pencil, Plus, RefreshCw, Route as RouteIcon, Search, Spline, Trash2, TriangleAlert, Undo2, Users, X } from 'lucide-react'
import { api, ApiError, qk } from '@/api/client'
import type { FleetRoute, RouteInput } from '@/api/types'
import { MapCanvas, useMapCtx } from '@/components/map/MapCanvas'
import { ControlButton, ControlGroup, MapControls } from '@/components/map/MapControls'
import { RoutesLayer, routesBounds } from '@/components/map/RoutesLayer'
import { VehicleLayer } from '@/components/map/VehicleLayer'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState, Skeleton } from '@/components/ui/Misc'
import { DeviceChecklist } from '@/features/common/DeviceMultiSelect'
import { useRoutes } from '@/features/dispatch/queries'
import { GEOFENCE_COLORS } from '@/features/geofences/shape'
import { useAccess } from '@/lib/access'
import { fmtDistance, fmtShortDateTime } from '@/lib/format'
import { useIsDesktop } from '@/lib/useMedia'
import { useDeviceList, useLive } from '@/store/live'
import { toast } from '@/store/toast'
import { cn } from '@/lib/cn'
import { FromTripDialog } from './FromTrip'
import { PolylineEditor, pathLength, type LineDraft } from './PolylineEditor'

interface Editor {
  id: number | null
  name: string
  color: string
  corridor: number
  minDeviationSeconds: number
  deviceIds: number[]
  draft: LineDraft
  touched: boolean
}

const pad = (desktop: boolean, editing = false) =>
  desktop ? { top: 70, bottom: 60, left: 410, right: 80 } : { top: 70, bottom: Math.round(window.innerHeight * (editing ? 0.66 : 0.5)), left: 30, right: 60 }

function Camera({ routes, focus, tick, desktop, editing }: { routes: FleetRoute[]; focus: { path: Array<[number, number]> } | null; tick: number; desktop: boolean; editing: boolean }) {
  const { map } = useMapCtx()
  const did = useRef(false)
  useEffect(() => {
    if (!map || did.current || !routes.length) return
    const b = routesBounds(routes.filter((r) => r.path[0][1] < 5)) ?? routesBounds(routes)
    if (!b) return
    did.current = true
    map.fitBounds(b, { padding: pad(desktop), maxZoom: 14, duration: 0 })
  }, [map, routes, desktop])
  const fk = focus ? `${focus.path.length}:${focus.path[0]}` : null
  useEffect(() => {
    if (!map || !focus || focus.path.length < 2) return
    const b = routesBounds([focus])
    if (b) map.fitBounds(b, { padding: pad(desktop, editing), maxZoom: 16, duration: 700 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fk, editing])
  useEffect(() => {
    if (!map || tick === 0) return
    const b = routesBounds(routes)
    if (b) map.fitBounds(b, { padding: pad(desktop), maxZoom: 14, duration: 700 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])
  return null
}

function Swatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-2">
      {GEOFENCE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn('grid h-7 w-7 place-items-center rounded-full ring-offset-2 ring-offset-white transition-transform hover:scale-110 dark:ring-offset-ink-900', value === c && 'ring-2 ring-slate-900 dark:ring-white')}
          style={{ background: c }}
        >
          {value === c && <Check className={cn('h-3.5 w-3.5', c === '#ffd700' ? 'text-navy-900' : 'text-white')} strokeWidth={3} />}
        </button>
      ))}
    </div>
  )
}

export function RoutesView({ tabs }: { tabs: ReactNode }) {
  const { canManage } = useAccess()
  const desktop = useIsDesktop()
  const qc = useQueryClient()
  const devices = useDeviceList()
  const byId = useLive((s) => s.byId)
  const q = useRoutes()
  const routes = useMemo(() => q.data ?? [], [q.data])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [menu, setMenu] = useState(false)
  const [fromTrip, setFromTrip] = useState(false)
  const [filter, setFilter] = useState('')
  const [deleting, setDeleting] = useState<FleetRoute | null>(null)
  const [tick, setTick] = useState(0)
  const [showVehicles, setShowVehicles] = useState(true)
  const selected = routes.find((r) => r.id === selectedId) ?? null
  const rows = useMemo(() => {
    const s = filter.trim().toLowerCase()
    return routes.filter((r) => !s || r.name.toLowerCase().includes(s)).sort((a, b) => a.name.localeCompare(b.name))
  }, [routes, filter])

  const startNew = () => {
    setMenu(false)
    setSelectedId(null)
    setEditor({ id: null, name: '', color: GEOFENCE_COLORS[routes.length % GEOFENCE_COLORS.length], corridor: 150, minDeviationSeconds: 60, deviceIds: [], draft: { points: [], finished: false }, touched: false })
  }
  const startEdit = (r: FleetRoute) =>
    setEditor({ id: r.id, name: r.name, color: r.color || GEOFENCE_COLORS[0], corridor: r.corridor, minDeviationSeconds: r.minDeviationSeconds, deviceIds: r.deviceIds ?? [], draft: { points: r.path, finished: true }, touched: false })
  const cancel = useCallback(() => setEditor(null), [])

  const save = useMutation({
    meta: { silent: true },
    mutationFn: (ed: Editor) => {
      const input: RouteInput = {
        name: ed.name.trim(),
        color: ed.color,
        path: ed.draft.points.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)] as [number, number]),
        corridor: Math.round(ed.corridor),
        minDeviationSeconds: Math.round(ed.minDeviationSeconds),
        deviceIds: ed.deviceIds,
      }
      return ed.id == null ? api.createRoute(input) : api.updateRoute(ed.id, input)
    },
    onSuccess: (r, ed) => {
      qc.setQueryData<FleetRoute[]>(qk.routes, (l) => (l ? [...l.filter((x) => x.id !== r.id), r] : [r]))
      void qc.invalidateQueries({ queryKey: qk.routes })
      toast.success(ed.id == null ? 'Route created' : 'Route saved', r.name)
      setEditor(null)
      setSelectedId(r.id)
    },
    onError: (e) => toast.error('Could not save the route', e instanceof ApiError ? e.message : String(e)),
  })
  const del = useMutation({
    mutationFn: (r: FleetRoute) => api.deleteRoute(r.id),
    onSuccess: (_, r) => {
      qc.setQueryData<FleetRoute[]>(qk.routes, (l) => l?.filter((x) => x.id !== r.id))
      toast.success('Route deleted', r.name)
      setDeleting(null)
      setSelectedId(null)
      setEditor(null)
    },
  })

  const errors = editor
    ? {
        name: !editor.name.trim() ? 'Give the route a name' : undefined,
        path: !editor.draft.finished || editor.draft.points.length < 2 ? 'Draw the route on the map (at least 2 points)' : undefined,
        corridor: editor.corridor < 10 || editor.corridor > 5000 ? '10 – 5000 m' : undefined,
        dev: editor.minDeviationSeconds < 0 || editor.minDeviationSeconds > 3600 ? '0 – 3600 s' : undefined,
      }
    : null
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!editor || !errors) return
    setEditor({ ...editor, touched: true })
    if (Object.values(errors).some(Boolean)) return
    save.mutate(editor)
  }
  const drawing = !!editor && !editor.draft.finished
  const mode: 'list' | 'detail' | 'edit' = editor ? 'edit' : selected ? 'detail' : 'list'
  const editShape = editor && editor.draft.points.length >= 2 ? [{ id: -2, name: editor.name || 'New route', color: editor.color, path: editor.draft.points, corridor: editor.corridor }] : []

  return (
    <div className="absolute inset-0">
      <MapCanvas className="absolute inset-0">
        {showVehicles && <VehicleLayer devices={devices} hover={!editor} />}
        <RoutesLayer routes={routes} selectedId={editor ? null : selectedId} hiddenId={editor?.id ?? null} onSelect={editor ? undefined : setSelectedId} />
        {editor && <RoutesLayer routes={editShape} prefix="route-edit" labels={false} />}
        {editor && <PolylineEditor draft={editor.draft} color={editor.color} onChange={(draft) => setEditor((ed) => (ed ? { ...ed, draft } : ed))} />}
        <Camera routes={routes} focus={editor ? (editor.id != null ? { path: editor.draft.points } : null) : selected} tick={tick} desktop={desktop} editing={!!editor} />

        <div className="pointer-events-none absolute inset-0 z-10">
          {drawing && editor && (
            <div role="status" className="glass pointer-events-auto absolute inset-x-2 top-2 z-20 flex animate-slide-up items-center gap-2 rounded-2xl py-1.5 pl-3 pr-1.5 md:inset-x-auto md:left-1/2 md:top-3 md:-translate-x-1/2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-500/12 text-navy-600 dark:text-brand-300">
                <MousePointerClick className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 text-[12.5px] font-medium text-slate-800 dark:text-slate-100 md:whitespace-nowrap">
                {editor.draft.points.length === 0 ? 'Click on the map where the route starts' : editor.draft.points.length < 2 ? 'Click the next point along the road' : 'Keep clicking along the road · double-click or Finish'}
              </span>
              <IconButton size="sm" label="Undo last point" disabled={!editor.draft.points.length} onClick={() => setEditor({ ...editor, draft: { ...editor.draft, points: editor.draft.points.slice(0, -1) } })}>
                <Undo2 className="h-4 w-4" />
              </IconButton>
              <Button size="sm" variant="primary" disabled={editor.draft.points.length < 2} onClick={() => setEditor({ ...editor, draft: { ...editor.draft, finished: true } })}>
                Finish
              </Button>
              <Button size="sm" variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            </div>
          )}

          <section
            aria-label="Routes"
            className={cn(
              'glass pointer-events-auto absolute flex flex-col overflow-hidden rounded-2xl transition-[height,transform,opacity] duration-300 ease-out',
              'inset-x-2 bottom-2 md:inset-x-auto md:bottom-3 md:left-3 md:top-3 md:h-auto md:w-[380px]',
              mode === 'edit' ? 'h-[62%]' : mode === 'detail' ? 'h-[50%]' : 'h-[44%]',
              drawing && 'max-md:pointer-events-none max-md:translate-y-8 max-md:opacity-0',
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
                      <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">Routes</h2>
                      <p className="text-[12px] text-slate-500 dark:text-slate-400">{q.isLoading ? 'Loading…' : `${routes.length} planned route${routes.length === 1 ? '' : 's'} · deviation alerts`}</p>
                    </div>
                    {canManage && (
                      <div className="relative">
                        <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setMenu((o) => !o)} aria-expanded={menu}>
                          New
                        </Button>
                        {menu && (
                          <div role="menu" className="glass absolute right-0 top-10 z-20 w-60 animate-fade-in rounded-xl p-1.5">
                            <MenuRow icon={<Spline className="h-4 w-4" />} title="Draw on the map" text="Click points along the road" onClick={startNew} />
                            <MenuRow
                              icon={<History className="h-4 w-4" />}
                              title="From a recorded trip"
                              text="Pick a vehicle and a trip"
                              onClick={() => {
                                setMenu(false)
                                setFromTrip(true)
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {routes.length > 5 && <Input icon={<Search className="h-4 w-4" />} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter routes" aria-label="Filter routes" className="mt-3" />}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-200/80 p-1.5 dark:border-white/[0.06]">
                  {q.isLoading ? (
                    <div className="space-y-1.5 p-1.5">
                      {Array.from({ length: 4 }, (_, i) => (
                        <Skeleton key={i} className="h-14 w-full rounded-xl" />
                      ))}
                    </div>
                  ) : q.isError ? (
                    <EmptyState icon={<TriangleAlert className="h-5 w-5" />} title="Couldn’t load routes" action={<Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void q.refetch()}>Retry</Button>} />
                  ) : routes.length === 0 ? (
                    <EmptyState
                      icon={<RouteIcon className="h-5 w-5" />}
                      title="No routes yet"
                      description={canManage ? 'Draw the road a vehicle should follow, or build it from a past trip. Leaving the corridor raises a deviation alert.' : 'A manager can plan routes to get deviation alerts.'}
                      action={
                        canManage && (
                          <div className="flex gap-2">
                            <Button size="sm" icon={<Spline className="h-3.5 w-3.5" />} onClick={startNew}>
                              Draw
                            </Button>
                            <Button size="sm" icon={<History className="h-3.5 w-3.5" />} onClick={() => setFromTrip(true)}>
                              From trip
                            </Button>
                          </div>
                        )
                      }
                    />
                  ) : (
                    <ul>
                      {rows.map((r) => (
                        <li key={r.id}>
                          <button type="button" onClick={() => setSelectedId(r.id)} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-slate-900/[0.04] dark:hover:bg-white/[0.05]">
                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `${r.color}1f`, color: r.color === '#ffd700' ? undefined : r.color }}>
                              <RouteIcon className={cn('h-[18px] w-[18px]', r.color === '#ffd700' && 'text-navy-700 dark:text-brand-300')} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium text-slate-900 dark:text-white">{r.name}</span>
                              <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-slate-500 dark:text-slate-400">
                                <span className="tabular">{fmtDistance(pathLength(r.path))}</span>
                                <span className="text-slate-300 dark:text-slate-600">·</span>
                                <span className="tabular">±{r.corridor} m</span>
                                <span className="text-slate-300 dark:text-slate-600">·</span>
                                <span className="truncate">{r.deviceIds.length ? `${r.deviceIds.length} vehicle${r.deviceIds.length === 1 ? '' : 's'}` : 'Jobs only'}</span>
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
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
                  <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: selected.color }} />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">{selected.name}</h2>
                    <p className="text-[12px] text-slate-500 dark:text-slate-400">Planned route · {fmtDistance(pathLength(selected.path))}</p>
                  </div>
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
                  <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 rounded-xl border border-slate-200/80 bg-white/60 px-3 py-2.5 text-[12.5px] dark:border-white/[0.06] dark:bg-white/[0.025]">
                    <dt className="text-slate-500 dark:text-slate-400">Corridor</dt>
                    <dd className="tabular text-right text-slate-900 dark:text-white">±{selected.corridor} m each side</dd>
                    <dt className="text-slate-500 dark:text-slate-400">Alert after</dt>
                    <dd className="tabular text-right text-slate-900 dark:text-white">{selected.minDeviationSeconds} s outside</dd>
                    <dt className="text-slate-500 dark:text-slate-400">Points</dt>
                    <dd className="tabular text-right text-slate-900 dark:text-white">{selected.path.length}</dd>
                    <dt className="text-slate-500 dark:text-slate-400">Created</dt>
                    <dd className="tabular text-right text-slate-900 dark:text-white">{fmtShortDateTime(selected.createdAt)}</dd>
                  </dl>
                  <div className="rounded-xl border border-slate-200/80 bg-white/60 px-3 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.025]">
                    <div className="flex items-center gap-2 text-[12.5px] font-medium text-slate-800 dark:text-slate-100">
                      <Users className="h-4 w-4 text-slate-400" /> Monitored vehicles
                    </div>
                    {selected.deviceIds.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {selected.deviceIds.map((id) => (
                          <span key={id} className="rounded-md bg-slate-100 px-2 py-0.5 text-[11.5px] font-medium text-slate-700 dark:bg-white/[0.07] dark:text-slate-200">
                            {byId[id]?.name ?? `#${id}`}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <p className="mt-1.5 text-[11.5px] text-slate-500 dark:text-slate-400">Vehicles with an active job on this route are monitored automatically.</p>
                  </div>
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

            {mode === 'edit' && editor && errors && (
              <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
                <div className="flex items-center gap-2 px-4 pb-3 pt-2 md:pt-4">
                  <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">{editor.id == null ? 'New route' : `Edit ${routes.find((r) => r.id === editor.id)?.name ?? 'route'}`}</h2>
                  <IconButton size="sm" label="Cancel editing" onClick={cancel}>
                    <X className="h-4 w-4" />
                  </IconButton>
                </div>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto border-t border-slate-200/80 px-4 py-4 dark:border-white/[0.06]">
                  <div className={cn('rounded-xl border p-3 text-[12.5px]', editor.touched && errors.path ? 'border-rose-400' : 'border-slate-200/80 bg-white/60 dark:border-white/[0.06] dark:bg-white/[0.025]')}>
                    <div className="flex items-center gap-2">
                      <Spline className="h-4 w-4 text-slate-400" />
                      <span className="flex-1 font-medium text-slate-800 dark:text-slate-100">
                        {editor.draft.points.length} points · <span className="tabular">{fmtDistance(pathLength(editor.draft.points))}</span>
                      </span>
                      {editor.draft.finished && (
                        <Button size="sm" variant="ghost" className="-mr-1.5" onClick={() => setEditor({ ...editor, draft: { points: [], finished: false } })}>
                          Redraw
                        </Button>
                      )}
                    </div>
                    <p className="mt-1 text-[11.5px] text-slate-500 dark:text-slate-400">
                      {editor.draft.finished ? 'Drag points to follow the road, drag a small midpoint to add one, double-click a point to remove it.' : 'Click along the road on the map. Double-click or press Finish when done.'}
                    </p>
                    {editor.touched && errors.path && <p className="mt-1 text-[12px] text-rose-500">{errors.path}</p>}
                  </div>
                  <Field label="Name" required error={editor.touched ? errors.name : undefined}>
                    {(id, d) => <Input id={id} aria-describedby={d} value={editor.name} invalid={editor.touched && !!errors.name} placeholder="Mogadishu → Afgooye" onChange={(e) => setEditor({ ...editor, name: e.target.value })} />}
                  </Field>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label htmlFor="corridor" className="text-[12.5px] font-medium text-slate-700 dark:text-slate-300">
                        Corridor width
                      </label>
                      <span className="tabular text-[12.5px] font-semibold text-slate-900 dark:text-white">±{editor.corridor} m</span>
                    </div>
                    <input id="corridor" type="range" className="slider" min={20} max={1000} step={10} value={Math.min(1000, editor.corridor)} onChange={(e) => setEditor({ ...editor, corridor: Number(e.target.value) })} />
                    <p className="text-[11.5px] text-slate-500 dark:text-slate-400">The shaded band on the map. Leaving it raises a deviation alert.</p>
                  </div>
                  <Field label="Alert after" error={editor.touched ? errors.dev : undefined} hint="Seconds outside the corridor before alerting (ignores GPS jitter)">
                    {(id, d) => (
                      <Input id={id} aria-describedby={d} inputMode="numeric" value={String(editor.minDeviationSeconds)} onChange={(e) => setEditor({ ...editor, minDeviationSeconds: Number(e.target.value.replace(/\D/g, '').slice(0, 4)) || 0 })} trailing={<span className="pr-1.5 text-[11px] text-slate-400">sec</span>} />
                    )}
                  </Field>
                  <div className="space-y-1.5">
                    <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Colour</span>
                    <Swatches value={editor.color} onChange={(color) => setEditor({ ...editor, color })} />
                  </div>
                  <div className="space-y-1.5">
                    <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Always monitor these vehicles</span>
                    <DeviceChecklist value={editor.deviceIds} onChange={(deviceIds) => setEditor({ ...editor, deviceIds })} maxHeight="max-h-48" />
                    <p className="text-[11.5px] text-slate-500 dark:text-slate-400">Leave empty to monitor only vehicles whose active job uses this route.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 border-t border-slate-200/80 px-4 py-3 dark:border-white/[0.06]">
                  {editor.id != null && (
                    <IconButton label="Delete route" onClick={() => setDeleting(routes.find((r) => r.id === editor.id) ?? null)} className="hover:!bg-rose-500/10 hover:!text-rose-500">
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  )}
                  <Button className="ml-auto" onClick={cancel}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" loading={save.isPending}>
                    {editor.id == null ? 'Create route' : 'Save changes'}
                  </Button>
                </div>
              </form>
            )}
          </section>

          <MapControls className={cn('absolute right-2 top-2 md:right-3 md:top-3', drawing && 'max-md:top-[68px]')}>
            <ControlGroup>
              <ControlButton label="Fit all routes" onClick={() => setTick((t) => t + 1)}>
                <Maximize className="h-[16px] w-[16px]" />
              </ControlButton>
              <ControlButton label={showVehicles ? 'Hide vehicles' : 'Show vehicles'} active={showVehicles} onClick={() => setShowVehicles((v) => !v)}>
                <Users className="h-[16px] w-[16px]" />
              </ControlButton>
            </ControlGroup>
          </MapControls>
        </div>
      </MapCanvas>

      {fromTrip && (
        <FromTripDialog
          onClose={() => setFromTrip(false)}
          onCreated={(r) => {
            qc.setQueryData<FleetRoute[]>(qk.routes, (l) => (l ? [...l.filter((x) => x.id !== r.id), r] : [r]))
            setFromTrip(false)
            startEdit(r)
          }}
        />
      )}
      <Modal
        open={!!deleting}
        onClose={() => !del.isPending && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'route'}?`}
        description="Vehicles stop being monitored for deviation. Jobs that used it keep their history."
        footer={
          <>
            <Button onClick={() => setDeleting(null)} disabled={del.isPending} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" loading={del.isPending} icon={<Trash2 className="h-4 w-4" />} onClick={() => deleting && del.mutate(deleting)}>
              Delete route
            </Button>
          </>
        }
      />
    </div>
  )
}

function MenuRow({ icon, title, text, onClick }: { icon: ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-slate-900/5 dark:hover:bg-white/[0.07]">
      <span className="mt-0.5 text-navy-600 dark:text-brand-300">{icon}</span>
      <span>
        <span className="block font-medium text-slate-900 dark:text-white">{title}</span>
        <span className="block text-[11.5px] text-slate-500 dark:text-slate-400">{text}</span>
      </span>
    </button>
  )
}

export default RoutesView
