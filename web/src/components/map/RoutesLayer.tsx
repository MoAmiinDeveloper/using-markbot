import { useEffect, useRef } from 'react'
import maplibregl, { type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl'
import type { FleetRoute } from '@/api/types'
import { useMapCtx } from './MapCanvas'

/** Metres per pixel at zoom 0 on the equator (512 px tiles). */
const M_PER_PX_Z0 = 78271.517

export interface RouteShape {
  id: number
  name: string
  color: string
  path: Array<[number, number]>
  corridor: number
}

/** Line width (px) that covers `meters` on the ground at every zoom, for a feature property `w0`. */
const trueWidth: maplibregl.ExpressionSpecification = [
  'interpolate',
  ['exponential', 2],
  ['zoom'],
  0,
  ['get', 'w0'],
  24,
  ['*', ['get', 'w0'], 16777216],
]

function features(routes: RouteShape[], selectedId: number | null | undefined): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: routes
      .filter((r) => r.path?.length >= 2)
      .map((r) => {
        const lat = r.path[Math.floor(r.path.length / 2)][1]
        return {
          type: 'Feature',
          id: r.id,
          geometry: { type: 'LineString', coordinates: r.path },
          properties: {
            id: r.id,
            color: r.color || '#ffd700',
            sel: r.id === selectedId ? 1 : 0,
            // corridor on each side → full width
            w0: (2 * Math.max(5, r.corridor || 0)) / (M_PER_PX_Z0 * Math.cos((lat * Math.PI) / 180)),
          },
        }
      }),
  }
}

/** Midpoint along the polyline (by vertex count — fine for a label anchor). */
function anchor(path: Array<[number, number]>): [number, number] {
  const i = Math.floor((path.length - 1) / 2)
  const a = path[i]
  const b = path[Math.min(path.length - 1, i + 1)]
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

/**
 * Planned routes: a translucent true-scale corridor (the deviation buffer) under a solid line,
 * with HTML name labels. `prefix` keeps sources unique when two instances share a map.
 */
export function RoutesLayer({
  routes,
  selectedId,
  hiddenId,
  onSelect,
  corridor = true,
  labels = true,
  prefix = 'routes',
}: {
  routes: RouteShape[] | FleetRoute[]
  selectedId?: number | null
  hiddenId?: number | null
  onSelect?: (id: number) => void
  corridor?: boolean
  labels?: boolean
  prefix?: string
}) {
  const { map, styleVersion } = useMapCtx()
  const SRC = `${prefix}-src`
  const BUF = `${prefix}-corridor`
  const CASING = `${prefix}-casing`
  const LINE = `${prefix}-line`
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const markers = useRef<maplibregl.Marker[]>([])
  const shown = (routes as RouteShape[]).filter((r) => r.id !== hiddenId)

  useEffect(() => {
    if (!map || styleVersion === 0) return
    try {
      if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      const before = ['vehicles-icons'].find((l) => map.getLayer(l))
      if (!map.getLayer(BUF))
        map.addLayer(
          {
            id: BUF,
            type: 'line',
            source: SRC,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': ['get', 'color'], 'line-width': trueWidth, 'line-opacity': ['case', ['==', ['get', 'sel'], 1], 0.26, 0.16] },
          },
          before,
        )
      if (!map.getLayer(CASING))
        map.addLayer(
          {
            id: CASING,
            type: 'line',
            source: SRC,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#141b37', 'line-opacity': 0.55, 'line-width': ['case', ['==', ['get', 'sel'], 1], 7, 5.5] },
          },
          before,
        )
      if (!map.getLayer(LINE))
        map.addLayer(
          {
            id: LINE,
            type: 'line',
            source: SRC,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'sel'], 1], 4.5, 3] },
          },
          before,
        )
    } catch {
      /* style not ready */
    }
    return () => {
      try {
        if (!map.getStyle()) return
        for (const l of [LINE, CASING, BUF]) if (map.getLayer(l)) map.removeLayer(l)
        if (map.getSource(SRC)) map.removeSource(SRC)
      } catch {
        /* map destroyed */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, styleVersion])

  const key = JSON.stringify(shown.map((r) => [r.id, r.color, r.corridor, r.path.length, r.path[0], r.path[r.path.length - 1], r.name]))
  useEffect(() => {
    if (!map || styleVersion === 0) return
    ;(map.getSource(SRC) as GeoJSONSource | undefined)?.setData(features(shown, selectedId))
    if (map.getLayer(BUF)) map.setLayoutProperty(BUF, 'visibility', corridor ? 'visible' : 'none')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, styleVersion, key, selectedId, corridor])

  useEffect(() => {
    if (!map || !labels) return
    markers.current = shown
      .filter((r) => r.path?.length >= 2)
      .map((r) => {
        const el = document.createElement('div')
        el.className = 'geofence-label'
        if (r.id === selectedId) el.dataset.selected = '1'
        const dot = document.createElement('span')
        dot.style.background = r.color || '#ffd700'
        const txt = document.createElement('span')
        txt.textContent = r.name
        el.append(dot, txt)
        if (onSelectRef.current) {
          el.style.cursor = 'pointer'
          el.addEventListener('click', (e) => {
            e.stopPropagation()
            onSelectRef.current?.(r.id)
          })
        }
        return new maplibregl.Marker({ element: el }).setLngLat(anchor(r.path)).addTo(map)
      })
    return () => {
      markers.current.forEach((m) => m.remove())
      markers.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key, selectedId, labels])

  useEffect(() => {
    if (!map || !onSelect) return
    const click = (e: MapLayerMouseEvent) => {
      const id = Number(e.features?.[0]?.properties?.id)
      if (Number.isFinite(id)) onSelectRef.current?.(id)
    }
    const enter = () => (map.getCanvas().style.cursor = 'pointer')
    const leave = () => (map.getCanvas().style.cursor = '')
    map.on('click', LINE, click)
    map.on('mouseenter', LINE, enter)
    map.on('mouseleave', LINE, leave)
    return () => {
      map.off('click', LINE, click)
      map.off('mouseenter', LINE, enter)
      map.off('mouseleave', LINE, leave)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, !!onSelect])

  return null
}

export function routesBounds(routes: Array<{ path: Array<[number, number]> }>): [[number, number], [number, number]] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of routes)
    for (const [x, y] of r.path ?? []) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  return Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : null
}
