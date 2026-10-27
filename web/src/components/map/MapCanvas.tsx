import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import maplibregl, { type Map as MlMap } from 'maplibre-gl'
import { DEFAULT_CENTER, DEFAULT_ZOOM } from '@/config'
import { useResolvedMapStyle, useUi } from '@/store/ui'
import { cn } from '@/lib/cn'
import { isGoogleBasemap, loadBasemap } from './basemaps'
import { acquireGoogleBase, googleFailed, loadGoogleMaps, onGoogleFailure, releaseGoogleBase, syncGoogleBase } from './googleBase'
import { ensureIcons } from './icons'

interface MapCtx {
  map: MlMap | null
  /** increments on every style (re)load — overlay layers re-add themselves when it changes */
  styleVersion: number
}

const Ctx = createContext<MapCtx>({ map: null, styleVersion: 0 })
export const useMapCtx = () => useContext(Ctx)

export function MapCanvas({
  className,
  children,
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  interactive = true,
  attribution = true,
}: {
  className?: string
  children?: ReactNode
  center?: [number, number]
  zoom?: number
  interactive?: boolean
  attribution?: boolean
}) {
  const el = useRef<HTMLDivElement>(null)
  const gEl = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<MlMap | null>(null)
  const [styleVersion, setStyleVersion] = useState(0)
  const [degraded, setDegraded] = useState(false)
  const wanted = useResolvedMapStyle()
  const googleKey = useUi((s) => s.googleMapsKey)
  const [gFailed, setGFailed] = useState(googleFailed)
  useEffect(() => onGoogleFailure(() => setGFailed(true)), [])
  const basemap = isGoogleBasemap(wanted) && gFailed ? 'streets' : wanted

  // create once
  useEffect(() => {
    if (!el.current) return
    let m: MlMap
    try {
      m = new maplibregl.Map({
        container: el.current,
        style: { version: 8, sources: {}, layers: [] },
        center,
        zoom,
        interactive,
        attributionControl: attribution ? { compact: true } : false,
        fadeDuration: 150,
        maxPitch: 0,
        dragRotate: false,
        pitchWithRotate: false,
      })
    } catch {
      return // WebGL unavailable
    }
    m.touchZoomRotate?.disableRotation()
    const onStyle = () => {
      ensureIcons(m)
      setStyleVersion((v) => v + 1)
    }
    m.on('style.load', onStyle)
    m.on('styleimagemissing', () => ensureIcons(m))
    setMap(m)
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      m.remove()
      setMap(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // basemap switching
  useEffect(() => {
    if (!map) return
    let cancelled = false
    void loadBasemap(basemap).then(({ style, degraded }) => {
      if (cancelled) return
      setDegraded(degraded)
      map.setStyle(style, { diff: false })
    })
    return () => {
      cancelled = true
    }
  }, [map, basemap])

  // Google basemap: a Google map underneath the transparent MapLibre map, following its camera
  useEffect(() => {
    if (!map || !isGoogleBasemap(basemap) || !gEl.current) return
    const parent = gEl.current
    let base: ReturnType<typeof acquireGoogleBase> | null = null
    let cancelled = false
    const sync = () => {
      if (!base) return
      const c = map.getCenter()
      syncGoogleBase(base, c.lng, c.lat, map.getZoom())
    }
    loadGoogleMaps(googleKey)
      .then((gm) => {
        if (cancelled) return
        base = acquireGoogleBase(gm, parent, basemap === 'google' ? 'roadmap' : 'hybrid')
        sync()
      })
      .catch(() => setGFailed(true))
    map.on('move', sync)
    return () => {
      cancelled = true
      map.off('move', sync)
      if (base) releaseGoogleBase(base)
    }
  }, [map, basemap, googleKey])

  return (
    <Ctx.Provider value={{ map, styleVersion }}>
      <div className={cn('overflow-hidden', className ?? 'relative')}>
        <div ref={gEl} className="absolute inset-0" />
        <div ref={el} className="absolute inset-0" />
        {degraded && (
          <div
            title="The basemap CDN could not be reached. Vehicles and routes are still shown."
            className="pointer-events-none absolute left-1/2 top-2 z-[5] hidden -translate-x-1/2 md:block whitespace-nowrap rounded-full bg-black/40 px-2.5 py-0.5 text-[10.5px] font-medium text-white/70 backdrop-blur"
          >
            Basemap unavailable — offline mode
          </div>
        )}
        {children}
      </div>
    </Ctx.Provider>
  )
}
