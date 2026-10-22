import { useEffect } from 'react'
import maplibregl, { type ExpressionSpecification, type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl'
import type { Trip } from '@/api/types'
import { useMapCtx } from '@/components/map/MapCanvas'
import { fmtDuration, fmtShortDateTime } from '@/lib/format'
import { useUi } from '@/store/ui'
import { SPEED_STOPS, stopsFromTrips, type Track } from './track'

const SRC = 'route'
const SRC_PTS = 'route-points'

const speedColor: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['get', 'speed'],
  ...SPEED_STOPS.flatMap(([s, c]) => [s, c]),
] as unknown as ExpressionSpecification

function segments(track: Track): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const ps = track.positions
  const feats: GeoJSON.Feature<GeoJSON.LineString>[] = []
  let cur: { coords: [number, number][]; bucket: number; t0: number; t1: number } | null = null
  for (let i = 1; i < ps.length; i++) {
    const a = ps[i - 1]
    const b = ps[i]
    const speed = (a.speed + b.speed) / 2
    const bucket = Math.round(speed / 5) * 5
    if (cur && cur.bucket === bucket) {
      cur.coords.push([b.lng, b.lat])
      cur.t1 = track.t[i]
    } else {
      if (cur) feats.push(toFeature(cur))
      cur = { coords: [[a.lng, a.lat], [b.lng, b.lat]], bucket, t0: track.t[i - 1], t1: track.t[i] }
    }
  }
  if (cur) feats.push(toFeature(cur))
  return { type: 'FeatureCollection', features: feats }
}

function toFeature(c: { coords: [number, number][]; bucket: number; t0: number; t1: number }): GeoJSON.Feature<GeoJSON.LineString> {
  return { type: 'Feature', geometry: { type: 'LineString', coordinates: c.coords }, properties: { speed: c.bucket, t0: c.t0, t1: c.t1 } }
}

function points(track: Track, trips: Trip[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const ps = track.positions
  const feats: GeoJSON.Feature<GeoJSON.Point>[] = []
  for (const s of stopsFromTrips(trips)) {
    feats.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: { kind: 'stop', icon: 'pin-stop', label: `Stopped ${fmtDuration(s.duration)}`, sub: `${fmtShortDateTime(s.start)} → ${fmtShortDateTime(s.end)}` },
    })
  }
  if (ps.length) {
    const a = ps[0]
    const b = ps[ps.length - 1]
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [a.lng, a.lat] }, properties: { kind: 'start', icon: 'pin-start', label: 'Start', sub: fmtShortDateTime(a.time) } })
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [b.lng, b.lat] }, properties: { kind: 'end', icon: 'pin-end', label: 'End', sub: fmtShortDateTime(b.time) } })
  }
  return { type: 'FeatureCollection', features: feats }
}

export function RouteLayer({ track, trips, highlight }: { track: Track | null; trips: Trip[]; highlight: Trip | null }) {
  const { map, styleVersion } = useMapCtx()
  const theme = useUi((s) => s.theme)

  useEffect(() => {
    if (!map || styleVersion === 0) return
    try {
      if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, lineMetrics: false })
      if (!map.getSource(SRC_PTS)) map.addSource(SRC_PTS, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      const before = map.getLayer('vehicles-icons') ? 'vehicles-icons' : undefined
      if (!map.getLayer('route-casing'))
        map.addLayer(
          {
            id: 'route-casing',
            type: 'line',
            source: SRC,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': theme === 'dark' ? '#020617' : '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 16, 10], 'line-opacity': 0.85 },
          },
          before,
        )
      if (!map.getLayer('route-line'))
        map.addLayer(
          {
            id: 'route-line',
            type: 'line',
            source: SRC,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': speedColor, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 16, 6] },
          },
          before,
        )
      if (!map.getLayer('route-points'))
        map.addLayer({
          id: 'route-points',
          type: 'symbol',
          source: SRC_PTS,
          layout: {
            'icon-image': ['get', 'icon'],
            'icon-allow-overlap': true,
            'symbol-sort-key': ['match', ['get', 'kind'], 'stop', 0, 1],
          },
        })
    } catch {
      return
    }
  }, [map, styleVersion, theme])

  // casing colour follows theme
  useEffect(() => {
    if (map?.getLayer('route-casing')) map.setPaintProperty('route-casing', 'line-color', theme === 'dark' ? '#020617' : '#ffffff')
  }, [map, theme, styleVersion])

  useEffect(() => {
    if (!map || styleVersion === 0) return
    const src = map.getSource(SRC) as GeoJSONSource | undefined
    const pts = map.getSource(SRC_PTS) as GeoJSONSource | undefined
    src?.setData(track ? segments(track) : { type: 'FeatureCollection', features: [] })
    pts?.setData(track ? points(track, trips) : { type: 'FeatureCollection', features: [] })
  }, [map, styleVersion, track, trips])

  // dim everything outside the highlighted trip
  useEffect(() => {
    if (!map || !map.getLayer('route-line')) return
    if (highlight) {
      const a = Date.parse(highlight.start)
      const b = Date.parse(highlight.end)
      const inTrip: ExpressionSpecification = ['all', ['>=', ['get', 't1'], a], ['<=', ['get', 't0'], b]]
      map.setPaintProperty('route-line', 'line-opacity', ['case', inTrip, 1, 0.22])
      map.setPaintProperty('route-casing', 'line-opacity', ['case', inTrip, 0.85, 0.15])
    } else {
      map.setPaintProperty('route-line', 'line-opacity', 1)
      map.setPaintProperty('route-casing', 'line-opacity', 0.85)
    }
  }, [map, styleVersion, highlight, track])

  // hover popups for start/end/stops
  useEffect(() => {
    if (!map) return
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 })
    const enter = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f || f.geometry.type !== 'Point') return
      map.getCanvas().style.cursor = 'pointer'
      const root = document.createElement('div')
      const t = document.createElement('div')
      t.style.cssText = 'font-weight:600;font-size:12.5px'
      t.textContent = String(f.properties?.label ?? '')
      const s = document.createElement('div')
      s.style.cssText = 'font-size:11.5px;opacity:.7;margin-top:1px'
      s.textContent = String(f.properties?.sub ?? '')
      root.append(t, s)
      popup.setLngLat(f.geometry.coordinates as [number, number]).setDOMContent(root).addTo(map)
    }
    const leave = () => {
      map.getCanvas().style.cursor = ''
      popup.remove()
    }
    map.on('mouseenter', 'route-points', enter)
    map.on('mouseleave', 'route-points', leave)
    return () => {
      popup.remove()
      map.off('mouseenter', 'route-points', enter)
      map.off('mouseleave', 'route-points', leave)
    }
  }, [map])

  return null
}
