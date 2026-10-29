import { useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { useDeviceList } from '@/store/live'
import { CategoryIcon } from '@/lib/category'
import { Input } from '@/components/ui/Input'
import { Switch } from '@/components/ui/Switch'
import { cn } from '@/lib/cn'

/** Multi-select of vehicles; `all` = applies to every vehicle (sent as an empty deviceIds list). */
export function VehiclePicker({
  all,
  ids,
  onChange,
  error,
}: {
  all: boolean
  ids: number[]
  onChange: (all: boolean, ids: number[]) => void
  error?: string
}) {
  const devices = useDeviceList()
  const [q, setQ] = useState('')
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? devices.filter((d) => d.name.toLowerCase().includes(s) || d.plate.toLowerCase().includes(s)) : devices
  }, [devices, q])
  const set = new Set(ids)
  const toggle = (id: number) => onChange(false, set.has(id) ? ids.filter((x) => x !== id) : [...ids, id])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200/80 px-3 py-2 dark:border-white/[0.07]">
        <div>
          <p className="text-[12.5px] font-medium text-slate-800 dark:text-slate-100">All vehicles</p>
          <p className="text-[11.5px] text-slate-500 dark:text-slate-400">Including vehicles added later</p>
        </div>
        <Switch checked={all} onChange={(v) => onChange(v, v ? [] : ids)} label="Apply to all vehicles" />
      </div>
      {!all && (
        <div className={cn('overflow-hidden rounded-lg border', error ? 'border-rose-400 dark:border-rose-500/60' : 'border-slate-200/80 dark:border-white/[0.07]')}>
          <div className="flex items-center gap-2 border-b border-slate-200/80 p-1.5 dark:border-white/[0.07]">
            <Input
              icon={<Search className="h-3.5 w-3.5" />}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter vehicles"
              aria-label="Filter vehicles"
              className="flex-1"
            />
            <span className="tabular shrink-0 px-1.5 text-[11.5px] text-slate-500">{ids.length} selected</span>
          </div>
          <ul className="max-h-52 overflow-y-auto p-1" role="listbox" aria-multiselectable="true" aria-label="Vehicles">
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
                    <CategoryIcon category={d.category} icon={d.icon} className="h-3.5 w-3.5 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-800 dark:text-slate-100">{d.name}</span>
                    {d.plate && <span className="shrink-0 text-[11px] text-slate-400">{d.plate}</span>}
                  </button>
                </li>
              )
            })}
            {rows.length === 0 && <li className="px-2 py-3 text-center text-[12px] text-slate-500">No vehicles match</li>}
          </ul>
        </div>
      )}
      {error && <p className="text-[12px] text-rose-500">{error}</p>}
    </div>
  )
}
