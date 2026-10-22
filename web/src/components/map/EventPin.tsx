import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { useMapCtx } from './MapCanvas'

/** Pulsing pin marking where an alert happened. */
export function EventPin({ lng, lat, color, title }: { lng: number; lat: number; color: string; title?: string }) {
  const { map } = useMapCtx()
  useEffect(() => {
    if (!map) return
    const el = document.createElement('div')
    el.className = 'event-pin'
    el.style.setProperty('--pin', color)
    if (title) el.title = title
    el.appendChild(document.createElement('span'))
    const m = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)
    return () => {
      m.remove()
    }
  }, [map, lng, lat, color, title])
  return null
}
