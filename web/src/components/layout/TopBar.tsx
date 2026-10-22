import { useEffect, useRef, useState } from 'react'
import { LogOut, Moon, Sun, Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/store/auth'
import { useUi } from '@/store/ui'
import { IconButton } from '@/components/ui/Button'
import { ConnectionBadge } from './ConnectionBadge'
import { GlobalSearch } from './GlobalSearch'
import { Link } from 'react-router-dom'
import { APP_NAME } from '@/config'
import { Logo, LogoMark } from './Logo'
import { NotificationBell } from './NotificationBell'

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
            {user?.role && (
              <span className="mt-1.5 inline-block rounded-md bg-brand-500/10 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-navy-600 dark:text-brand-300">
                {user.role}
              </span>
            )}
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

export function ThemeToggle() {
  const { theme, toggleTheme } = useUi()
  return (
    <IconButton label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme}>
      {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </IconButton>
  )
}

export function TopBar({ title }: { title: string }) {
  return (
    // Brand bar: always Somtel navy; the `dark` class gives children their on-navy styling.
    <header className="dark relative z-20 flex h-14 shrink-0 items-center gap-3 border-b-2 border-brand-500 bg-navy-700 px-3 text-white sm:px-4">
      <Link to="/live" aria-label={`${APP_NAME} home`} className="flex shrink-0 items-center rounded-lg md:w-[52px] lg:w-auto">
        <Logo size="h-8" className="hidden text-white lg:inline-flex" />
        <LogoMark className="h-8 w-8 lg:hidden" />
      </Link>
      <span className="hidden h-6 w-px bg-white/15 lg:block" aria-hidden />
      <h1 className="hidden min-w-[96px] text-[15px] font-semibold tracking-tight text-white lg:block">{title}</h1>
      <GlobalSearch className="max-w-md flex-1" />
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <ConnectionBadge compact />
        <span className="hidden sm:contents">
          <ThemeToggle />
        </span>
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  )
}
