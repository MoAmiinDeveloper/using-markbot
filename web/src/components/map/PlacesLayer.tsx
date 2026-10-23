import { useEffect, useRef } from 'react'
import maplibregl, { type GeoJSONSource } from 'maplibre-gl'
import type { Place } from '@/api/types'
import { circleRing } from '@/lib/geo'
import { placeMeta } from '@/lib/ops'
import { useMapCtx } from './MapCanvas'

const SRC = 'places'
const FILL = 'places-fill'
const LINE = 'places-line'

function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return false
  const n = parseInt(m[1], 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return 0.299 * r + 0.587 * g + 0.114 * b > 160
}

function pinEl(p: Place, selected: boolean, onClick?: () => void): HTMLElement {
  const el = document.createElement('div')
  el.className = 'place-pin'
  if (selected) el.dataset.selected = ''
  const color = p.color || placeMeta(p.category).color
  el.style.setProperty('--pin', color)
  el.style.setProperty('--pin-fg', isLight(color) ? '#141b37' : '#ffffff')
  const dot = document.createElement('span')
  dot.className = 'place-pin__dot'
  dot.textContent = (placeMeta(p.category).label[0] ?? 'P').toUpperCase()
  const txt = document.createElement('span')
  txt.className = 'place-pin__txt'
  txt.textContent = p.name
  el.append(dot, txt)
  el.title = `${p.name} · ${placeMeta(p.category).label}`
  if (onClick) {
    el.style.cursor = 'pointer'
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      onClick()
    })
  }
  return el
}

/** Points of interest: radius circle + an HTML pin with the name (no glyph dependency). */
export function PlacesLayer({ places, selectedId, onSelect, hiddenId }: { places: Place[]; selectedId?: number | null; onSelect?: (id: number) => void; hiddenId?: number | null }) {
  const { map, styleVersion } = useMapCtx()
  const markers = useRef<maplibregl.Marker[]>([])
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    if (!map || styleVersion === 0) return
    try {
      if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      const before = ['vehicles-icons'].find((l) => map.getLayer(l))
      if (!map.getLayer(FILL))
        map.addLayer({ id: FILL, type: 'fill', source: SRC, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['==', ['get', 'sel'], 1], 0.2, 0.1] } }, before)
      if (!map.getLayer(LINE))
        map.addLayer(
          { id: LINE, type: 'line', source: SRC, paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'sel'], 1], 2.2, 1.4], 'line-dasharray': [2, 1.5] } },
          before,
        )
    } catch {
      /* style not ready */
    }
    return () => {
      try {
        if (map.getLayer(LINE)) map.removeLayer(LINE)
        if (map.getLayer(FILL)) map.removeLayer(FILL)
        if (map.getSource(SRC)) map.removeSource(SRC)
      } catch {
        /* map removed */
      }
    }
  }, [map, styleVersion])

  useEffect(() => {
    if (!map || styleVersion === 0) return
    const shown = places.filter((p) => p.id !== hiddenId)
    const src = map.getSource(SRC) as GeoJSONSource | undefined
    src?.setData({
      type: 'FeatureCollection',
      features: shown.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [circleRing([p.lng, p.lat], Math.max(10, p.radius || 100))] },
        properties: { color: p.color || placeMeta(p.category).color, sel: p.id === selectedId ? 1 : 0 },
      })),
    })
    markers.current.forEach((m) => m.remove())
    markers.current = shown.map((p) =>
      new maplibregl.Marker({ element: pinEl(p, p.id === selectedId, onSelectRef.current ? () => onSelectRef.current?.(p.id) : undefined), anchor: 'left', offset: [-11, 0] })
        .setLngLat([p.lng, p.lat])
        .addTo(map),
    )
    return () => {
      markers.current.forEach((m) => m.remove())
      markers.current = []
    }
  }, [map, styleVersion, places, selectedId, hiddenId])

  return null
}
