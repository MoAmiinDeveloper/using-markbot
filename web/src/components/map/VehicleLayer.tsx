import { useEffect, useRef } from 'react'
import maplibregl, {
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type Map as MlMap,
  type SymbolLayerSpecification,
} from 'maplibre-gl'
import type { Device, DeviceStatus } from '@/api/types'
import { STATUS_META, STATUSES } from '@/lib/status'
import { bearing, lerpAngle } from '@/lib/geo'
import { useMapCtx } from './MapCanvas'
import { vehicleIconName } from './icons'

const SRC = 'vehicles'
const SRC_SEL = 'vehicles-selected'
const LAYER = 'vehicles-icons'
const LAYER_SEL = 'vehicles-selected-icon'
const ANIM_MS = 1100
/** longest time spent driving a marker through one batch of fixes */
const MAX_PATH_MS = 8000
const SEG_MS = 700
const FRAME_MS = 33

interface Anim {
  /** waypoints [lng, lat], at least two (equal when static) */
  path: Array<[number, number]>
  /** cumulative distance (approx. metres) at each waypoint */
  cum: number[]
  fromRot: number
  toRot: number
  t0: number
  dur: number
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
const easeLinearish = (t: number) => (t < 0.15 ? ease(t / 0.3) * 0.3 : t > 0.85 ? 1 - ease((1 - t) / 0.3) * 0.3 : t)

function makeAnim(path: Array<[number, number]>, fromRot: number, toRot: number, t0: number): Anim {
  const cum = [0]
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1]
    const [x1, y1] = path[i]
    const kx = Math.cos(((y0 + y1) / 2) * (Math.PI / 180))
    cum.push(cum[i - 1] + Math.hypot((x1 - x0) * kx, y1 - y0) * 111_320)
  }
  const segs = path.length - 1
  const dur = segs <= 1 ? ANIM_MS : Math.min(MAX_PATH_MS, Math.max(ANIM_MS, segs * SEG_MS))
  return { path, cum, fromRot, toRot, t0, dur }
}

function staticAnim(lng: number, lat: number, rot: number): Anim {
  return { path: [[lng, lat], [lng, lat]], cum: [0, 0], fromRot: rot, toRot: rot, t0: 0, dur: ANIM_MS }
}

function interp(a: Anim, now: number): [number, number, number] {
  const k = Math.min(1, (now - a.t0) / a.dur)
  const last = a.path[a.path.length - 1]
  if (k >= 1) return [last[0], last[1], a.toRot]
  const total = a.cum[a.cum.length - 1]
  if (a.path.length === 2 || total === 0) {
    const e = ease(k)
    const [f, t] = [a.path[0], last]
    return [f[0] + (t[0] - f[0]) * e, f[1] + (t[1] - f[1]) * e, lerpAngle(a.fromRot, a.toRot, e)]
  }
  // multi-point path: constant-ish speed along the polyline, heading follows the road
  const d = easeLinearish(k) * total
  let i = 1
  while (i < a.cum.length - 1 && a.cum[i] < d) i++
  const span = a.cum[i] - a.cum[i - 1] || 1
  const f = (d - a.cum[i - 1]) / span
  const [x0, y0] = a.path[i - 1]
  const [x1, y1] = a.path[i]
  const rot = x0 === x1 && y0 === y1 ? a.toRot : bearing(y0, x0, y1, x1)
  return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, rot]
}

type FC = GeoJSON.FeatureCollection<GeoJSON.Point>

function emptyFC(): FC {
  return { type: 'FeatureCollection', features: [] }
}

function addLayers(map: MlMap, cluster: boolean) {
  if (!map.getSource(SRC)) {
    const clusterProperties: Record<string, unknown> = {}
    for (const s of STATUSES) clusterProperties[s] = ['+', ['case', ['==', ['get', 'status'], s], 1, 0]]
    map.addSource(SRC, {
      type: 'geojson',
      data: emptyFC(),
      cluster,
      clusterMaxZoom: 11,
      clusterRadius: 48,
      clusterProperties,
    })
  }
  if (!map.getSource(SRC_SEL)) map.addSource(SRC_SEL, { type: 'geojson', data: emptyFC() })
  const layout: SymbolLayerSpecification['layout'] = {
    'icon-image': ['get', 'icon'],
    'icon-rotate': ['get', 'rot'],
    'icon-rotation-alignment': 'map',
    'icon-allow-overlap': true,
    'icon-ignore-placement': true,
  }
  if (!map.getLayer(LAYER))
    map.addLayer({
      id: LAYER,
      type: 'symbol',
      source: SRC,
      filter: ['!', ['has', 'point_count']],
      layout: { ...layout, 'symbol-sort-key': ['get', 'rank'] },
    })
  if (!map.getLayer(LAYER_SEL)) map.addLayer({ id: LAYER_SEL, type: 'symbol', source: SRC_SEL, layout })
}

function clusterElement(props: Record<string, number>, count: number): HTMLElement {
  const el = document.createElement('div')
  const size = count < 10 ? 34 : count < 50 ? 40 : count < 200 ? 48 : 56
  // conic ring showing status mix
  let acc = 0
  const stops: string[] = []
  for (const s of STATUSES) {
    const n = Number(props[s] ?? 0)
    if (!n) continue
    const a0 = (acc / count) * 360
    acc += n
    const a1 = (acc / count) * 360
    stops.push(`${STATUS_META[s].color} ${a0}deg ${a1}deg`)
  }
  el.className = 'fleet-cluster'
  el.style.width = el.style.height = `${size}px`
  el.style.background = `conic-gradient(${stops.join(',') || '#64748b 0 360deg'})`
  el.style.setProperty('--tw-ring-color', 'rgb(15 23 42 / 0.18)')
  const inner = document.createElement('div')
  inner.style.cssText = `width:${size - 10}px;height:${size - 10}px;border-radius:999px;display:grid;place-items:center;background:#141b37;font-size:${count < 100 ? 12.5 : 11.5}px`
  inner.textContent = String(count)
  el.appendChild(inner)
  el.setAttribute('role', 'button')
  el.setAttribute('aria-label', `${count} vehicles, click to zoom in`)
  return el
}

function popupContent(d: Device): HTMLElement {
  const root = document.createElement('div')
  root.style.minWidth = '140px'
  const name = document.createElement('div')
  name.style.cssText = 'font-weight:600;font-size:13px'
  name.textContent = d.name
  const meta = document.createElement('div')
  meta.style.cssText = 'margin-top:2px;font-size:12px;opacity:.75;display:flex;gap:6px;align-items:center'
  const dot = document.createElement('span')
  dot.style.cssText = `width:7px;height:7px;border-radius:9px;background:${STATUS_META[d.status]?.color ?? '#64748b'}`
  const txt = document.createElement('span')
  txt.textContent = `${STATUS_META[d.status]?.label ?? d.status} · ${Math.round(d.position?.speed ?? 0)} km/h${d.plate ? ` · ${d.plate}` : ''}`
  meta.append(dot, txt)
  root.append(name, meta)
  return root
}

export interface VehicleLayerProps {
  devices: Device[]
  selectedId?: number | null
  followId?: number | null
  onSelect?: (id: number) => void
  /** called when the user drags the map while following */
  onFollowCancel?: () => void
  cluster?: boolean
  hover?: boolean
}

/**
 * Renders vehicles as a clustered GeoJSON symbol layer (fast for thousands of units) and
 * animates position/heading changes between live updates.
 */
export function VehicleLayer({
  devices,
  selectedId,
  followId,
  onSelect,
  onFollowCancel,
  cluster = true,
  hover = true,
}: VehicleLayerProps) {
  const { map, styleVersion } = useMapCtx()
  const anims = useRef(new Map<number, Anim>())
  const devRef = useRef<Device[]>(devices)
  const selRef = useRef<number | null | undefined>(selectedId)
  const followRef = useRef<number | null | undefined>(followId)
  const onSelectRef = useRef(onSelect)
  const raf = useRef<number | null>(null)
  const lastPush = useRef(0)
  const markers = useRef(new Map<number, maplibregl.Marker>())

  devRef.current = devices
  selRef.current = selectedId
  followRef.current = followId
  onSelectRef.current = onSelect

  // push current interpolated state to the sources; returns true while animating
  const pushRef = useRef<(force?: boolean) => boolean>(() => false)
  pushRef.current = (force = false) => {
    if (!map) return false
    const src = map.getSource(SRC) as GeoJSONSource | undefined
    const srcSel = map.getSource(SRC_SEL) as GeoJSONSource | undefined
    if (!src || !srcSel) return false
    const now = performance.now()
    let animating = false
    if (!force && now - lastPush.current < FRAME_MS) return true
    lastPush.current = now
    const feats: FC['features'] = []
    const sel: FC['features'] = []
    let followPos: [number, number] | null = null
    for (const d of devRef.current) {
      const a = anims.current.get(d.id)
      if (!a) continue
      const [lng, lat, rot] = interp(a, now)
      if (now - a.t0 < a.dur) animating = true
      const status = (d.status in STATUS_META ? d.status : 'offline') as DeviceStatus
      const isSel = d.id === selRef.current
      const rotates = status === 'moving' || status === 'idle'
      const f: FC['features'][number] = {
        type: 'Feature',
        id: d.id,
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: {
          id: d.id,
          status,
          icon: vehicleIconName(status, isSel),
          rot: rotates ? rot : 0,
          rank: status === 'moving' ? 3 : status === 'idle' ? 2 : 1,
        },
      }
      if (isSel) sel.push(f)
      else feats.push(f)
      if (d.id === followRef.current) followPos = [lng, lat]
    }
    src.setData({ type: 'FeatureCollection', features: feats })
    srcSel.setData({ type: 'FeatureCollection', features: sel })
    if (followPos) map.jumpTo({ center: followPos })
    return animating
  }

  const kick = () => {
    if (raf.current != null) return
    const loop = () => {
      const still = pushRef.current()
      raf.current = still ? requestAnimationFrame(loop) : null
      if (!still) pushRef.current(true)
    }
    raf.current = requestAnimationFrame(loop)
  }

  // (re)install sources/layers after every style load
  useEffect(() => {
    if (!map || styleVersion === 0) return
    try {
      addLayers(map, cluster)
    } catch {
      return // style not ready yet; the next style.load will retry
    }
    pushRef.current(true)
  }, [map, styleVersion, cluster])

  // retarget animations when positions change
  useEffect(() => {
    const now = performance.now()
    const seen = new Set<number>()
    for (const d of devices) {
      const p = d.position
      if (!p) continue
      seen.add(d.id)
      const a = anims.current.get(d.id)
      if (!a) {
        anims.current.set(d.id, staticAnim(p.lng, p.lat, p.course))
      } else {
        const last = a.path[a.path.length - 1]
        if (last[0] === p.lng && last[1] === p.lat && a.toRot === p.course) continue
        const [lng, lat, rot] = interp(a, now)
        // big jumps (e.g. after reconnect) snap instead of sliding across the map
        const far = Math.abs(lng - p.lng) > 0.05 || Math.abs(lat - p.lat) > 0.05
        if (far) {
          anims.current.set(d.id, staticAnim(p.lng, p.lat, p.course))
          continue
        }
        // drive through the batch's earlier fixes that come after the marker's current target
        const path: Array<[number, number]> = [[lng, lat]]
        const trail = d.trail ?? []
        let started = trail.length === 0
        for (const pt of trail) {
          if (!started) {
            started = pt[0] === last[0] && pt[1] === last[1]
            continue
          }
          path.push(pt)
        }
        if (!started) path.push(...trail.slice(1)) // marker target not in trail: use all but the stale start
        path.push([p.lng, p.lat])
        anims.current.set(d.id, makeAnim(path, rot, p.course, now))
      }
    }
    for (const id of [...anims.current.keys()]) if (!seen.has(id)) anims.current.delete(id)
    pushRef.current(true)
    kick()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, selectedId, map, styleVersion])

  // follow: centre immediately when enabled, stop when the user drags
  const cancelRef = useRef(onFollowCancel)
  cancelRef.current = onFollowCancel
  useEffect(() => {
    if (!map || followId == null) return
    const a = anims.current.get(followId)
    if (a) map.easeTo({ center: a.path[a.path.length - 1], zoom: Math.max(map.getZoom(), 15), duration: 600 })
    const onDrag = () => cancelRef.current?.()
    map.on('dragstart', onDrag)
    return () => {
      map.off('dragstart', onDrag)
    }
  }, [map, followId])

  // interactions
  useEffect(() => {
    if (!map) return
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 16, maxWidth: '260px' })
    const onClick = (e: MapLayerMouseEvent) => {
      const id = Number(e.features?.[0]?.properties?.id)
      if (Number.isFinite(id)) onSelectRef.current?.(id)
    }
    const onEnter = (e: MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = 'pointer'
      if (!hover) return
      const f = e.features?.[0]
      const d = devRef.current.find((x) => x.id === Number(f?.properties?.id))
      if (!d || f?.geometry.type !== 'Point') return
      popup
        .setLngLat(f.geometry.coordinates as [number, number])
        .setDOMContent(popupContent(d))
        .addTo(map)
    }
    const onLeave = () => {
      map.getCanvas().style.cursor = ''
      popup.remove()
    }
    for (const l of [LAYER, LAYER_SEL]) {
      map.on('click', l, onClick)
      map.on('mouseenter', l, onEnter)
      map.on('mouseleave', l, onLeave)
    }
    return () => {
      popup.remove()
      for (const l of [LAYER, LAYER_SEL]) {
        map.off('click', l, onClick)
        map.off('mouseenter', l, onEnter)
        map.off('mouseleave', l, onLeave)
      }
    }
  }, [map, hover])

  // HTML cluster markers (no glyph dependency, status-mix ring)
  useEffect(() => {
    if (!map || !cluster) return
    let last = 0
    const update = () => {
      const now = performance.now()
      if (now - last < 80) return
      last = now
      if (!map.getSource(SRC) || !map.isSourceLoaded(SRC)) return
      const feats = map.querySourceFeatures(SRC, { filter: ['has', 'point_count'] })
      const keep = new Set<number>()
      for (const f of feats) {
        const p = f.properties as Record<string, number>
        const cid = p.cluster_id
        if (keep.has(cid) || f.geometry.type !== 'Point') continue
        keep.add(cid)
        const ll = f.geometry.coordinates as [number, number]
        const existing = markers.current.get(cid)
        if (existing && existing.getElement().dataset.count === String(p.point_count)) {
          existing.setLngLat(ll)
          continue
        }
        existing?.remove()
        const el = clusterElement(p, p.point_count)
        el.dataset.count = String(p.point_count)
        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          const src = map.getSource(SRC) as GeoJSONSource
          void src.getClusterExpansionZoom(cid).then((z) => map.easeTo({ center: ll, zoom: z + 0.5 }))
        })
        markers.current.set(cid, new maplibregl.Marker({ element: el }).setLngLat(ll).addTo(map))
      }
      for (const [cid, m] of markers.current) {
        if (!keep.has(cid)) {
          m.remove()
          markers.current.delete(cid)
        }
      }
    }
    map.on('render', update)
    const all = markers.current
    return () => {
      map.off('render', update)
      for (const m of all.values()) m.remove()
      all.clear()
    }
  }, [map, cluster])

  useEffect(
    () => () => {
      if (raf.current != null) cancelAnimationFrame(raf.current)
    },
    [],
  )

  return null
}
