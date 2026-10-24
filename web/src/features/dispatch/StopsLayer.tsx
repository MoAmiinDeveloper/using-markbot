import { useEffect, useRef } from 'react'
import maplibregl, { type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl'
import { useMapCtx } from '@/components/map/MapCanvas'
import { circleRing } from '@/lib/geo'
import { stopMeta } from './meta'

export interface StopPoint {
  lat: number
  lng: number
  radius: number
  status?: string
  name?: string
  /** label inside the pin (defaults to the 1-based index) */
  label?: string
  /** colour override (e.g. job status on the overview map) */
  color?: string
  /** opaque value passed back on click */
  key?: string | number
}

/**
 * Job stops: radius circles, a dashed connector in visiting order and numbered HTML pins
 * coloured by stop status. Optional editing: drag pins, click the map to add.
 */
export function StopsLayer({
  stops,
  prefix = 'stops',
  connect = true,
  selected,
  draggable,
  onMove,
  onPinClick,
  onMapClick,
}: {
  stops: StopPoint[]
  prefix?: string
  connect?: boolean
  selected?: number | null
  draggable?: boolean
  onMove?: (index: number, lngLat: [number, number]) => void
  onPinClick?: (index: number, key?: string | number) => void
  onMapClick?: (lngLat: [number, number]) => void
}) {
  const { map, styleVersion } = useMapCtx()
  const SRC = `${prefix}-src`
  const FILL = `${prefix}-fill`
  const RING = `${prefix}-ring`
  const PATH = `${prefix}-path`
  const markers = useRef<maplibregl.Marker[]>([])
  const cb = useRef({ onMove, onPinClick, onMapClick })
  cb.current = { onMove, onPinClick, onMapClick }

  useEffect(() => {
    if (!map || styleVersion === 0) return
    try {
      if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      const before = ['vehicles-icons'].find((l) => map.getLayer(l))
      if (!map.getLayer(FILL))
        map.addLayer({ id: FILL, type: 'fill', source: SRC, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.14 } }, before)
      if (!map.getLayer(RING))
        map.addLayer(
          { id: RING, type: 'line', source: SRC, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.8 } },
          before,
        )
      if (!map.getLayer(PATH))
        map.addLayer(
          {
            id: PATH,
            type: 'line',
            source: SRC,
            filter: ['==', ['geometry-type'], 'LineString'],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#222d5d', 'line-width': 2.2, 'line-opacity': 0.75, 'line-dasharray': [1.5, 1.5] },
          },
          before,
        )
    } catch {
      /* style not ready */
    }
    return () => {
      try {
        if (!map.getStyle()) return
        for (const l of [PATH, RING, FILL]) if (map.getLayer(l)) map.removeLayer(l)
        if (map.getSource(SRC)) map.removeSource(SRC)
      } catch {
        /* removed */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, styleVersion])

  // geometry
  useEffect(() => {
    if (!map || styleVersion === 0) return
    const feats: GeoJSON.Feature[] = stops
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
      .map((s) => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [circleRing([s.lng, s.lat], Math.max(10, s.radius || 100), 48)] },
        properties: { color: s.color ?? stopMeta(s.status ?? 'pending').color },
      }))
    if (connect && stops.length >= 2)
      feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: stops.map((s) => [s.lng, s.lat]) }, properties: {} })
    ;(map.getSource(SRC) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats })
    if (map.getLayer(PATH)) map.setPaintProperty(PATH, 'line-color', document.documentElement.classList.contains('dark') ? '#ffd700' : '#222d5d')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, styleVersion, stops, connect])

  // pins
  const structure = stops.map((s, i) => `${s.label ?? i + 1}|${s.status}|${s.color}|${s.name}|${s.key}`).join(',') + `|${selected}|${draggable}`
  useEffect(() => {
    if (!map) return
    markers.current = stops.map((s, i) => {
      const m = stopMeta(s.status ?? 'pending')
      const el = document.createElement('div')
      el.className = 'stop-pin'
      el.style.setProperty('--pin', s.color ?? m.color)
      el.style.setProperty('--pin-fg', s.color ? '#ffffff' : m.fg)
      if (selected === i) el.dataset.selected = ''
      el.textContent = s.label ?? String(i + 1)
      el.title = s.name ? `${s.label ?? i + 1}. ${s.name}` : `Stop ${i + 1}`
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        cb.current.onPinClick?.(i, s.key)
      })
      if (cb.current.onPinClick || draggable) el.style.cursor = draggable ? 'grab' : 'pointer'
      const mk = new maplibregl.Marker({ element: el, draggable: !!draggable }).setLngLat([s.lng, s.lat]).addTo(map)
      if (draggable)
        mk.on('dragend', () => {
          const ll = mk.getLngLat()
          cb.current.onMove?.(i, [ll.lng, ll.lat])
        })
      return mk
    })
    return () => {
      markers.current.forEach((x) => x.remove())
      markers.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, structure])

  // keep positions in sync without rebuilding
  useEffect(() => {
    stops.forEach((s, i) => markers.current[i]?.setLngLat([s.lng, s.lat]))
  }, [stops])

  // click-to-add
  const adding = !!onMapClick
  useEffect(() => {
    if (!map || !adding) return
    const canvas = map.getCanvas()
    canvas.style.cursor = 'crosshair'
    const click = (e: MapMouseEvent) => cb.current.onMapClick?.([e.lngLat.lng, e.lngLat.lat])
    map.on('click', click)
    return () => {
      canvas.style.cursor = ''
      map.off('click', click)
    }
  }, [map, adding])

  return null
}

/** Fit the camera to a set of stops (+ optional extra points) whenever `fitKey` changes. */
export function FitStops({
  points,
  fitKey,
  padding = 40,
  maxZoom = 15,
}: {
  points: Array<[number, number]>
  fitKey: string | number
  padding?: number | maplibregl.PaddingOptions
  maxZoom?: number
}) {
  const { map } = useMapCtx()
  const pts = useRef(points)
  pts.current = points
  useEffect(() => {
    if (!map || !pts.current.length) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [x, y] of pts.current) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    if (!Number.isFinite(minX)) return
    const pad = 0.004
    const fit = (duration: number) => {
      try {
        map.fitBounds(
          [
            [minX - pad, minY - pad],
            [maxX + pad, maxY + pad],
          ],
          { padding, maxZoom, duration },
        )
      } catch {
        /* container too small for the padding */
      }
    }
    fit(0)
    // the container may still be settling (sheet animation, lazy layout): fit again once it has its final size
    const t = window.setTimeout(() => {
      map.resize()
      fit(400)
    }, 320)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey])
  return null
}
