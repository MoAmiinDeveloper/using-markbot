import { useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Crosshair, GripVertical, LocateFixed, MapPin, MousePointerClick, Search, Trash2 } from 'lucide-react'
import { api } from '@/api/client'
import type { Place } from '@/api/types'
import { IconButton } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { placeMeta } from '@/lib/ops'
import { cn } from '@/lib/cn'

export interface DraftStop {
  key: string
  id?: number
  name: string
  address: string
  lat: number
  lng: number
  radius: number
  notes: string
  status?: string
}

let seq = 0
export const newKey = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`

const COORD_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/

/** Reverse-geocode a new stop in the background (fills address / place name). */
export async function enrichStop(s: DraftStop): Promise<Partial<DraftStop>> {
  try {
    const g = await api.geocode(s.lat, s.lng)
    return { address: g.address, ...(g.place && /^Stop \d+$/.test(s.name) ? { name: g.place.name } : {}) }
  } catch {
    return {}
  }
}

export function StopSearch({ places, onAdd, onPickMode, picking }: { places: Place[]; onAdd: (s: Omit<DraftStop, 'key'>) => void; onPickMode: () => void; picking: boolean }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLInputElement>(null)
  const s = q.trim().toLowerCase()
  const coord = COORD_RE.exec(q)
  const hits = useMemo(() => {
    const list: Array<{ key: string; title: string; sub: string; color: string; make: () => Omit<DraftStop, 'key'> }> = []
    if (coord) {
      const lat = Number(coord[1])
      const lng = Number(coord[2])
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180)
        list.push({ key: 'coord', title: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, sub: 'Coordinates (lat, lng)', color: '#222d5d', make: () => ({ name: '', address: '', lat, lng, radius: 150, notes: '' }) })
    }
    for (const p of places)
      if (!s || p.name.toLowerCase().includes(s) || p.category.includes(s))
        list.push({
          key: `p${p.id}`,
          title: p.name,
          sub: `${placeMeta(p.category).label} · r ${p.radius} m`,
          color: p.color || placeMeta(p.category).color,
          make: () => ({ name: p.name, address: '', lat: p.lat, lng: p.lng, radius: p.radius || 150, notes: '' }),
        })
    return list.slice(0, 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, s, q])

  const pick = (i: number) => {
    const h = hits[i]
    if (!h) return
    onAdd(h.make())
    setQ('')
    setOpen(false)
  }

  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <Input
          ref={ref}
          icon={<Search className="h-4 w-4" />}
          value={q}
          placeholder="Add stop: search places or paste “2.0469, 45.3182”"
          aria-label="Add a stop"
          role="combobox"
          aria-expanded={open && hits.length > 0}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(hits.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              pick(active)
            }
          }}
        />
        {open && hits.length > 0 && (
          <ul role="listbox" className="glass absolute left-0 right-0 top-10 z-30 max-h-64 animate-fade-in overflow-y-auto rounded-xl p-1">
            {hits.map((h, i) => (
              <li key={h.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(i)}
                  className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left', i === active && 'bg-slate-900/5 dark:bg-white/[0.07]')}
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-white" style={{ background: h.color }}>
                    {h.key === 'coord' ? <LocateFixed className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-slate-900 dark:text-white">{h.title}</span>
                    <span className="block truncate text-[11px] text-slate-500">{h.sub}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        onClick={onPickMode}
        aria-pressed={picking}
        title="Click on the map to add stops"
        className={cn(
          'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium transition-colors',
          picking
            ? 'border-brand-500 bg-brand-500 text-navy-900'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200',
        )}
      >
        <MousePointerClick className="h-4 w-4" />
        <span className="hidden sm:inline">Pick on map</span>
      </button>
    </div>
  )
}

export function StopsList({
  stops,
  onChange,
  selected,
  onSelect,
  error,
}: {
  stops: DraftStop[]
  onChange: (s: DraftStop[]) => void
  selected: number | null
  onSelect: (i: number | null) => void
  error?: string
}) {
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= stops.length) return
    const next = stops.slice()
    const [x] = next.splice(from, 1)
    next.splice(to, 0, x)
    onChange(next)
    onSelect(to)
  }
  const patch = (i: number, p: Partial<DraftStop>) => onChange(stops.map((s, k) => (k === i ? { ...s, ...p } : s)))

  if (!stops.length)
    return (
      <div className={cn('flex gap-3 rounded-xl border border-dashed px-3 py-4', error ? 'border-rose-400' : 'border-brand-500/50 bg-brand-500/[0.04]')}>
        <Crosshair className="mt-0.5 h-4 w-4 shrink-0 text-navy-600 dark:text-brand-300" />
        <div className="text-[12.5px] text-slate-600 dark:text-slate-300">
          <p className="font-medium text-slate-900 dark:text-white">Add the first stop</p>
          <p className="mt-0.5">Search a saved place, paste coordinates, or click on the map. Stops are visited in order — drag to reorder.</p>
          {error && <p className="mt-1 font-medium text-rose-500">{error}</p>}
        </div>
      </div>
    )

  return (
    <ol className="space-y-1.5" aria-label="Stops">
      {stops.map((s, i) => (
        <li
          key={s.key}
          draggable
          onDragStart={(e) => {
            setDrag(i)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(i)
          }}
          onDragLeave={() => setOver((o) => (o === i ? null : o))}
          onDrop={(e) => {
            e.preventDefault()
            if (drag != null) move(drag, i)
            setDrag(null)
            setOver(null)
          }}
          onDragEnd={() => {
            setDrag(null)
            setOver(null)
          }}
          onClick={() => onSelect(i)}
          className={cn(
            'group rounded-xl border bg-white p-2 transition-colors dark:bg-ink-850',
            selected === i ? 'border-brand-500 ring-1 ring-brand-500/40' : 'border-slate-200/90 dark:border-white/[0.07]',
            drag === i && 'opacity-50',
            over === i && drag != null && drag !== i && 'border-t-[3px] border-t-brand-500',
          )}
        >
          <div className="flex items-center gap-1.5">
            <span className="cursor-grab text-slate-300 active:cursor-grabbing dark:text-slate-600" title="Drag to reorder">
              <GripVertical className="h-4 w-4" />
            </span>
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-navy-700 text-[11px] font-bold text-brand-400 dark:bg-brand-500 dark:text-navy-900">{i + 1}</span>
            <input
              value={s.name}
              onChange={(e) => patch(i, { name: e.target.value })}
              placeholder={`Stop ${i + 1} name`}
              aria-label={`Stop ${i + 1} name`}
              className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 text-[13px] font-medium text-slate-900 hover:border-slate-200 focus:border-brand-500 focus:outline-none dark:text-white dark:hover:border-white/10"
            />
            <span className="flex shrink-0 opacity-60 transition-opacity group-hover:opacity-100">
              <IconButton size="sm" label="Move up" disabled={i === 0} onClick={(e) => (e.stopPropagation(), move(i, i - 1))}>
                <ArrowUp className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton size="sm" label="Move down" disabled={i === stops.length - 1} onClick={(e) => (e.stopPropagation(), move(i, i + 1))}>
                <ArrowDown className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                size="sm"
                label={`Remove stop ${i + 1}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onChange(stops.filter((_, k) => k !== i))
                  onSelect(null)
                }}
                className="hover:!bg-rose-500/10 hover:!text-rose-500"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </IconButton>
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 pl-[52px] text-[11.5px] text-slate-500 dark:text-slate-400">
            <span className="min-w-0 flex-1 truncate" title={s.address}>
              {s.address || <span className="tabular font-mono">{`${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`}</span>}
            </span>
            <label className="flex shrink-0 items-center gap-1">
              <span>r</span>
              <input
                type="number"
                min={20}
                max={5000}
                step={10}
                value={s.radius}
                aria-label={`Stop ${i + 1} radius in metres`}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => patch(i, { radius: Math.max(0, Number(e.target.value) || 0) })}
                className="tabular h-6 w-16 rounded-md border border-slate-200 bg-white px-1.5 text-right text-[11.5px] text-slate-800 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100"
              />
              <span>m</span>
            </label>
          </div>
          {selected === i && (
            <input
              value={s.notes}
              onChange={(e) => patch(i, { notes: e.target.value })}
              placeholder="Instructions for the driver (gate code, contact…)"
              aria-label={`Stop ${i + 1} notes`}
              className="mt-1.5 h-8 w-full rounded-md border border-slate-200 bg-slate-50 px-2 text-[12px] text-slate-800 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-100"
            />
          )}
        </li>
      ))}
    </ol>
  )
}
