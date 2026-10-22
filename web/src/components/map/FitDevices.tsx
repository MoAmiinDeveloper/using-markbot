import { useEffect, useRef } from 'react'
import type { Device } from '@/api/types'
import { boundsOf } from '@/lib/geo'
import { useMapCtx } from './MapCanvas'

/** Fit the camera to all positioned devices once they first become available. */
export function FitDevices({ devices, padding = 40 }: { devices: Device[]; padding?: number }) {
  const { map } = useMapCtx()
  const done = useRef(false)
  useEffect(() => {
    if (!map || done.current) return
    const b = boundsOf(devices.filter((d) => d.position).map((d) => [d.position!.lng, d.position!.lat]))
    if (!b) return
    done.current = true
    map.fitBounds(b, { padding, maxZoom: 13, duration: 0 })
  }, [map, devices, padding])
  return null
}
