import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Ellipsis } from 'lucide-react'
import { cn } from '@/lib/cn'
import { SECTION_LABEL, useNav, type NavItem } from './nav'

export function NavRail() {
  const items = useNav()
  return (
    <nav
      aria-label="Main"
      className="dark relative z-30 hidden w-[68px] shrink-0 flex-col items-center overflow-y-auto overflow-x-hidden bg-navy-800 py-3 [scrollbar-width:none] md:flex"
    >
      <ul className="flex flex-1 flex-col items-center gap-1.5">
        {items.map(({ to, label, icon: Icon, section }, i) => (
          <li
            key={to}
            className={cn(
              section === 'system' && items[i - 1]?.section !== 'system' && 'mt-auto pt-3',
              i > 0 && section !== 'system' && items[i - 1].section !== section &&
                'relative mt-2 pt-2 before:absolute before:left-1/2 before:top-0 before:h-px before:w-6 before:-translate-x-1/2 before:bg-white/10',
            )}
          >
            <NavLink
              to={to}
              aria-label={label}
              className={({ isActive }) =>
                cn(
                  'group relative grid h-11 w-11 place-items-center rounded-xl transition-colors',
                  isActive
                    ? 'bg-brand-500 text-navy-900 shadow-md shadow-black/20'
                    : 'text-white/60 hover:bg-white/[0.08] hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute -left-[12px] top-2.5 h-6 w-[3px] rounded-r-full bg-brand-500" />
                  )}
                  <Icon className="h-[19px] w-[19px]" strokeWidth={isActive ? 2.2 : 1.9} />
                  <span className="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[12px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-slate-100 dark:text-slate-900">
                    {label}
                  </span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function BottomNav() {
  const [more, setMore] = useState(false)
  const loc = useLocation()
  const ref = useRef<HTMLDivElement>(null)
  const items = useNav()
  const primary = items.filter((n) => n.primary)
  const rest = items.filter((n) => !n.primary)
  const sections = rest.reduce<Array<{ section: NavItem['section']; items: NavItem[] }>>((acc, n) => {
    const last = acc[acc.length - 1]
    if (last?.section === n.section) last.items.push(n)
    else acc.push({ section: n.section, items: [n] })
    return acc
  }, [])
  const inRest = rest.some((n) => loc.pathname.startsWith(n.to))

  useEffect(() => setMore(false), [loc.pathname])
  useEffect(() => {
    if (!more) return
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setMore(false)
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [more])

  const item = 'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] font-medium transition-colors'
  return (
    <nav
      ref={ref}
      aria-label="Main"
      className="relative z-30 flex shrink-0 border-t-2 border-brand-500 bg-navy-700 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {primary.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(item, isActive ? 'text-brand-500' : 'text-white/60')
          }
        >
          <Icon className="h-5 w-5" />
          {label.replace(' Map', '')}
        </NavLink>
      ))}
      <button
        type="button"
        aria-expanded={more}
        aria-haspopup="menu"
        onClick={() => setMore((m) => !m)}
        className={cn(item, inRest || more ? 'text-brand-500' : 'text-white/60')}
      >
        <Ellipsis className="h-5 w-5" />
        More
      </button>
      {more && (
        <div
          role="menu"
          className="absolute bottom-full right-2 mb-2 max-h-[min(70vh,560px)] w-60 animate-slide-up overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-panel dark:border-white/10 dark:bg-ink-900"
        >
          {sections.map((sec, si) => (
            <div key={sec.section} className={cn(si > 0 && 'mt-1 border-t border-slate-100 pt-1 dark:border-white/[0.06]')}>
              <p className="label-xs px-3 pb-1 pt-1.5 !text-[10px]">{SECTION_LABEL[sec.section]}</p>
              {sec.items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  role="menuitem"
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-medium',
                      isActive
                        ? 'bg-brand-500/10 text-navy-600 dark:text-brand-300'
                        : 'text-slate-700 hover:bg-slate-900/5 dark:text-slate-200 dark:hover:bg-white/[0.07]',
                    )
                  }
                >
                  <Icon className="h-[18px] w-[18px]" />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
        </div>
      )}
    </nav>
  )
}
