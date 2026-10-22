import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Ellipsis } from 'lucide-react'
import { cn } from '@/lib/cn'
import { LogoMark } from './Logo'
import { NAV } from './nav'

export function NavRail() {
  return (
    <nav
      aria-label="Main"
      className="relative z-30 hidden w-[68px] shrink-0 flex-col items-center border-r border-slate-200/80 bg-white py-3 dark:border-white/[0.06] dark:bg-ink-950 md:flex"
    >
      <NavLink to="/live" aria-label="Home" className="mb-5 rounded-xl">
        <LogoMark className="h-9 w-9" />
      </NavLink>
      <ul className="flex flex-1 flex-col items-center gap-1.5">
        {NAV.map(({ to, label, icon: Icon }) => (
          <li key={to} className={cn(to === '/settings' && 'mt-auto')}>
            <NavLink
              to={to}
              aria-label={label}
              className={({ isActive }) =>
                cn(
                  'group relative grid h-11 w-11 place-items-center rounded-xl transition-colors',
                  isActive
                    ? 'bg-brand-500/10 text-brand-600 dark:bg-brand-400/[0.12] dark:text-brand-300'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute -left-[12px] top-2.5 h-6 w-[3px] rounded-r-full bg-brand-500 dark:bg-brand-400" />
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
  const primary = NAV.filter((n) => n.primary)
  const rest = NAV.filter((n) => !n.primary)
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
      className="relative z-30 flex shrink-0 border-t border-slate-200/80 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-white/[0.06] dark:bg-ink-950/95 md:hidden"
    >
      {primary.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(item, isActive ? 'text-brand-600 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400')
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
        className={cn(item, inRest || more ? 'text-brand-600 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400')}
      >
        <Ellipsis className="h-5 w-5" />
        More
      </button>
      {more && (
        <div role="menu" className="absolute bottom-full right-2 mb-2 w-52 animate-slide-up rounded-xl border border-slate-200 bg-white p-1.5 shadow-panel dark:border-white/10 dark:bg-ink-900">
          {rest.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              role="menuitem"
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-medium',
                  isActive
                    ? 'bg-brand-500/10 text-brand-600 dark:text-brand-300'
                    : 'text-slate-700 hover:bg-slate-900/5 dark:text-slate-200 dark:hover:bg-white/[0.07]',
                )
              }
            >
              <Icon className="h-[18px] w-[18px]" />
              {label}
            </NavLink>
          ))}
        </div>
      )}
    </nav>
  )
}
