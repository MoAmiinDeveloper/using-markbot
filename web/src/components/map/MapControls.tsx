import { useState, type ReactNode } from 'react'
import { Check, Layers, Minus, Plus } from 'lucide-react'
import { useUi, type MapStyleId } from '@/store/ui'
import { cn } from '@/lib/cn'
import { useMapCtx } from './MapCanvas'

const STYLES: Array<{ id: MapStyleId; label: string; swatch: string }> = [
  { id: 'auto', label: 'Default', swatch: 'linear-gradient(135deg,#e5e7eb 50%,#111827 50%)' },
  { id: 'google', label: 'Google Maps', swatch: 'linear-gradient(135deg,#f1f3f4,#aadaff 50%,#fbbc04)' },
  { id: 'googleSatellite', label: 'Google Satellite', swatch: 'linear-gradient(135deg,#2d4a22,#5b6b3a 55%,#fbbc04)' },
  { id: 'streets', label: 'Streets', swatch: 'linear-gradient(135deg,#f8f4ec,#cfe3c4 55%,#f2c46c)' },
  { id: 'osm', label: 'OpenStreetMap', swatch: 'linear-gradient(135deg,#f2efe9,#aad3df 55%,#e8a07a)' },
  { id: 'light', label: 'Light', swatch: 'linear-gradient(135deg,#f3f4f6,#d1d5db)' },
  { id: 'dark', label: 'Dark', swatch: 'linear-gradient(135deg,#1f2937,#030712)' },
  { id: 'satellite', label: 'Satellite', swatch: 'linear-gradient(135deg,#365314,#1e3a8a 60%,#a16207)' },
]

export function ControlGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('glass flex flex-col overflow-hidden rounded-xl', className)}>{children}</div>
}

export function ControlButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string
  onClick: () => void
  active?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'grid h-9 w-9 place-items-center text-slate-600 transition-colors hover:bg-slate-900/5 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white [&+&]:border-t [&+&]:border-slate-200/80 dark:[&+&]:border-white/[0.07]',
        active && '!text-navy-600 dark:!text-brand-300',
      )}
    >
      {children}
    </button>
  )
}

/** Zoom buttons, basemap switcher and optional extra buttons, stacked on the right edge. */
export function MapControls({ children, className }: { children?: ReactNode; className?: string }) {
  const { map } = useMapCtx()
  const { mapStyle, setMapStyle, googleMapsKey } = useUi()
  const styles = STYLES.filter((s) => googleMapsKey || (s.id !== 'google' && s.id !== 'googleSatellite'))
  const [open, setOpen] = useState(false)

  return (
    <div className={cn('pointer-events-auto flex flex-col items-end gap-2', className)}>
      <div className="relative">
        <ControlGroup>
          <ControlButton label="Map style" onClick={() => setOpen((o) => !o)} active={open}>
            <Layers className="h-[17px] w-[17px]" />
          </ControlButton>
        </ControlGroup>
        {open && (
          <div
            role="menu"
            className="glass absolute right-11 top-0 w-44 animate-fade-in rounded-xl p-1.5"
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          >
            {styles.map((s) => (
              <button
                key={s.id}
                role="menuitemradio"
                aria-checked={mapStyle === s.id}
                onClick={() => {
                  setMapStyle(s.id)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-slate-900/5 dark:hover:bg-white/[0.07]"
              >
                <span className="h-5 w-5 rounded-md ring-1 ring-black/10 dark:ring-white/15" style={{ background: s.swatch }} />
                <span className="flex-1">{s.label}</span>
                {mapStyle === s.id && <Check className="h-3.5 w-3.5 text-navy-600" />}
              </button>
            ))}
          </div>
        )}
      </div>
      <ControlGroup>
        <ControlButton label="Zoom in" onClick={() => map?.zoomIn()}>
          <Plus className="h-[17px] w-[17px]" />
        </ControlButton>
        <ControlButton label="Zoom out" onClick={() => map?.zoomOut()}>
          <Minus className="h-[17px] w-[17px]" />
        </ControlButton>
      </ControlGroup>
      {children}
    </div>
  )
}
