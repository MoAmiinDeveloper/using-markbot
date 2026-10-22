import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Maximize, RefreshCw, TriangleAlert } from 'lucide-react'
import type { PaddingOptions } from 'maplibre-gl'
import { MapCanvas, useMapCtx } from '@/components/map/MapCanvas'
import { ControlButton, ControlGroup, MapControls } from '@/components/map/MapControls'
import { VehicleLayer } from '@/components/map/VehicleLayer'
import { DeviceList } from '@/features/live/DeviceList'
import { DeviceDetail } from '@/features/live/DeviceDetail'
import { useDevice, useDeviceList, useLive } from '@/store/live'
import { liveConnection } from '@/store/connection'
import { boundsOf } from '@/lib/geo'
import { useIsDesktop } from '@/lib/useMedia'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { Device } from '@/api/types'

function padding(desktop: boolean, detailOpen: boolean): PaddingOptions {
  return desktop
    ? { top: 60, bottom: 60, left: 380, right: detailOpen ? 460 : 80 }
    : { top: 50, bottom: detailOpen ? 360 : 200, left: 40, right: 60 }
}

/** Imperative camera moves driven by page state. */
function CameraDirector({
  devices,
  selected,
  fitTick,
  desktop,
}: {
  devices: Device[]
  selected: Device | undefined
  fitTick: number
  desktop: boolean
}) {
  const { map } = useMapCtx()
  const didInitialFit = useRef(false)
  const devRef = useRef(devices)
  devRef.current = devices

  const fitAll = useCallback(
    (animate: boolean) => {
      if (!map) return
      const pts = devRef.current.filter((d) => d.position).map((d) => [d.position!.lng, d.position!.lat] as [number, number])
      const b = boundsOf(pts)
      if (!b) return
      map.fitBounds(b, { padding: padding(desktop, !!selected), maxZoom: 14, duration: animate ? 700 : 0 })
    },
    [map, desktop, selected],
  )

  // initial fit once devices arrive
  useEffect(() => {
    if (!map || didInitialFit.current || selected) return
    if (devices.some((d) => d.position)) {
      didInitialFit.current = true
      fitAll(false)
    }
  }, [map, devices, selected, fitAll])

  useEffect(() => {
    if (fitTick > 0) fitAll(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitTick])

  // fly to newly selected vehicle
  const selId = selected?.id
  const hasPos = !!selected?.position
  useEffect(() => {
    if (!map || selId == null || !hasPos) return
    const d = devRef.current.find((x) => x.id === selId)
    if (!d?.position) return
    didInitialFit.current = true
    map.easeTo({
      center: [d.position.lng, d.position.lat],
      zoom: Math.max(map.getZoom(), 14.5),
      padding: padding(desktop, true),
      duration: 800,
    })
  }, [map, selId, hasPos, desktop])

  return null
}

export function LiveMapPage() {
  const devices = useDeviceList()
  const loaded = useLive((s) => s.loaded)
  const error = useLive((s) => s.error)
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('device') ? Number(params.get('device')) : null
  const selected = useDevice(selectedId)
  const [follow, setFollow] = useState(false)
  const [fitTick, setFitTick] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const desktop = useIsDesktop()

  const select = useCallback(
    (id: number | null) => {
      setFollow(false)
      setParams(id == null ? {} : { device: String(id) }, { replace: true })
    },
    [setParams],
  )

  useEffect(() => {
    if (selectedId != null && loaded && !selected) select(null) // deleted / unknown id
  }, [selectedId, loaded, selected, select])

  const showDetail = !!selected

  return (
    <div className="absolute inset-0">
      <MapCanvas className="absolute inset-0">
        <VehicleLayer
          devices={devices}
          selectedId={selectedId}
          followId={follow ? selectedId : null}
          onSelect={(id) => select(id)}
          onFollowCancel={() => setFollow(false)}
        />
        <CameraDirector devices={devices} selected={selected} fitTick={fitTick} desktop={desktop} />

        <div className="pointer-events-none absolute inset-0 z-10">
          {/* vehicle list: floating panel on desktop, bottom sheet on phones */}
          <section
            aria-label="Vehicle list"
            className={cn(
              'glass pointer-events-auto absolute flex flex-col overflow-hidden rounded-2xl transition-[height,transform,opacity] duration-300 ease-out',
              'inset-x-2 bottom-2 md:inset-x-auto md:bottom-3 md:left-3 md:top-3 md:h-auto md:w-[340px] md:translate-y-0 md:opacity-100',
              expanded ? 'h-[68%]' : 'h-[186px]',
              showDetail && 'max-md:pointer-events-none max-md:translate-y-8 max-md:opacity-0',
            )}
          >
            <DeviceList
              devices={devices}
              loaded={loaded}
              selectedId={selectedId}
              onSelect={(id) => {
                select(id)
                setExpanded(false)
              }}
              expanded={expanded}
              onToggleExpanded={() => setExpanded((e) => !e)}
            />
          </section>

          {/* detail panel */}
          {selected && (
            <section
              key={selected.id}
              aria-label={`${selected.name} details`}
              className={cn(
                'glass pointer-events-auto absolute flex flex-col overflow-hidden rounded-2xl',
                'inset-x-2 bottom-2 h-[64%] animate-slide-up',
                'md:inset-x-auto md:bottom-3 md:right-[60px] md:top-3 md:h-auto md:w-[372px] md:animate-slide-in-right',
              )}
            >
              <DeviceDetail
                device={selected}
                following={follow}
                onToggleFollow={() => setFollow((f) => !f)}
                onClose={() => select(null)}
              />
            </section>
          )}

          <MapControls className="absolute right-2 top-2 md:right-3 md:top-3">
            <ControlGroup>
              <ControlButton label="Fit all vehicles" onClick={() => setFitTick((t) => t + 1)}>
                <Maximize className="h-[16px] w-[16px]" />
              </ControlButton>
            </ControlGroup>
          </MapControls>

          {error && !loaded && (
            <div className="glass pointer-events-auto absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-3 rounded-xl px-4 py-2.5 md:top-4">
              <TriangleAlert className="h-4 w-4 text-amber-500" />
              <span className="text-[12.5px]">{error}</span>
              <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => liveConnection.reconnectNow()}>
                Retry
              </Button>
            </div>
          )}
        </div>
      </MapCanvas>
    </div>
  )
}
