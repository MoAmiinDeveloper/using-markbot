import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, Search } from 'lucide-react'
import { useDeviceList } from '@/store/live'
import { CategoryIcon } from '@/lib/category'
import { StatusPill, Kbd } from '@/components/ui/Misc'
import { REPORTS } from '@/features/reports/catalog'
import { cn } from '@/lib/cn'
import { useNav, useSubScreens } from './nav'

interface Hit {
  key: string
  kind: 'Screens' | 'Reports' | 'Vehicles'
  to: string
  title: string
  subtitle: string
  icon: ReactNode
  right?: ReactNode
}

const match = (s: string, ...fields: Array<string | undefined>) => fields.some((f) => f?.toLowerCase().includes(s))

/** Quick search for vehicles, reports and screens (Trakzee-style). */
export function GlobalSearch({ className }: { className?: string }) {
  const devices = useDeviceList()
  const nav = useNav()
  const subs = useSubScreens()
  const go = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const wrap = useRef<HTMLDivElement>(null)

  const results = useMemo<Hit[]>(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    const screens: Hit[] = [...nav, ...subs]
      .filter((n) => match(s, n.label, n.keywords))
      .slice(0, 5)
      .map((n) => ({
        key: `s${n.to}`,
        kind: 'Screens',
        to: n.to,
        title: n.label,
        subtitle: n.description ?? '',
        icon: <n.icon className="h-4 w-4" />,
      }))
    const reports: Hit[] = REPORTS.filter((r) => match(s, r.label, r.group, r.description, 'report'))
      .slice(0, 5)
      .map((r) => ({
        key: `r${r.type}`,
        kind: 'Reports',
        to: `/reports?type=${r.type}`,
        title: `${r.label} report`,
        subtitle: `${r.group} · ${r.description}`,
        icon: <r.icon className="h-4 w-4" />,
      }))
    const vehicles: Hit[] = devices
      .filter((d) => d.name.toLowerCase().includes(s) || d.plate.toLowerCase().includes(s) || d.imei.includes(s))
      .slice(0, 6)
      .map((d) => ({
        key: `v${d.id}`,
        kind: 'Vehicles',
        to: `/live?device=${d.id}`,
        title: d.name,
        subtitle: d.plate || d.imei,
        icon: <CategoryIcon category={d.category} icon={d.icon} className="h-4 w-4" />,
        right: <StatusPill status={d.status} />,
      }))
    return [...vehicles, ...reports, ...screens]
  }, [devices, nav, subs, q])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) {
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

  const pick = (h: Hit) => {
    go(h.to)
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
          } else if (e.key === 'Enter' && results[active]) pick(results[active])
          else if (e.key === 'Escape') {
            setOpen(false)
            input.current?.blur()
          }
        }}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="global-search-results"
        aria-activedescendant={open && results[active] ? `gs-${results[active].key}` : undefined}
        aria-label="Search vehicles, reports and screens"
        placeholder="Search vehicles, reports, screens…"
        className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-10 text-[13px] text-slate-900 placeholder:text-slate-400 transition-colors focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white dark:placeholder:text-slate-500 dark:focus:border-brand-400 dark:focus:bg-white/[0.06]"
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 sm:block">
        <Kbd>/</Kbd>
      </span>
      {open && q.trim() && (
        <div
          id="global-search-results"
          role="listbox"
          className="glass absolute left-0 right-0 top-11 z-50 max-h-[min(70vh,520px)] animate-fade-in overflow-y-auto rounded-xl p-1.5 max-sm:fixed max-sm:inset-x-2 max-sm:top-14"
        >
          {results.length === 0 ? (
            <p className="px-3 py-4 text-center text-[12.5px] text-slate-500">Nothing matches “{q}”</p>
          ) : (
            results.map((h, i) => (
              <div key={h.key}>
                {(i === 0 || results[i - 1].kind !== h.kind) && (
                  <p className={cn('label-xs px-2.5 pb-1 !text-[10px]', i === 0 ? 'pt-1' : 'mt-1 border-t border-slate-200/70 pt-2 dark:border-white/[0.06]')}>
                    {h.kind}
                  </p>
                )}
                <button
                  id={`gs-${h.key}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(h)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left',
                    i === active && 'bg-slate-900/5 dark:bg-white/[0.07]',
                  )}
                >
                  <span
                    className={cn(
                      'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
                      h.kind === 'Vehicles'
                        ? 'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-300'
                        : 'bg-brand-500/15 text-navy-700 dark:bg-brand-400/15 dark:text-brand-300',
                    )}
                  >
                    {h.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900 dark:text-white">{h.title}</span>
                    <span className="block truncate text-[12px] text-slate-500">{h.subtitle}</span>
                  </span>
                  {h.right ?? (i === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-slate-400" />)}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
