import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useDeviceList } from '@/store/live'
import { CategoryIcon } from '@/lib/category'
import { StatusPill, Kbd } from '@/components/ui/Misc'
import { cn } from '@/lib/cn'

export function GlobalSearch({ className }: { className?: string }) {
  const devices = useDeviceList()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const wrap = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return devices
      .filter((d) => d.name.toLowerCase().includes(s) || d.plate.toLowerCase().includes(s) || d.imei.includes(s))
      .slice(0, 8)
  }, [devices, q])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) {
        e.preventDefault()
        input.current?.focus()
      }
    }
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [])

  const go = (id: number) => {
    nav(`/live?device=${id}`)
    setQ('')
    setOpen(false)
    input.current?.blur()
  }

  return (
    <div ref={wrap} className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={input}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(results.length - 1, a + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(0, a - 1))
          } else if (e.key === 'Enter' && results[active]) go(results[active].id)
          else if (e.key === 'Escape') {
            setOpen(false)
            input.current?.blur()
          }
        }}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="global-search-results"
        aria-label="Search vehicles"
        placeholder="Search vehicles…"
        className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-10 text-[13px] text-slate-900 placeholder:text-slate-400 transition-colors focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white dark:placeholder:text-slate-500 dark:focus:border-brand-400 dark:focus:bg-white/[0.06]"
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 sm:block">
        <Kbd>/</Kbd>
      </span>
      {open && q.trim() && (
        <div
          id="global-search-results"
          role="listbox"
          className="glass absolute left-0 right-0 top-11 z-50 animate-fade-in overflow-hidden rounded-xl p-1.5"
        >
          {results.length === 0 ? (
            <p className="px-3 py-4 text-center text-[12.5px] text-slate-500">No vehicles match “{q}”</p>
          ) : (
            results.map((d, i) => (
              <button
                key={d.id}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(d.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left',
                  i === active && 'bg-slate-900/5 dark:bg-white/[0.07]',
                )}
              >
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-300">
                  <CategoryIcon category={d.category} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-900 dark:text-white">{d.name}</span>
                  <span className="block truncate text-[12px] text-slate-500">{d.plate || d.imei}</span>
                </span>
                <StatusPill status={d.status} />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
