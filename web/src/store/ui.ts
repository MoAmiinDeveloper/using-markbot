import { create } from 'zustand'
import { readLS, writeLS } from '@/lib/storage'

export type Theme = 'dark' | 'light'
export type MapStyleId = 'auto' | 'light' | 'dark' | 'satellite'

function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.classList.add('theme-transition')
  root.classList.toggle('dark', theme === 'dark')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b0e15' : '#f8fafc')
  window.setTimeout(() => root.classList.remove('theme-transition'), 250)
}

interface UiState {
  theme: Theme
  mapStyle: MapStyleId
  toggleTheme: () => void
  setMapStyle: (s: MapStyleId) => void
}

const initialTheme: Theme = readLS('fleet.theme') === 'light' ? 'light' : 'dark'
const storedStyle = readLS('fleet.mapStyle')
const initialStyle: MapStyleId =
  storedStyle === 'light' || storedStyle === 'dark' || storedStyle === 'satellite' ? storedStyle : 'auto'

export const useUi = create<UiState>((set, get) => ({
  theme: initialTheme,
  mapStyle: initialStyle,
  toggleTheme: () => {
    const theme: Theme = get().theme === 'dark' ? 'light' : 'dark'
    writeLS('fleet.theme', theme)
    applyTheme(theme)
    set({ theme })
  },
  setMapStyle: (mapStyle) => {
    writeLS('fleet.mapStyle', mapStyle)
    set({ mapStyle })
  },
}))

/** Resolve 'auto' to the theme's matching basemap. */
export function useResolvedMapStyle(): Exclude<MapStyleId, 'auto'> {
  const { theme, mapStyle } = useUi()
  return mapStyle === 'auto' ? theme : mapStyle
}
