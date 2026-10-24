import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Check,
  Circle,
  Hexagon,
  Maximize,
  MousePointerClick,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SearchX,
  Spline,
  Trash2,
  TriangleAlert,
  Undo2,
  Users,
  X,
} from 'lucide-react'
import { api, ApiError, qk } from '@/api/client'
import type { Geofence, GeofenceInput } from '@/api/types'
import { MapCanvas, useMapCtx } from '@/components/map/MapCanvas'
import { MapControls, ControlGroup, ControlButton } from '@/components/map/MapControls'
import { GeofenceLayer } from '@/components/map/GeofenceLayer'
import { VehicleLayer } from '@/components/map/VehicleLayer'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState, Skeleton } from '@/components/ui/Misc'
import { ShapeEditor, isDraftComplete, type Draft } from '@/features/geofences/ShapeEditor'
import { VehiclePicker } from '@/features/geofences/VehiclePicker'
import { GEOFENCE_COLORS, geofenceRing, geofenceSize, geofencesBounds } from '@/features/geofences/shape'
import { useGeofences } from '@/features/geofences/useGeofences'
import { useAccess } from '@/lib/access'
import { useSearchParams } from 'react-router-dom'
import { Segmented } from '@/components/ui/Tabs'
import { PlacesView } from '@/features/places/PlacesView'
import { useDeviceList, useLive } from '@/store/live'
import { toast } from '@/store/toast'
import { fmtArea, ringArea } from '@/lib/geo'
import { fmtDistance, fmtShortDateTime } from '@/lib/format'
import { useIsDesktop } from '@/lib/useMedia'
import { cn } from '@/lib/cn'

interface Editor {
  id: number | null
  name: string
  color: string
  all: boolean
  deviceIds: number[]
  draft: Draft
  touched: boolean
}

const PANEL_W = 360

function pad(desktop: boolean, editing = false) {
  return desktop
    ? { top: 70, bottom: 60, left: PANEL_W + 50, right: 80 }
    : { top: 70, bottom: Math.round(window.innerHeight * (editing ? 0.66 : 0.5)), left: 30, right: 60 }
}

function draftOf(g: Geofence): Draft {
  return g.type === 'circle'
    ? { type: 'circle', center: g.center ?? null, radius: g.radius ?? 200 }
    : { type: 'polygon', points: g.polygon ?? [], closed: true }
}

function scopeLabel(g: Geofence, total: number) {
  if (!g.deviceIds?.length) return 'All vehicles'
  return `${g.deviceIds.length} of ${total} vehicle${total === 1 ? '' : 's'}`
}

/** Camera: fit everything once, then the selection. */
function Camera({
  geofences,
  focus,
  tick,
  desktop,
  editing,
}: {
  geofences: Geofence[]
  focus: Geofence | null
  tick: number
  desktop: boolean
  editing: boolean
}) {
  const { map } = useMapCtx()
  const did = useRef(false)
  useEffect(() => {
    if (!map || did.current || !geofences.length) return
    const b = geofencesBounds(geofences)
    if (!b) return
    did.current = true
    map.fitBounds(b, { padding: pad(desktop), maxZoom: 14, duration: 0 })
  }, [map, geofences, desktop])
  useEffect(() => {
    if (!map || !focus) return
    const b = geofencesBounds([focus])
    if (b) map.fitBounds(b, { padding: pad(desktop, editing), maxZoom: 16, duration: 700 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, focus?.id, editing])
  useEffect(() => {
    if (!map || tick === 0) return
    const b = geofencesBounds(geofences)
    if (b) map.fitBounds(b, { padding: pad(desktop), maxZoom: 14, duration: 700 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])
  return null
}

function ColorSwatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
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
          className={cn(
            'grid h-7 w-7 place-items-center rounded-full ring-offset-2 ring-offset-white transition-transform hover:scale-110 dark:ring-offset-ink-900',
            value === c && 'ring-2 ring-slate-900 dark:ring-white',
          )}
          style={{ background: c }}
        >
          {value === c && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
        </button>
      ))}
    </div>
  )
}

function DrawBanner({
  editor,
  onUndo,
  onFinish,
  onCancel,
}: {
  editor: Editor
  onUndo: () => void
  onFinish: () => void
  onCancel: () => void
}) {
  const d = editor.draft
  const pts = d.type === 'polygon' ? d.points.length : 0
  const text =
    d.type === 'circle'
      ? 'Click the centre, then drag out the radius'
      : pts === 0
        ? 'Click on the map to add the first point'
        : pts < 3
          ? `Add at least ${3 - pts} more point${3 - pts === 1 ? '' : 's'}`
          : 'Double-click or tap the first point to finish'
  return (
    <div
      role="status"
      className="glass pointer-events-auto absolute inset-x-2 top-2 z-20 flex animate-slide-up items-center gap-2 rounded-2xl py-1.5 pl-3 pr-1.5 md:inset-x-auto md:left-1/2 md:top-3 md:-translate-x-1/2"
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-500/12 text-navy-600 dark:text-brand-300">
        <MousePointerClick className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 text-[12.5px] font-medium text-slate-800 dark:text-slate-100 md:whitespace-nowrap">{text}</span>
      {d.type === 'polygon' && (
        <>
          <IconButton size="sm" label="Undo last point" onClick={onUndo} disabled={!pts}>
            <Undo2 className="h-4 w-4" />
          </IconButton>
          <Button size="sm" variant="primary" disabled={pts < 3} onClick={onFinish}>
            Finish
          </Button>
        </>
      )}
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}

function GeofencesView({ tabs }: { tabs: ReactNode }) {
  const isAdmin = useAccess().canManage
  const desktop = useIsDesktop()
  const qc = useQueryClient()
  const devices = useDeviceList()
  const byId = useLive((s) => s.byId)
  const geo = useGeofences()
  const geofences = useMemo(() => geo.data ?? [], [geo.data])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [newMenu, setNewMenu] = useState(false)
  const [q, setQ] = useState('')
  const [deleting, setDeleting] = useState<Geofence | null>(null)
  const [fitTick, setFitTick] = useState(0)
  const [showVehicles, setShowVehicles] = useState(true)
  const selected = geofences.find((g) => g.id === selectedId) ?? null

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    const l = s ? geofences.filter((g) => g.name.toLowerCase().includes(s)) : geofences
    return [...l].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  }, [geofences, q])

  const startNew = (type: 'circle' | 'polygon') => {
    setNewMenu(false)
    setSelectedId(null)
    setEditor({
      id: null,
      name: '',
      color: GEOFENCE_COLORS[geofences.length % GEOFENCE_COLORS.length],
      all: true,
      deviceIds: [],
      draft: type === 'circle' ? { type, center: null, radius: 0 } : { type, points: [], closed: false },
      touched: false,
    })
  }
  const startEdit = (g: Geofence) =>
    setEditor({
      id: g.id,
      name: g.name,
      color: g.color || GEOFENCE_COLORS[0],
      all: !g.deviceIds?.length,
      deviceIds: g.deviceIds ?? [],
      draft: draftOf(g),
      touched: false,
    })
  const cancel = useCallback(() => setEditor(null), [])

  useEffect(() => {
    if (!editor) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === 'Escape' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !document.querySelector('[role="dialog"]')) cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor, cancel])

  const save = useMutation({
    meta: { silent: true },
    mutationFn: (ed: Editor) => {
      const d = ed.draft
      const input: GeofenceInput = {
        name: ed.name.trim(),
        color: ed.color,
        type: d.type,
        deviceIds: ed.all ? [] : ed.deviceIds,
        ...(d.type === 'circle'
          ? { center: d.center!, radius: Math.round(d.radius) }
          : { polygon: d.points.map(([x, y]) => [+x.toFixed(7), +y.toFixed(7)] as [number, number]) }),
      }
      return ed.id == null ? api.createGeofence(input) : api.updateGeofence(ed.id, input)
    },
    onSuccess: (g, ed) => {
      qc.setQueryData<Geofence[]>(qk.geofences, (l) => (l ? [...l.filter((x) => x.id !== g.id), g] : [g]))
      void qc.invalidateQueries({ queryKey: qk.geofences })
      toast.success(ed.id == null ? 'Geofence created' : 'Geofence saved', g.name)
      setEditor(null)
      setSelectedId(g.id)
    },
    onError: (e) => toast.error('Could not save the geofence', e instanceof ApiError ? e.message : String(e)),
  })

  const del = useMutation({
    mutationFn: (g: Geofence) => api.deleteGeofence(g.id),
    onSuccess: (_, g) => {
      qc.setQueryData<Geofence[]>(qk.geofences, (l) => l?.filter((x) => x.id !== g.id))
      void qc.invalidateQueries({ queryKey: qk.geofences })
      toast.success('Geofence deleted', g.name)
      setDeleting(null)
      setSelectedId(null)
      setEditor(null)
    },
  })

  const errors = editor
    ? {
        name: !editor.name.trim() ? 'Give the geofence a name' : editor.name.trim().length > 64 ? 'Keep it under 64 characters' : undefined,
        shape: !isDraftComplete(editor.draft) ? 'Draw the shape on the map' : undefined,
        vehicles: !editor.all && editor.deviceIds.length === 0 ? 'Select at least one vehicle, or apply to all' : undefined,
      }
    : null
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!editor || !errors) return
    setEditor({ ...editor, touched: true })
    if (errors.name || errors.shape || errors.vehicles) return
    save.mutate(editor)
  }

  const drawing = !!editor && !isDraftComplete(editor.draft)
  const patchDraft = (draft: Draft) => setEditor((ed) => (ed ? { ...ed, draft } : ed))
  const mode: 'list' | 'detail' | 'edit' = editor ? 'edit' : selected ? 'detail' : 'list'

  return (
    <div className="absolute inset-0">
      <MapCanvas className="absolute inset-0">
        {showVehicles && <VehicleLayer devices={devices} hover={!editor} />}
        <GeofenceLayer
          geofences={geofences}
          selectedId={editor ? null : selectedId}
          hiddenId={editor?.id ?? null}
          onSelect={editor ? undefined : (id) => setSelectedId(id)}
        />
        {editor && <ShapeEditor draft={editor.draft} color={editor.color} onChange={patchDraft} />}
        <Camera
          geofences={geofences}
          focus={editor ? (geofences.find((g) => g.id === editor.id) ?? null) : selected}
          editing={!!editor}
          tick={fitTick}
          desktop={desktop}
        />

        <div className="pointer-events-none absolute inset-0 z-10">
          {drawing && editor && (
            <DrawBanner
              editor={editor}
              onCancel={cancel}
              onUndo={() =>
                editor.draft.type === 'polygon' && patchDraft({ ...editor.draft, points: editor.draft.points.slice(0, -1) })
              }
              onFinish={() => editor.draft.type === 'polygon' && patchDraft({ ...editor.draft, closed: true })}
            />
          )}

          <section
            aria-label="Geofences"
            className={cn(
              'glass pointer-events-auto absolute flex flex-col overflow-hidden rounded-2xl transition-[height,transform,opacity] duration-300 ease-out',
              'inset-x-2 bottom-2 md:inset-x-auto md:bottom-3 md:left-3 md:top-3 md:h-auto md:w-[360px]',
              mode === 'edit' ? 'h-[62%]' : mode === 'detail' ? 'h-[46%]' : 'h-[44%]',
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
                      <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">Geofences</h2>
                      <p className="text-[12px] text-slate-500 dark:text-slate-400">
                        {geo.isLoading ? 'Loading…' : `${geofences.length} zone${geofences.length === 1 ? '' : 's'}`}
                      </p>
                    </div>
                    {isAdmin && (
                      <div className="relative">
                        <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setNewMenu((o) => !o)} aria-expanded={newMenu}>
                          New
                        </Button>
                        {newMenu && (
                          <div role="menu" className="glass absolute right-0 top-10 z-20 w-56 animate-fade-in rounded-xl p-1.5">
                            <NewItem icon={<Circle className="h-4 w-4" />} title="Circle" text="Centre point and radius" onClick={() => startNew('circle')} />
                            <NewItem icon={<Spline className="h-4 w-4" />} title="Polygon" text="Click points to outline an area" onClick={() => startNew('polygon')} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {geofences.length > 5 && (
                    <Input
                      icon={<Search className="h-4 w-4" />}
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Filter geofences"
                      aria-label="Filter geofences"
                      className="mt-3"
                    />
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-200/80 p-1.5 dark:border-white/[0.06]">
                  {geo.isLoading ? (
                    <div className="space-y-1.5 p-1.5">
                      {Array.from({ length: 4 }, (_, i) => (
                        <Skeleton key={i} className="h-14 w-full rounded-xl" />
                      ))}
                    </div>
                  ) : geo.isError ? (
                    <EmptyState
                      icon={<TriangleAlert className="h-5 w-5" />}
                      title="Couldn’t load geofences"
                      action={
                        <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void geo.refetch()}>
                          Retry
                        </Button>
                      }
                    />
                  ) : geofences.length === 0 ? (
                    <EmptyState
                      icon={<Hexagon className="h-5 w-5" />}
                      title="No geofences yet"
                      description={
                        isAdmin
                          ? 'Draw zones like depots, customer sites or no-go areas to get enter/exit alerts.'
                          : 'An administrator can draw zones to get enter/exit alerts.'
                      }
                      action={
                        isAdmin && (
                          <div className="flex gap-2">
                            <Button size="sm" icon={<Circle className="h-3.5 w-3.5" />} onClick={() => startNew('circle')}>
                              Circle
                            </Button>
                            <Button size="sm" icon={<Spline className="h-3.5 w-3.5" />} onClick={() => startNew('polygon')}>
                              Polygon
                            </Button>
                          </div>
                        )
                      }
                    />
                  ) : rows.length === 0 ? (
                    <EmptyState icon={<SearchX className="h-5 w-5" />} title="No geofences match" />
                  ) : (
                    <ul>
                      {rows.map((g) => (
                        <li key={g.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedId(g.id)}
                            className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-slate-900/[0.04] dark:hover:bg-white/[0.05]"
                          >
                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `${g.color}1f`, color: g.color }}>
                              {g.type === 'circle' ? <Circle className="h-[18px] w-[18px]" /> : <Hexagon className="h-[18px] w-[18px]" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium text-slate-900 dark:text-white">{g.name}</span>
                              <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-slate-500 dark:text-slate-400">
                                <span className="capitalize">{g.type}</span>
                                <span className="text-slate-300 dark:text-slate-600">·</span>
                                <span className="tabular">{geofenceSize(g)}</span>
                                <span className="text-slate-300 dark:text-slate-600">·</span>
                                <span className="truncate">{scopeLabel(g, devices.length)}</span>
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
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `${selected.color}1f`, color: selected.color }}>
                    {selected.type === 'circle' ? <Circle className="h-5 w-5" /> : <Hexagon className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">{selected.name}</h2>
                    <p className="text-[12px] capitalize text-slate-500 dark:text-slate-400">{selected.type} geofence</p>
                  </div>
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
                  <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 rounded-xl border border-slate-200/80 bg-white/60 px-3 py-2.5 text-[12.5px] dark:border-white/[0.06] dark:bg-white/[0.025]">
                    {selected.type === 'circle' ? (
                      <>
                        <dt className="text-slate-500 dark:text-slate-400">Radius</dt>
                        <dd className="tabular text-right text-slate-900 dark:text-white">{fmtDistance(selected.radius ?? 0)}</dd>
                      </>
                    ) : (
                      <>
                        <dt className="text-slate-500 dark:text-slate-400">Points</dt>
                        <dd className="tabular text-right text-slate-900 dark:text-white">{selected.polygon?.length ?? 0}</dd>
                      </>
                    )}
                    <dt className="text-slate-500 dark:text-slate-400">Area</dt>
                    <dd className="tabular text-right text-slate-900 dark:text-white">
                      {fmtArea(ringArea((geofenceRing(selected) ?? []).slice(0, -1)))}
                    </dd>
                    <dt className="text-slate-500 dark:text-slate-400">Created</dt>
                    <dd className="tabular text-right text-slate-900 dark:text-white">{selected.createdAt ? fmtShortDateTime(selected.createdAt) : '—'}</dd>
                  </dl>
                  <div className="rounded-xl border border-slate-200/80 bg-white/60 px-3 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.025]">
                    <div className="flex items-center gap-2 text-[12.5px] font-medium text-slate-800 dark:text-slate-100">
                      <Users className="h-4 w-4 text-slate-400" /> Applies to {selected.deviceIds?.length ? '' : 'all vehicles'}
                    </div>
                    {!!selected.deviceIds?.length && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {selected.deviceIds.map((id) => (
                          <span key={id} className="rounded-md bg-slate-100 px-2 py-0.5 text-[11.5px] font-medium text-slate-700 dark:bg-white/[0.07] dark:text-slate-200">
                            {byId[id]?.name ?? `#${id}`}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {isAdmin && (
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
                  <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">
                    {editor.id == null ? `New ${editor.draft.type}` : `Edit ${geofences.find((g) => g.id === editor.id)?.name ?? 'geofence'}`}
                  </h2>
                  <IconButton size="sm" label="Cancel editing" onClick={cancel}>
                    <X className="h-4 w-4" />
                  </IconButton>
                </div>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto border-t border-slate-200/80 px-4 py-4 dark:border-white/[0.06]">
                  <ShapeSummary editor={editor} onDraft={patchDraft} error={editor.touched ? errors.shape : undefined} />
                  <Field label="Name" required error={editor.touched ? errors.name : undefined}>
                    {(id, d) => (
                      <Input
                        id={id}
                        aria-describedby={d}
                        value={editor.name}
                        maxLength={64}
                        invalid={editor.touched && !!errors.name}
                        placeholder="e.g. Main depot"
                        onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                      />
                    )}
                  </Field>
                  <div className="space-y-1.5">
                    <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Colour</span>
                    <ColorSwatches value={editor.color} onChange={(color) => setEditor({ ...editor, color })} />
                  </div>
                  <div className="space-y-1.5">
                    <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Vehicles</span>
                    <VehiclePicker
                      all={editor.all}
                      ids={editor.deviceIds}
                      error={editor.touched ? errors.vehicles : undefined}
                      onChange={(all, deviceIds) => setEditor({ ...editor, all, deviceIds })}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 border-t border-slate-200/80 px-4 py-3 dark:border-white/[0.06]">
                  {editor.id != null && (
                    <IconButton
                      label="Delete geofence"
                      onClick={() => setDeleting(geofences.find((g) => g.id === editor.id) ?? null)}
                      className="hover:!bg-rose-500/10 hover:!text-rose-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  )}
                  <Button className="ml-auto" onClick={cancel}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" loading={save.isPending}>
                    {editor.id == null ? 'Create geofence' : 'Save changes'}
                  </Button>
                </div>
              </form>
            )}
          </section>

          <MapControls className={cn('absolute right-2 top-2 md:right-3 md:top-3', drawing && 'max-md:top-[68px]')}>
            <ControlGroup>
              <ControlButton label="Fit all geofences" onClick={() => setFitTick((t) => t + 1)}>
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
        title={`Delete ${deleting?.name ?? 'geofence'}?`}
        description="Vehicles will no longer trigger enter/exit alerts for this zone. Past alerts are kept."
        footer={
          <>
            <Button onClick={() => setDeleting(null)} disabled={del.isPending} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" loading={del.isPending} icon={<Trash2 className="h-4 w-4" />} onClick={() => deleting && del.mutate(deleting)}>
              Delete geofence
            </Button>
          </>
        }
      />
    </div>
  )
}

function NewItem({ icon, title, text, onClick }: { icon: ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-slate-900/5 dark:hover:bg-white/[0.07]"
    >
      <span className="mt-0.5 text-navy-600 dark:text-brand-300">{icon}</span>
      <span>
        <span className="block font-medium text-slate-900 dark:text-white">{title}</span>
        <span className="block text-[11.5px] text-slate-500 dark:text-slate-400">{text}</span>
      </span>
    </button>
  )
}

function ShapeSummary({ editor, onDraft, error }: { editor: Editor; onDraft: (d: Draft) => void; error?: string }) {
  const d = editor.draft
  const complete = isDraftComplete(d)
  const [radiusText, setRadiusText] = useState<string | null>(null)
  const redraw = () => onDraft(d.type === 'circle' ? { type: 'circle', center: null, radius: 0 } : { type: 'polygon', points: [], closed: false })

  if (!complete) {
    return (
      <div className={cn('flex gap-3 rounded-xl border border-dashed px-3 py-3', error ? 'border-rose-400' : 'border-brand-500/40 bg-brand-500/[0.04]')}>
        <MousePointerClick className="mt-0.5 h-4 w-4 shrink-0 text-navy-600" />
        <div className="text-[12.5px] text-slate-600 dark:text-slate-300">
          <p className="font-medium text-slate-900 dark:text-white">Draw the shape on the map</p>
          <p className="mt-0.5">
            {d.type === 'circle'
              ? 'Press on the centre and drag outwards to set the radius. A single click uses a default radius you can adjust.'
              : 'Click to add corners. Double-click, press Enter or click the first point to close the shape.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-xl border border-slate-200/80 bg-white/60 p-3 dark:border-white/[0.06] dark:bg-white/[0.025]">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-md" style={{ background: `${editor.color}26`, color: editor.color }}>
          {d.type === 'circle' ? <Circle className="h-3.5 w-3.5" /> : <Hexagon className="h-3.5 w-3.5" />}
        </span>
        <span className="flex-1 text-[12.5px] font-medium text-slate-800 dark:text-slate-100">
          {d.type === 'circle' ? 'Circle' : `Polygon · ${d.points.length} points`}
          <span className="ml-1.5 font-normal text-slate-400">
            {d.type === 'circle' ? fmtArea(Math.PI * d.radius * d.radius) : fmtArea(ringArea(d.points))}
          </span>
        </span>
        <Button size="sm" variant="ghost" onClick={redraw} className="-mr-1.5">
          Redraw
        </Button>
      </div>
      {d.type === 'circle' && (
        <label className="flex items-center gap-3">
          <span className="w-14 text-[12.5px] text-slate-500 dark:text-slate-400">Radius</span>
          <Input
            type="number"
            inputMode="numeric"
            min={20}
            max={100000}
            step={10}
            aria-label="Radius in metres"
            value={radiusText ?? String(Math.round(d.radius))}
            onChange={(e) => {
              setRadiusText(e.target.value)
              const n = Number(e.target.value)
              if (Number.isFinite(n) && n >= 20 && n <= 100000) onDraft({ ...d, radius: n })
            }}
            onBlur={() => setRadiusText(null)}
            trailing={<span className="pr-1.5 text-[11px] text-slate-400">m</span>}
            className="flex-1"
          />
        </label>
      )}
      <p className="text-[11.5px] text-slate-500 dark:text-slate-400">
        {d.type === 'circle'
          ? 'Drag the centre to move it, or the white handle to resize.'
          : 'Drag corners to reshape, drag a small midpoint to add a corner, double-click a corner to remove it.'}
      </p>
    </div>
  )
}


type GeoTab = 'geofences' | 'places' | 'routes'
const RoutesView = lazy(() => import('@/features/routes/RoutesView'))

export default function GeofencesPage() {
  const [params, setParams] = useSearchParams()
  const t = params.get('tab')
  const tab: GeoTab = t === 'places' || t === 'routes' ? t : 'geofences'
  const tabs = (
    <Segmented<GeoTab>
      label="Geofences or places"
      value={tab}
      onChange={(t) => setParams(t !== 'geofences' ? { tab: t } : {}, { replace: true })}
      options={[
        { id: 'geofences', label: 'Geofences' },
        { id: 'places', label: 'Places' },
        { id: 'routes', label: 'Routes' },
      ]}
    />
  )
  if (tab === 'routes')
    return (
      <Suspense fallback={null}>
        <RoutesView tabs={tabs} />
      </Suspense>
    )
  return tab === 'places' ? <PlacesView tabs={tabs} /> : <GeofencesView tabs={tabs} />
}
