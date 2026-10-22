import { useEffect, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl'
import { useMapCtx } from '@/components/map/MapCanvas'
import { circleRing, destination, haversine } from '@/lib/geo'

export type LngLat = [number, number]

export type Draft =
  | { type: 'circle'; center: LngLat | null; radius: number }
  | { type: 'polygon'; points: LngLat[]; closed: boolean }

export const isDraftComplete = (d: Draft) => (d.type === 'circle' ? d.center != null && d.radius > 0 : d.closed && d.points.length >= 3)

const SRC = 'geo-draft'
const SRC_GUIDE = 'geo-draft-guide'
const FILL = 'geo-draft-fill'
const LINE = 'geo-draft-line'
const GUIDE = 'geo-draft-guide-line'
const MIN_RADIUS = 20

function draftFeatures(d: Draft, color: string): GeoJSON.FeatureCollection {
  const feats: GeoJSON.Feature[] = []
  if (d.type === 'circle' && d.center) {
    feats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [circleRing(d.center, Math.max(d.radius, 1))] }, properties: { color } })
  } else if (d.type === 'polygon' && d.points.length) {
    if (d.closed || d.points.length >= 3)
      feats.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[...d.points, d.points[0]]] },
        properties: { color, open: d.closed ? 0 : 1 },
      })
    if (!d.closed && d.points.length >= 2)
      feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: d.points }, properties: { color } })
  }
  return { type: 'FeatureCollection', features: feats }
}

function handle(kind: 'vertex' | 'mid' | 'first' | 'center' | 'radius', title: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'geo-handle'
  el.dataset.kind = kind
  el.title = title
  return el
}

/** Metres covered by `px` screen pixels at the map centre. */
function metersForPixels(map: maplibregl.Map, px: number): number {
  const c = map.getCenter()
  const p = map.project(c)
  const q = map.unproject([p.x + px, p.y])
  return haversine(c.lat, c.lng, q.lat, q.lng)
}

/**
 * Hand-rolled draw/edit interaction for circle + polygon geofences.
 *  - circle: press to place the centre and drag out the radius (or tap for a default radius);
 *    afterwards drag the centre or the radius handle.
 *  - polygon: click to add points, double-click / click the first point / Enter to finish;
 *    afterwards drag vertices, drag a midpoint to insert one, double-click a vertex to remove it.
 */
export function ShapeEditor({
  draft,
  color,
  onChange,
}: {
  draft: Draft
  color: string
  onChange: (d: Draft) => void
}) {
  const { map, styleVersion } = useMapCtx()
  const draftRef = useRef(draft)
  draftRef.current = draft
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const cursor = useRef<LngLat | null>(null)

  // ---- layers
  useEffect(() => {
    if (!map || styleVersion === 0) return
    try {
      const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
      if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: empty })
      if (!map.getSource(SRC_GUIDE)) map.addSource(SRC_GUIDE, { type: 'geojson', data: empty })
      if (!map.getLayer(FILL))
        map.addLayer({
          id: FILL,
          type: 'fill',
          source: SRC,
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['==', ['get', 'open'], 1], 0.08, 0.2] },
        })
      if (!map.getLayer(LINE))
        map.addLayer({
          id: LINE,
          type: 'line',
          source: SRC,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-dasharray': [2, 1.5] },
        })
      if (!map.getLayer(GUIDE))
        map.addLayer({
          id: GUIDE,
          type: 'line',
          source: SRC_GUIDE,
          layout: { 'line-cap': 'round' },
          paint: { 'line-color': color, 'line-width': 1.5, 'line-opacity': 0.8, 'line-dasharray': [1, 2] },
        })
    } catch {
      /* retried on next style load */
    }
    return () => {
      try {
        if (!map.getStyle()) return
        for (const l of [GUIDE, LINE, FILL]) if (map.getLayer(l)) map.removeLayer(l)
        for (const s of [SRC_GUIDE, SRC]) if (map.getSource(s)) map.removeSource(s)
      } catch {
        /* map destroyed */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, styleVersion])

  const renderGuide = () => {
    if (!map) return
    const d = draftRef.current
    const src = map.getSource(SRC_GUIDE) as GeoJSONSource | undefined
    if (!src) return
    const c = cursor.current
    const feats: GeoJSON.Feature[] = []
    if (d.type === 'polygon' && !d.closed && d.points.length && c) {
      const coords = d.points.length >= 2 ? [d.points[d.points.length - 1], c, d.points[0]] : [d.points[0], c]
      feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} })
    }
    src.setData({ type: 'FeatureCollection', features: feats })
  }

  // ---- data
  useEffect(() => {
    if (!map || styleVersion === 0) return
    ;(map.getSource(SRC) as GeoJSONSource | undefined)?.setData(draftFeatures(draft, color))
    if (map.getLayer(GUIDE)) map.setPaintProperty(GUIDE, 'line-color', color)
    renderGuide()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, styleVersion, draft, color])

  // ---- drawing interactions (incomplete shapes)
  // a circle press-drag keeps the interaction alive until the mouse is released
  const [circleDrag, setCircleDrag] = useState(false)
  const drawing = circleDrag || (draft.type === 'circle' ? draft.center == null : !draft.closed)
  useEffect(() => {
    if (!map || !drawing) return
    const canvas = map.getCanvas()
    canvas.style.cursor = 'crosshair'
    map.doubleClickZoom.disable()
    let dragging = false
    let downPx: { x: number; y: number } | null = null

    const finishPolygon = () => {
      const d = draftRef.current
      if (d.type === 'polygon' && !d.closed && d.points.length >= 3) onChangeRef.current({ ...d, closed: true })
    }

    const onDown = (e: MapMouseEvent) => {
      const d = draftRef.current
      if (d.type !== 'circle' || d.center || e.originalEvent.button !== 0) return
      e.preventDefault()
      dragging = true
      setCircleDrag(true)
      downPx = { x: e.originalEvent.clientX, y: e.originalEvent.clientY }
      map.dragPan.disable()
      onChangeRef.current({ type: 'circle', center: [e.lngLat.lng, e.lngLat.lat], radius: 0 })
    }
    const onMove = (e: MapMouseEvent) => {
      const d = draftRef.current
      cursor.current = [e.lngLat.lng, e.lngLat.lat]
      if (d.type === 'polygon') renderGuide()
      if (dragging && d.type === 'circle' && d.center)
        onChangeRef.current({ ...d, radius: haversine(d.center[1], d.center[0], e.lngLat.lat, e.lngLat.lng) })
    }
    // window-level so releasing outside the map still ends the drag
    const onUp = (e: MouseEvent) => {
      if (!dragging) return
      dragging = false
      map.dragPan.enable()
      const d = draftRef.current
      if (d.type === 'circle' && d.center) {
        const moved = downPx ? Math.hypot(e.clientX - downPx.x, e.clientY - downPx.y) : 0
        const r = moved < 8 ? metersForPixels(map, 90) : Math.max(MIN_RADIUS, d.radius)
        onChangeRef.current({ ...d, radius: Math.round(r) })
      }
      setCircleDrag(false)
    }
    const onClick = (e: MapMouseEvent) => {
      const d = draftRef.current
      const ll: LngLat = [e.lngLat.lng, e.lngLat.lat]
      if (d.type === 'circle') {
        // touch taps (no mousedown) place the centre with a default radius
        if (!d.center && !dragging) onChangeRef.current({ type: 'circle', center: ll, radius: Math.round(metersForPixels(map, 90)) })
        return
      }
      if (d.closed) return
      const last = d.points[d.points.length - 1]
      if (last) {
        const p = map.project(last)
        if (Math.hypot(p.x - e.point.x, p.y - e.point.y) < 6) return // second click of a double-click
      }
      onChangeRef.current({ ...d, points: [...d.points, ll] })
    }
    const onDbl = (e: MapMouseEvent) => {
      e.preventDefault()
      finishPolygon()
    }
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      const d = draftRef.current
      if (e.key === 'Enter') finishPolygon()
      if ((e.key === 'Backspace' || e.key === 'Delete') && d.type === 'polygon' && !d.closed && d.points.length) {
        e.preventDefault()
        onChangeRef.current({ ...d, points: d.points.slice(0, -1) })
      }
    }
    map.on('mousedown', onDown)
    map.on('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    map.on('click', onClick)
    map.on('dblclick', onDbl)
    window.addEventListener('keydown', onKey)
    return () => {
      canvas.style.cursor = ''
      map.dragPan.enable()
      map.off('mousedown', onDown)
      map.off('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      map.off('click', onClick)
      map.off('dblclick', onDbl)
      window.removeEventListener('keydown', onKey)
      window.setTimeout(() => map.doubleClickZoom.enable(), 0)
      cursor.current = null
      renderGuide()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, drawing])

  // ---- handles (markers). Rebuilt only when the structure changes, so a drag isn't interrupted.
  const markers = useRef<{ main: maplibregl.Marker[]; mids: maplibregl.Marker[]; radius: maplibregl.Marker | null }>({
    main: [],
    mids: [],
    radius: null,
  })
  const structure =
    draft.type === 'circle'
      ? `c:${draft.center ? 1 : 0}:${drawing ? 'd' : 'e'}`
      : `p:${draft.points.length}:${draft.closed ? 1 : 0}`
  // while a midpoint is being dragged the vertex count changes; freeze the handles until it's dropped
  const frozen = useRef<string | null>(null)
  const [, setThaw] = useState(0)
  const key = frozen.current ?? structure

  useEffect(() => {
    if (!map) return
    const d = draftRef.current
    const all = markers.current
    const add = (el: HTMLElement, at: LngLat, draggable: boolean) =>
      new maplibregl.Marker({ element: el, draggable }).setLngLat(at).addTo(map)

    if (d.type === 'circle' && d.center && !drawing) {
      const c = add(handle('center', 'Drag to move'), d.center, true)
      c.on('drag', () => {
        const cur = draftRef.current
        if (cur.type !== 'circle') return
        const ll = c.getLngLat()
        onChangeRef.current({ ...cur, center: [ll.lng, ll.lat] })
      })
      const r = add(handle('radius', 'Drag to resize'), destination(d.center[0], d.center[1], d.radius, 90), true)
      r.on('drag', () => {
        const cur = draftRef.current
        if (cur.type !== 'circle' || !cur.center) return
        const ll = r.getLngLat()
        onChangeRef.current({ ...cur, radius: Math.max(MIN_RADIUS, Math.round(haversine(cur.center[1], cur.center[0], ll.lat, ll.lng))) })
      })
      all.main = [c]
      all.radius = r
    } else if (d.type === 'polygon') {
      all.main = d.points.map((pt, i) => {
        const first = i === 0 && !d.closed && d.points.length >= 3
        const el = handle(first ? 'first' : 'vertex', first ? 'Click to close the shape' : d.closed ? 'Drag to move · double-click to remove' : 'Point')
        const m = add(el, pt, d.closed)
        if (first) {
          el.addEventListener('click', (ev) => {
            ev.stopPropagation()
            const cur = draftRef.current
            if (cur.type === 'polygon' && cur.points.length >= 3) onChangeRef.current({ ...cur, closed: true })
          })
        }
        if (d.closed) {
          m.on('drag', () => {
            const cur = draftRef.current
            if (cur.type !== 'polygon') return
            const ll = m.getLngLat()
            const points = cur.points.slice()
            points[i] = [ll.lng, ll.lat]
            onChangeRef.current({ ...cur, points })
          })
          el.addEventListener('dblclick', (ev) => {
            ev.stopPropagation()
            ev.preventDefault()
            const cur = draftRef.current
            if (cur.type !== 'polygon' || cur.points.length <= 3) return
            onChangeRef.current({ ...cur, points: cur.points.filter((_, k) => k !== i) })
          })
        }
        return m
      })
      if (d.closed) {
        all.mids = d.points.map((pt, i) => {
          const nx = d.points[(i + 1) % d.points.length]
          const m = add(handle('mid', 'Drag to add a point'), [(pt[0] + nx[0]) / 2, (pt[1] + nx[1]) / 2], true)
          let inserted = false
          m.on('dragstart', () => {
            frozen.current = `p:${draftRef.current.type === 'polygon' ? draftRef.current.points.length : 0}:1`
          })
          m.on('dragend', () => {
            frozen.current = null
            setThaw((t) => t + 1)
          })
          m.on('drag', () => {
            const cur = draftRef.current
            if (cur.type !== 'polygon') return
            const ll = m.getLngLat()
            const points = cur.points.slice()
            if (!inserted) {
              points.splice(i + 1, 0, [ll.lng, ll.lat])
              inserted = true
            } else points[i + 1] = [ll.lng, ll.lat]
            onChangeRef.current({ ...cur, points })
          })
          return m
        })
      }
    }
    return () => {
      for (const m of [...all.main, ...all.mids]) m.remove()
      all.radius?.remove()
      all.main = []
      all.mids = []
      all.radius = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key])

  // keep handle positions in sync (cheap setLngLat, no rebuild)
  useEffect(() => {
    const all = markers.current
    if (frozen.current) return
    if (draft.type === 'circle' && draft.center) {
      all.main[0]?.setLngLat(draft.center)
      all.radius?.setLngLat(destination(draft.center[0], draft.center[1], draft.radius, 90))
    } else if (draft.type === 'polygon') {
      draft.points.forEach((pt, i) => all.main[i]?.setLngLat(pt))
      if (draft.closed)
        draft.points.forEach((pt, i) => {
          const nx = draft.points[(i + 1) % draft.points.length]
          all.mids[i]?.setLngLat([(pt[0] + nx[0]) / 2, (pt[1] + nx[1]) / 2])
        })
    }
  }, [draft])

  return null
}
