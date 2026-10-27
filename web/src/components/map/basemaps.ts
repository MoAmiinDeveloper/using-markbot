import type { StyleSpecification } from 'maplibre-gl'

export type BasemapId = 'google' | 'googleSatellite' | 'streets' | 'osm' | 'light' | 'dark' | 'satellite'

export const BASEMAPS: Record<BasemapId, { label: string; url?: string; bg: string }> = {
  // OpenFreeMap (free, no key): full OpenStreetMap labels incl. local Somali names.
  streets: { label: 'Streets', url: 'https://tiles.openfreemap.org/styles/liberty', bg: '#f8f4f0' },
  osm: { label: 'OpenStreetMap', bg: '#f2efe9' },
  // Google Map Tiles API (needs a key with "Map Tiles API" enabled)
  google: { label: 'Google Maps', bg: '#f1f3f4' },
  googleSatellite: { label: 'Google Satellite', bg: '#0b0f14' },
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
      // place names and boundaries on top of the imagery (hybrid view)
      'esri-labels': {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': BASEMAPS.satellite.bg } },
      { id: 'esri', type: 'raster', source: 'esri' },
      { id: 'esri-labels', type: 'raster', source: 'esri-labels' },
    ],
  }
}

function osmStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': BASEMAPS.osm.bg } },
      { id: 'osm', type: 'raster', source: 'osm' },
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

const cache = new Map<string, Promise<LoadedBasemap>>()

/**
 * Google basemap through the official Map Tiles API: a session token is created
 * for the map type, then raster tiles are fetched with it. Falls back to the
 * OpenStreetMap street map if the key is invalid or the API is not enabled.
 */
async function googleStyle(id: 'google' | 'googleSatellite', key: string): Promise<LoadedBasemap> {
  const body =
    id === 'google'
      ? { mapType: 'roadmap', language: 'en-US', region: 'SO' }
      : { mapType: 'satellite', language: 'en-US', region: 'SO', layerTypes: ['layerRoadmap'] }
  const r = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`Google Map Tiles: HTTP ${r.status}`)
  const { session } = (await r.json()) as { session: string }
  const year = new Date().getFullYear()
  return {
    degraded: false,
    style: {
      version: 8,
      sources: {
        google: {
          type: 'raster',
          tiles: [`https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(key)}`],
          tileSize: 256,
          maxzoom: 22,
          attribution: `Map data &copy;${year} Google`,
        },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': BASEMAPS[id].bg } },
        { id: 'google', type: 'raster', source: 'google' },
      ],
    },
  }
}

/**
 * Resolve a basemap to a style object. Vector styles are fetched up front so that a
 * blocked/unreachable CDN degrades to a plain background instead of a blank map with
 * no overlay layers.
 */
export function loadBasemap(id: BasemapId, googleKey = ''): Promise<LoadedBasemap> {
  const cacheKey = id === 'google' || id === 'googleSatellite' ? `${id}:${googleKey}` : id
  const hit = cache.get(cacheKey)
  if (hit) return hit
  if (id === 'google' || id === 'googleSatellite') {
    const p = googleStyle(id, googleKey).catch((e: unknown) => {
      console.warn('Google basemap unavailable, using Streets:', e)
      cache.delete(cacheKey)
      return loadBasemap('streets')
    })
    cache.set(cacheKey, p)
    return p
  }
  const url = BASEMAPS[id].url
  if (!url) {
    const p = Promise.resolve({ style: id === 'osm' ? osmStyle() : satelliteStyle(), degraded: false })
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
