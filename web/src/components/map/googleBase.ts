/**
 * Google basemap through the Maps JavaScript API. A Google map is drawn underneath the
 * (transparent) MapLibre map and follows its camera, so every overlay layer keeps working.
 * Google bills per map created, so map instances are pooled and reused across pages.
 */

// Minimal typing of the parts of google.maps we use.
interface GMap {
  moveCamera(c: { center: { lat: number; lng: number }; zoom: number }): void
  setMapTypeId(id: string): void
}
interface GMaps {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => GMap
}
declare global {
  interface Window {
    google?: { maps: GMaps }
    gm_authFailure?: () => void
    __somtelGoogleReady?: () => void
  }
}

export type GoogleMapType = 'roadmap' | 'hybrid'

let loading: Promise<GMaps> | null = null
let loadedKey = ''
let failed = false
const failListeners = new Set<() => void>()

/** Called when Google rejects the key (not enabled, wrong key, quota used up). */
export function onGoogleFailure(fn: () => void): () => void {
  failListeners.add(fn)
  return () => failListeners.delete(fn)
}

export const googleFailed = () => failed

function fail(why: unknown) {
  if (failed) return
  failed = true
  console.warn('Google Maps unavailable, using Streets:', why)
  failListeners.forEach((fn) => fn())
}

export function loadGoogleMaps(key: string): Promise<GMaps> {
  if (loading && loadedKey === key) return loading
  // The script can only be loaded once per page; a new key needs a reload.
  if (loading) return Promise.reject(new Error('Google Maps key changed — reload the page'))
  loadedKey = key
  loading = new Promise<GMaps>((resolve, reject) => {
    window.gm_authFailure = () => fail('the API key was refused (enable "Maps JavaScript API" for it)')
    window.__somtelGoogleReady = () => (window.google ? resolve(window.google.maps) : reject(new Error('no google.maps')))
    const s = document.createElement('script')
    s.src =
      'https://maps.googleapis.com/maps/api/js?' +
      new URLSearchParams({ key, v: 'weekly', loading: 'async', callback: '__somtelGoogleReady', region: 'SO', language: 'en' }).toString()
    s.async = true
    s.onerror = () => reject(new Error('Google Maps script could not be loaded'))
    document.head.appendChild(s)
  })
  loading.catch(fail)
  return loading
}

export interface GoogleBase {
  div: HTMLDivElement
  map: GMap
}

const pool: GoogleBase[] = []

/** Get a Google map attached to `parent` (reusing a released one when possible). */
export function acquireGoogleBase(gm: GMaps, parent: HTMLElement, type: GoogleMapType): GoogleBase {
  let b = pool.pop()
  if (b) {
    parent.appendChild(b.div)
    b.map.setMapTypeId(type)
    return b
  }
  const div = document.createElement('div')
  div.style.cssText = 'position:absolute;inset:0;pointer-events:none'
  parent.appendChild(div)
  const map = new gm.Map(div, {
    center: { lat: 0, lng: 0 },
    zoom: 2,
    mapTypeId: type,
    disableDefaultUI: true,
    gestureHandling: 'none',
    keyboardShortcuts: false,
    clickableIcons: false,
    isFractionalZoomEnabled: true,
    backgroundColor: type === 'roadmap' ? '#f1f3f4' : '#0b0f14',
  })
  return { div, map }
}

export function releaseGoogleBase(b: GoogleBase) {
  b.div.remove()
  pool.push(b)
}

/** MapLibre uses 512px tiles, Google 256px: Google zoom = MapLibre zoom + 1. */
export function syncGoogleBase(b: GoogleBase, lng: number, lat: number, zoom: number) {
  b.map.moveCamera({ center: { lat, lng }, zoom: zoom + 1 })
}
