import { useEffect, useRef } from 'react'
import maplibregl, { type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl'
import type { Geofence } from '@/api/types'
import { geofenceAnchor, geofenceFeature } from '@/features/geofences/shape'
import { useUi } from '@/store/ui'
import { useMapCtx } from './MapCanvas'

const SRC = 'geofences'
const FILL = 'geofences-fill'
const LINE = 'geofences-line'
const LABEL_MIN_ZOOM = 10

function labelEl(g: Geofence): HTMLElement {
  const el = document.createElement('div')
  el.className = 'geofence-label'
  const dot = document.createElement('span')
  dot.style.background = g.color
  const txt = document.createElement('span')
  txt.textContent = g.name
  el.append(dot, txt)
  return el
}

/**
 * Geofences as a subtle fill + outline, with HTML name labels (no glyph dependency so they
 * render on every basemap, including the offline fallback).
 */
export function GeofenceLayer({
  geofences,
  selectedId,
  hiddenId,
  onSelect,
  labels = true,
}: {
  geofences: Geofence[]
  selectedId?: number | null
  /** geofence currently being edited (drawn by the editor instead) */
  hiddenId?: number | null
  onSelect?: (id: number) => void
  labels?: boolean
}) {
  const { map, styleVersion } = useMapCtx()
  const theme = useUi((s) => s.theme)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const markers = useRef<maplibregl.Marker[]>([])
  const clickable = !!onSelect

  // layers
  useEffect(() => {
    if (!map || styleVersion === 0) return
    try {
      if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      const before = ['route-casing', 'vehicles-icons'].find((l) => map.getLayer(l))
      if (!map.getLayer(FILL))
        map.addLayer(
          {
            id: FILL,
            type: 'fill',
            source: SRC,
            paint: {
              'fill-color': ['get', 'color'],
              'fill-opacity': ['case', ['==', ['get', 'selected'], 1], 0.24, 0.12],
            },
          },
          before,
        )
      if (!map.getLayer(LINE))
        map.addLayer(
          {
            id: LINE,
            type: 'line',
            source: SRC,
            layout: { 'line-join': 'round' },
            paint: {
              'line-color': ['get', 'color'],
              'line-width': ['case', ['==', ['get', 'selected'], 1], 2.6, 1.6],
              'line-opacity': 0.9,
            },
          },
          before,
        )
    } catch {
      /* style not ready; retried on next style.load */
    }
  }, [map, styleVersion])

  // remove on unmount (e.g. layer toggled off)
  useEffect(
    () => () => {
      if (!map) return
      try {
        if (!map.getStyle()) return
        for (const l of [LINE, FILL]) if (map.getLayer(l)) map.removeLayer(l)
        if (map.getSource(SRC)) map.removeSource(SRC)
      } catch {
        /* map already destroyed */
      }
    },
    [map],
  )

  // data
  useEffect(() => {
    if (!map || styleVersion === 0) return
    const src = map.getSource(SRC) as GeoJSONSource | undefined
    if (!src) return
    const features = geofences
      .filter((g) => g.id !== hiddenId)
      .map((g) => geofenceFeature(g, g.id === selectedId))
      .filter((f): f is GeoJSON.Feature<GeoJSON.Polygon> => !!f)
    src.setData({ type: 'FeatureCollection', features })
  }, [map, styleVersion, geofences, selectedId, hiddenId])

  // labels
  useEffect(() => {
    if (!map || !labels) return
    for (const m of markers.current) m.remove()
    markers.current = []
    for (const g of geofences) {
      if (g.id === hiddenId) continue
      const at = geofenceAnchor(g)
      if (!at) continue
      const el = labelEl(g)
      if (g.id === selectedId) el.dataset.selected = '1'
      el.addEventListener('click', (ev) => {
        if (!clickable || !onSelectRef.current) return
        ev.stopPropagation()
        onSelectRef.current(g.id)
      })
      if (clickable) el.style.cursor = 'pointer'
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat(at).addTo(map))
    }
    const vis = () => {
      const show = map.getZoom() >= LABEL_MIN_ZOOM
      for (const m of markers.current) m.getElement().style.visibility = show ? '' : 'hidden'
    }
    vis()
    map.on('zoomend', vis)
    return () => {
      map.off('zoomend', vis)
      for (const m of markers.current) m.remove()
      markers.current = []
    }
  }, [map, geofences, selectedId, hiddenId, labels, theme, clickable])

  // clicks on shapes
  useEffect(() => {
    if (!map || !clickable) return
    const onClick = (e: MapLayerMouseEvent) => {
      // vehicles take precedence over the geofence underneath
      if (map.getLayer('vehicles-icons') && map.queryRenderedFeatures(e.point, { layers: ['vehicles-icons'] }).length) return
      const id = Number(e.features?.[0]?.properties?.id)
      if (Number.isFinite(id)) onSelectRef.current?.(id)
    }
    const enter = () => (map.getCanvas().style.cursor = 'pointer')
    const leave = () => (map.getCanvas().style.cursor = '')
    map.on('click', FILL, onClick)
    map.on('mouseenter', FILL, enter)
    map.on('mouseleave', FILL, leave)
    return () => {
      map.off('click', FILL, onClick)
      map.off('mouseenter', FILL, enter)
      map.off('mouseleave', FILL, leave)
    }
  }, [map, clickable])

  return null
}
