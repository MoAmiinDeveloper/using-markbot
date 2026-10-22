import type { LngLatBoundsLike } from 'maplibre-gl'

const R = 6371008.8
const rad = (d: number) => (d * Math.PI) / 180

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2))
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Interpolate angles along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180
  return (a + d * t + 360) % 360
}

export function boundsOf(points: Array<[number, number]>): LngLatBoundsLike | null {
  if (points.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return [
    [minX, minY],
    [maxX, maxY],
  ]
}

/** Destination point given start, distance (m) and bearing (deg). Returns [lng, lat]. */
export function destination(lng: number, lat: number, meters: number, brg: number): [number, number] {
  const d = meters / R
  const b = rad(brg)
  const φ1 = rad(lat)
  const λ1 = rad(lng)
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(b))
  const λ2 = λ1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2))
  return [(((λ2 * 180) / Math.PI + 540) % 360) - 180, (φ2 * 180) / Math.PI]
}

/** Approximate a geodesic circle as a closed polygon ring of [lng, lat]. */
export function circleRing(center: [number, number], radius: number, steps = 72): Array<[number, number]> {
  const ring: Array<[number, number]> = []
  for (let i = 0; i < steps; i++) ring.push(destination(center[0], center[1], radius, (i * 360) / steps))
  ring.push(ring[0])
  return ring
}

/** Area of a (non-closed) [lng, lat] ring in m² (spherical excess approximation, fine for geofences). */
export function ringArea(ring: Array<[number, number]>): number {
  if (ring.length < 3) return 0
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % ring.length]
    sum += rad(x2 - x1) * (2 + Math.sin(rad(y1)) + Math.sin(rad(y2)))
  }
  return Math.abs((sum * R * R) / 2)
}

/** Simple vertex-average centroid (good enough for label placement on compact shapes). */
export function ringCentroid(ring: Array<[number, number]>): [number, number] {
  let x = 0
  let y = 0
  for (const [a, b] of ring) {
    x += a
    y += b
  }
  return [x / ring.length, y / ring.length]
}

export function fmtArea(m2: number): string {
  if (m2 < 10_000) return `${Math.round(m2).toLocaleString()} m²`
  if (m2 < 1_000_000) return `${(m2 / 10_000).toFixed(1)} ha`
  return `${(m2 / 1_000_000).toFixed(m2 < 10_000_000 ? 2 : 1)} km²`
}
