import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, Truck } from 'lucide-react'
import type { Device } from '@/api/types'
import { useDeviceList } from '@/store/live'
import { CategoryIcon } from '@/lib/category'
import { StatusDot } from '@/components/ui/Misc'
import { cn } from '@/lib/cn'

/** Checklist of vehicles (used inline in drawers). */
export function DeviceChecklist({
  value,
  onChange,
  devices: list,
  className,
  maxHeight = 'max-h-56',
}: {
  value: number[]
  onChange: (ids: number[]) => void
  devices?: Device[]
  className?: string
  maxHeight?: string
}) {
  const all = useDeviceList()
  const devices = list ?? all
  const [q, setQ] = useState('')
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? devices.filter((d) => d.name.toLowerCase().includes(s) || d.plate.toLowerCase().includes(s)) : devices
  }, [devices, q])
  const set = new Set(value)
  const toggle = (id: number) => onChange(set.has(id) ? value.filter((x) => x !== id) : [...value, id])
  const allShown = rows.length > 0 && rows.every((d) => set.has(d.id))

  return (
    <div className={cn('overflow-hidden rounded-lg border border-slate-200/80 dark:border-white/[0.08]', className)}>
      <div className="flex items-center gap-2 border-b border-slate-200/80 p-1.5 dark:border-white/[0.07]">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter vehicles"
            aria-label="Filter vehicles"
            className="h-8 w-full rounded-md bg-transparent pl-8 pr-2 text-[12.5px] text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-white"
          />
        </div>
        <button
          type="button"
          onClick={() =>
            onChange(allShown ? value.filter((id) => !rows.some((d) => d.id === id)) : [...new Set([...value, ...rows.map((d) => d.id)])])
          }
          className="shrink-0 rounded-md px-2 py-1 text-[11.5px] font-medium text-navy-600 hover:bg-slate-900/5 dark:text-brand-300 dark:hover:bg-white/[0.06]"
        >
          {allShown ? 'Clear' : 'Select all'}
        </button>
      </div>
      <ul className={cn('overflow-y-auto p-1', maxHeight)} role="listbox" aria-multiselectable="true" aria-label="Vehicles">
        {rows.map((d) => {
          const on = set.has(d.id)
          return (
            <li key={d.id}>
              <button
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggle(d.id)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-slate-900/[0.04] dark:hover:bg-white/[0.05]"
              >
                <span
                  className={cn(
                    'grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors',
                    on ? 'border-brand-500 bg-brand-500 text-navy-900' : 'border-slate-300 dark:border-white/20',
                  )}
                >
                  {on && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <CategoryIcon category={d.category} className="h-3.5 w-3.5 text-slate-400" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-800 dark:text-slate-100">{d.name}</span>
                {d.plate && <span className="shrink-0 text-[11px] text-slate-400">{d.plate}</span>}
                <StatusDot status={d.status} />
              </button>
            </li>
          )
        })}
        {rows.length === 0 && <li className="px-2 py-3 text-center text-[12px] text-slate-500">No vehicles match</li>}
      </ul>
    </div>
  )
}

/** Compact filter button + popover; an empty selection means "all vehicles". */
export function DeviceMultiSelect({
  value,
  onChange,
  className,
}: {
  value: number[]
  onChange: (ids: number[]) => void
  className?: string
}) {
  const devices = useDeviceList()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const known = value.filter((id) => devices.some((d) => d.id === id))
  const label =
    known.length === 0
      ? 'All vehicles'
      : known.length === 1
        ? (devices.find((d) => d.id === known[0])?.name ?? '1 vehicle')
        : `${known.length} vehicles`
  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-lg border bg-white pl-3 pr-2.5 text-left text-[13px] shadow-soft transition-colors dark:bg-white/[0.03]',
          open ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-slate-200 dark:border-white/10',
        )}
      >
        <Truck className="h-4 w-4 shrink-0 text-slate-400" />
        <span className={cn('min-w-0 flex-1 truncate', known.length ? 'font-medium text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-200')}>
          {label}
        </span>
        {known.length > 1 && (
          <span className="tabular rounded-md bg-brand-500 px-1.5 text-[10.5px] font-semibold text-navy-900">{known.length}</span>
        )}
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="glass absolute left-0 top-11 z-40 w-[min(320px,calc(100vw-24px))] animate-fade-in rounded-xl p-1.5">
          <DeviceChecklist value={known} onChange={onChange} className="border-0" maxHeight="max-h-72" />
          <div className="flex items-center justify-between border-t border-slate-200/80 px-2 pb-0.5 pt-2 dark:border-white/[0.07]">
            <span className="text-[11.5px] text-slate-500">{known.length ? `${known.length} selected` : 'Empty = all vehicles'}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md bg-brand-500 px-2.5 py-1 text-[12px] font-semibold text-navy-900 hover:bg-brand-400"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
