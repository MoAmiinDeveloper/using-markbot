import type { Geofence } from '@/api/types'
import { circleRing, fmtArea, ringArea, ringCentroid } from '@/lib/geo'
import { fmtDistance } from '@/lib/format'

export const GEOFENCE_COLORS = ['#3b6af8', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#06b6d4', '#ec4899', '#64748b']

/** A geofence's closed outer ring as [lng, lat][] (circles are approximated). */
export function geofenceRing(g: Pick<Geofence, 'type' | 'center' | 'radius' | 'polygon'>): Array<[number, number]> | null {
  if (g.type === 'circle') {
    if (!g.center || !g.radius) return null
    return circleRing(g.center, g.radius)
  }
  const p = g.polygon
  if (!p || p.length < 3) return null
  return [...p, p[0]]
}

export function geofenceAnchor(g: Pick<Geofence, 'type' | 'center' | 'polygon'>): [number, number] | null {
  if (g.type === 'circle') return g.center ?? null
  return g.polygon && g.polygon.length ? ringCentroid(g.polygon) : null
}

export function geofenceSize(g: Pick<Geofence, 'type' | 'radius' | 'polygon'>): string {
  if (g.type === 'circle') return g.radius ? `r ${fmtDistance(g.radius)}` : '—'
  return g.polygon ? fmtArea(ringArea(g.polygon)) : '—'
}

export function geofenceFeature(g: Geofence, selected = false): GeoJSON.Feature<GeoJSON.Polygon> | null {
  const ring = geofenceRing(g)
  if (!ring) return null
  return {
    type: 'Feature',
    id: g.id,
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: { id: g.id, color: g.color || GEOFENCE_COLORS[0], selected: selected ? 1 : 0 },
  }
}

export function geofencesBounds(gs: Geofence[]): [[number, number], [number, number]] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const g of gs) {
    const ring = geofenceRing(g)
    if (!ring) continue
    for (const [x, y] of ring) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  return Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : null
}
