import type { StyleSpecification } from 'maplibre-gl'

export type BasemapId = 'light' | 'dark' | 'satellite'

export const BASEMAPS: Record<BasemapId, { label: string; url?: string; bg: string }> = {
  light: { label: 'Light', url: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json', bg: '#eef0f3' },
  dark: { label: 'Dark', url: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json', bg: '#0e1117' },
  satellite: { label: 'Satellite', bg: '#0b0f14' },
}

function satelliteStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      esri: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': BASEMAPS.satellite.bg } },
      { id: 'esri', type: 'raster', source: 'esri' },
    ],
  }
}

/** Minimal style used when the vector basemap can't be fetched (offline / blocked CDN). */
function fallbackStyle(id: BasemapId): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': BASEMAPS[id].bg } }],
  }
}

export interface LoadedBasemap {
  style: StyleSpecification
  /** true when the CDN style could not be fetched and a plain background is used */
  degraded: boolean
}

const cache = new Map<BasemapId, Promise<LoadedBasemap>>()

/**
 * Resolve a basemap to a style object. Vector styles are fetched up front so that a
 * blocked/unreachable CDN degrades to a plain background instead of a blank map with
 * no overlay layers.
 */
export function loadBasemap(id: BasemapId): Promise<LoadedBasemap> {
  const hit = cache.get(id)
  if (hit) return hit
  const url = BASEMAPS[id].url
  if (!url) {
    const p = Promise.resolve({ style: satelliteStyle(), degraded: false })
    cache.set(id, p)
    return p
  }
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 6000)
  const p = fetch(url, { signal: ctrl.signal })
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status))
      return r.json() as Promise<StyleSpecification>
    })
    .then((style) => ({ style, degraded: false }))
    .catch(() => {
      cache.delete(id) // retry on next switch
      return { style: fallbackStyle(id), degraded: true }
    })
    .finally(() => window.clearTimeout(timer))
  cache.set(id, p)
  return p
}
