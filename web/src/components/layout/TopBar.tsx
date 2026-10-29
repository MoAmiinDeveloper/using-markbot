import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Lightbulb, LightbulbOff, LogOut, Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, qk } from '@/api/client'
import { cn } from '@/lib/cn'
import { useAuth } from '@/store/auth'
import { useUi } from '@/store/ui'
import { IconButton } from '@/components/ui/Button'
import { ConnectionBadge } from './ConnectionBadge'
import { GlobalSearch } from './GlobalSearch'
import { Link } from 'react-router-dom'
import { APP_NAME } from '@/config'
import { Logo } from './Logo'
import { NotificationBell } from './NotificationBell'
import { RoleBadge } from '@/components/ui/Badges'

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  )
}

export function UserMenu() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
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
  const name = user?.name || user?.email || 'User'
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((o) => !o)}
        className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-brand-300 to-brand-500 text-[12px] font-semibold text-navy-900 shadow-soft ring-2 ring-white dark:ring-ink-900"
      >
        {initials(name)}
      </button>
      {open && (
        <div role="menu" className="glass absolute right-0 top-11 z-50 w-60 animate-fade-in rounded-xl p-1.5">
          <div className="px-2.5 py-2">
            <p className="truncate font-medium text-slate-900 dark:text-white">{name}</p>
            <p className="truncate text-[12px] text-slate-500 dark:text-slate-400">{user?.email}</p>
            {user?.role && <RoleBadge role={user.role} className="mt-1.5" />}
          </div>
          <div className="my-1 h-px bg-slate-200/80 dark:bg-white/[0.07]" />
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              nav('/settings')
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-slate-900/5 dark:hover:bg-white/[0.07]"
          >
            <Settings className="h-4 w-4 text-slate-400" /> Settings
          </button>
          <button
            role="menuitem"
            onClick={() => logout()}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

/** Light / dark switch (a bulb, like the reference design). */
export function ThemeToggle() {
  const { theme, toggleTheme } = useUi()
  return (
    <IconButton label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme}>
      {theme === 'dark' ? <LightbulbOff className="h-[18px] w-[18px]" /> : <Lightbulb className="h-[18px] w-[18px]" />}
    </IconButton>
  )
}

/** SOS alarms of the last 24 h; opens the alarm list. */
export function SosButton() {
  const nav = useNavigate()
  // hour-aligned so the query key is stable between renders
  const from = useMemo(() => new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - 24 * 3_600_000).toISOString(), [])
  const q = { type: 'alarm', from, limit: 200 }
  const alarms = useQuery({ queryKey: qk.events(q), queryFn: () => api.events(q), refetchInterval: 60_000, meta: { silent: true } })
  const count = (alarms.data ?? []).filter((e) => e.attributes?.alarm === 'sos').length
  return (
    <button
      type="button"
      onClick={() => nav('/alerts?type=alarm')}
      title={count ? `${count} SOS alarm${count === 1 ? '' : 's'} in the last 24 hours` : 'No SOS alarms in the last 24 hours'}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-bold tracking-wider transition-colors',
        count
          ? 'animate-pulse border-rose-500 bg-rose-500 text-white shadow-sm shadow-rose-500/40'
          : 'border-rose-300 bg-rose-50 text-rose-600 hover:bg-rose-100 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300',
      )}
    >
      SOS
      {count > 0 && <span className="tabular rounded-full bg-white/25 px-1.5 text-[10.5px]">{count}</span>}
    </button>
  )
}

/** Light page header: brand wordmark, breadcrumb (section › page), search and actions. */
export function TopBar({ section, title }: { section?: string; title: string }) {
  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-3 border-b border-slate-200/80 bg-white px-3 dark:border-white/[0.06] dark:bg-ink-900 sm:px-4">
      <Link to="/live" aria-label={`${APP_NAME} home`} className="flex shrink-0 items-center rounded-lg md:hidden">
        <Logo size="h-9" className="text-navy-700 dark:text-white [&>span:last-child]:hidden" />
      </Link>
      <Link to="/live" aria-label={`${APP_NAME} home`} className="hidden shrink-0 items-center rounded-lg xl:flex">
        <Logo size="h-10" className="text-navy-700 dark:text-white" />
      </Link>
      <span className="hidden h-7 w-px bg-slate-200 dark:bg-white/10 xl:block" aria-hidden />
      <div className="hidden min-w-[120px] leading-tight md:block">
        {section && (
          <p className="flex items-center gap-1 text-[11px] font-medium text-slate-400">
            {section} <ChevronRight className="h-3 w-3" />
          </p>
        )}
        <h1 className="text-[15px] font-semibold tracking-tight text-navy-800 dark:text-white">{title}</h1>
      </div>
      <GlobalSearch className="mx-auto max-w-md flex-1" />
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <span className="hidden sm:contents">
          <ConnectionBadge compact />
        </span>
        <SosButton />
        <span className="hidden h-6 w-px bg-slate-200 dark:bg-white/10 sm:block" aria-hidden />
        <span className="hidden sm:contents">
          <ThemeToggle />
        </span>
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  )
}
