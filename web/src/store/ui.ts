import { create } from 'zustand'
import { readLS, writeLS } from '@/lib/storage'

export type Theme = 'dark' | 'light'
export type MapStyleId = 'auto' | 'google' | 'googleSatellite' | 'streets' | 'osm' | 'light' | 'dark' | 'satellite'

function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.classList.add('theme-transition')
  root.classList.toggle('dark', theme === 'dark')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#222d5d' : '#222d5d')
  window.setTimeout(() => root.classList.remove('theme-transition'), 250)
}

interface UiState {
  theme: Theme
  mapStyle: MapStyleId
  /** Google Maps key from server settings ('' when not configured) */
  googleMapsKey: string
  setGoogleMapsKey: (k: string) => void
  /** geofence overlay on the Live Map */
  showGeofences: boolean
  /** places (POI) overlay on the Live Map */
  showPlaces: boolean
  togglePlaces: () => void
  /** planned routes overlay on the Live Map (Phase 4a) */
  showRoutes: boolean
  toggleRoutes: () => void
  toggleTheme: () => void
  toggleGeofences: () => void
  setMapStyle: (s: MapStyleId) => void
}

// Light by default (the reference design); dark stays one click away.
const initialTheme: Theme = readLS('fleet.theme') === 'dark' ? 'dark' : 'light'
const storedStyle = readLS('fleet.mapStyle')
const initialStyle: MapStyleId =
  storedStyle === 'google' || storedStyle === 'googleSatellite' || storedStyle === 'streets' || storedStyle === 'osm' || storedStyle === 'light' || storedStyle === 'dark' || storedStyle === 'satellite'
    ? storedStyle
    : 'auto'

export const useUi = create<UiState>((set, get) => ({
  theme: initialTheme,
  mapStyle: initialStyle,
  googleMapsKey: '',
  setGoogleMapsKey: (googleMapsKey) => set({ googleMapsKey }),
  showGeofences: readLS('fleet.showGeofences') !== '0',
  showPlaces: readLS('fleet.showPlaces') === '1',
  showRoutes: readLS('fleet.showRoutes') === '1',
  toggleRoutes: () => {
    const showRoutes = !get().showRoutes
    writeLS('fleet.showRoutes', showRoutes ? '1' : '0')
    set({ showRoutes })
  },
  togglePlaces: () => {
    const showPlaces = !get().showPlaces
    writeLS('fleet.showPlaces', showPlaces ? '1' : '0')
    set({ showPlaces })
  },
  toggleTheme: () => {
    const theme: Theme = get().theme === 'dark' ? 'light' : 'dark'
    writeLS('fleet.theme', theme)
    applyTheme(theme)
    set({ theme })
  },
  toggleGeofences: () => {
    const showGeofences = !get().showGeofences
    writeLS('fleet.showGeofences', showGeofences ? '1' : '0')
    set({ showGeofences })
  },
  setMapStyle: (mapStyle) => {
    writeLS('fleet.mapStyle', mapStyle)
    set({ mapStyle })
  },
}))

/** Resolve 'auto' to the theme's matching basemap. */
export function useResolvedMapStyle(): Exclude<MapStyleId, 'auto'> {
  const { mapStyle, googleMapsKey } = useUi()
  // Default: Google roadmap when a key is configured, else the OpenStreetMap-based
  // street map. Both carry far more local place and street names (e.g. across
  // Somalia/Somaliland) than the minimal light/dark styles.
  if (mapStyle === 'auto') return googleMapsKey ? 'google' : 'streets'
  if ((mapStyle === 'google' || mapStyle === 'googleSatellite') && !googleMapsKey) return 'streets'
  return mapStyle
}
