import { useEffect, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl'
import { useMapCtx } from '@/components/map/MapCanvas'

export type LngLat = [number, number]
export interface LineDraft {
  points: LngLat[]
  finished: boolean
}

const SRC = 'route-draft-guide'
const GUIDE = 'route-draft-guide-line'

function handle(kind: 'vertex' | 'mid' | 'first', title: string) {
  const el = document.createElement('div')
  el.className = 'geo-handle'
  el.dataset.kind = kind === 'first' ? 'vertex' : kind
  el.title = title
  return el
}

/**
 * Draw / edit a polyline: click to add points, double-click or Enter to finish, Backspace to
 * undo; drag vertices, drag a midpoint to insert, double-click a vertex to remove it.
 * The line itself (and its corridor) is rendered by RoutesLayer from the same points.
 */
export function PolylineEditor({ draft, color, onChange }: { draft: LineDraft; color: string; onChange: (d: LineDraft) => void }) {
  const { map, styleVersion } = useMapCtx()
  const ref = useRef(draft)
  ref.current = draft
  const cb = useRef(onChange)
  cb.current = onChange
  const cursor = useRef<LngLat | null>(null)

  useEffect(() => {
    if (!map || styleVersion === 0) return
    try {
      if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      if (!map.getLayer(GUIDE))
        map.addLayer({ id: GUIDE, type: 'line', source: SRC, layout: { 'line-cap': 'round' }, paint: { 'line-color': color, 'line-width': 2, 'line-dasharray': [1, 2], 'line-opacity': 0.9 } })
    } catch {
      /* not ready */
    }
    return () => {
      try {
        if (!map.getStyle()) return
        if (map.getLayer(GUIDE)) map.removeLayer(GUIDE)
        if (map.getSource(SRC)) map.removeSource(SRC)
      } catch {
        /* gone */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, styleVersion])

  const guide = () => {
    const src = map?.getSource(SRC) as GeoJSONSource | undefined
    const d = ref.current
    const c = cursor.current
    src?.setData({
      type: 'FeatureCollection',
      features: !d.finished && d.points.length && c ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [d.points[d.points.length - 1], c] }, properties: {} }] : [],
    })
  }

  // drawing
  useEffect(() => {
    if (!map || draft.finished) return
    const canvas = map.getCanvas()
    canvas.style.cursor = 'crosshair'
    map.doubleClickZoom.disable()
    const finish = () => {
      const d = ref.current
      if (d.points.length >= 2) cb.current({ ...d, finished: true })
    }
    const click = (e: MapMouseEvent) => {
      const d = ref.current
      const last = d.points[d.points.length - 1]
      if (last) {
        const p = map.project(last)
        if (Math.hypot(p.x - e.point.x, p.y - e.point.y) < 6) return
      }
      cb.current({ ...d, points: [...d.points, [e.lngLat.lng, e.lngLat.lat]] })
    }
    const move = (e: MapMouseEvent) => {
      cursor.current = [e.lngLat.lng, e.lngLat.lat]
      guide()
    }
    const dbl = (e: MapMouseEvent) => {
      e.preventDefault()
      finish()
    }
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      if (e.key === 'Enter') finish()
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        const d = ref.current
        cb.current({ ...d, points: d.points.slice(0, -1) })
      }
    }
    map.on('click', click)
    map.on('mousemove', move)
    map.on('dblclick', dbl)
    window.addEventListener('keydown', key)
    return () => {
      canvas.style.cursor = ''
      map.off('click', click)
      map.off('mousemove', move)
      map.off('dblclick', dbl)
      window.removeEventListener('keydown', key)
      window.setTimeout(() => map.doubleClickZoom.enable(), 0)
      cursor.current = null
      guide()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, draft.finished])

  useEffect(() => {
    guide()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  // handles: rebuilt when the structure changes
  const frozen = useRef<string | null>(null)
  const [, thaw] = useState(0)
  const structure = `${draft.points.length}:${draft.finished ? 1 : 0}`
  const key = frozen.current ?? structure
  const markers = useRef<{ v: maplibregl.Marker[]; m: maplibregl.Marker[] }>({ v: [], m: [] })
  useEffect(() => {
    if (!map) return
    const d = ref.current
    const add = (el: HTMLElement, at: LngLat) => new maplibregl.Marker({ element: el, draggable: true }).setLngLat(at).addTo(map)
    markers.current.v = d.points.map((pt, i) => {
      const el = handle(i === 0 ? 'first' : 'vertex', 'Drag to move · double-click to remove')
      const mk = add(el, pt)
      mk.on('drag', () => {
        const cur = ref.current
        const ll = mk.getLngLat()
        const points = cur.points.slice()
        points[i] = [ll.lng, ll.lat]
        cb.current({ ...cur, points })
      })
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation()
        e.preventDefault()
        const cur = ref.current
        if (cur.points.length <= 2) return
        cb.current({ ...cur, points: cur.points.filter((_, k) => k !== i) })
      })
      return mk
    })
    markers.current.m = d.finished
      ? d.points.slice(0, -1).map((pt, i) => {
          const nx = d.points[i + 1]
          const mk = add(handle('mid', 'Drag to add a point'), [(pt[0] + nx[0]) / 2, (pt[1] + nx[1]) / 2])
          let inserted = false
          mk.on('dragstart', () => (frozen.current = `${ref.current.points.length}:1`))
          mk.on('dragend', () => {
            frozen.current = null
            thaw((t) => t + 1)
          })
          mk.on('drag', () => {
            const cur = ref.current
            const ll = mk.getLngLat()
            const points = cur.points.slice()
            if (!inserted) {
              points.splice(i + 1, 0, [ll.lng, ll.lat])
              inserted = true
            } else points[i + 1] = [ll.lng, ll.lat]
            cb.current({ ...cur, points })
          })
          return mk
        })
      : []
    return () => {
      for (const m of [...markers.current.v, ...markers.current.m]) m.remove()
      markers.current = { v: [], m: [] }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key])

  useEffect(() => {
    if (frozen.current) return
    draft.points.forEach((p, i) => markers.current.v[i]?.setLngLat(p))
    if (draft.finished)
      draft.points.slice(0, -1).forEach((p, i) => {
        const nx = draft.points[i + 1]
        markers.current.m[i]?.setLngLat([(p[0] + nx[0]) / 2, (p[1] + nx[1]) / 2])
      })
  }, [draft])

  return null
}

/** Length of a [lng, lat] polyline in metres. */
export function pathLength(path: LngLat[]): number {
  let m = 0
  for (let i = 1; i < path.length; i++) {
    const [x1, y1] = path[i - 1]
    const [x2, y2] = path[i]
    const r = Math.PI / 180
    const a = Math.sin(((y2 - y1) * r) / 2) ** 2 + Math.cos(y1 * r) * Math.cos(y2 * r) * Math.sin(((x2 - x1) * r) / 2) ** 2
    m += 2 * 6371008.8 * Math.asin(Math.sqrt(a))
  }
  return m
}
