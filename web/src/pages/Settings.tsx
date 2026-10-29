import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bell, Bot, Coins, Gauge, LogOut, Mail, Moon, Smartphone, Sun, UserRound, Waypoints, type LucideIcon, Map as MapIcon } from 'lucide-react'
import { api, qk } from '@/api/client'
import { useAuth } from '@/store/auth'
import { useUi } from '@/store/ui'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Misc'
import { NotificationsSection } from '@/features/settings/Notifications'
import { AlertRulesSection, DriverAppSection, GoogleMapsSection, EmailSection, OperationsSection, TelegramBotSection, TraccarSection } from '@/features/settings/AdminSections'
import { ProfileForm } from '@/features/settings/Profile'
import { RoleBadge } from '@/components/ui/Badges'
import { SettingsCard } from '@/features/settings/ui'
import { APP_NAME } from '@/config'
import { cn } from '@/lib/cn'

function AccountSection() {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useUi()
  const name = user?.name || user?.email || 'User'
  const initials =
    name
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  return (
    <SettingsCard id="account" icon={<UserRound />} title="Account" description="Your profile, password and preferences on this device.">
      <div className="divide-y divide-slate-100 dark:divide-white/[0.05]">
        <div className="flex flex-wrap items-center gap-3 pb-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-300 to-brand-500 text-[14px] font-semibold text-navy-900">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-slate-900 dark:text-white">{name}</p>
            <p className="truncate text-[12.5px] text-slate-500 dark:text-slate-400">{user?.email}</p>
          </div>
          {user?.role && <RoleBadge role={user.role} />}
        </div>
        <ProfileForm />
        <div className="flex items-center justify-between gap-4 py-4">
          <div>
            <p className="font-medium text-slate-900 dark:text-white">Appearance</p>
            <p className="text-[12.5px] text-slate-500 dark:text-slate-400">Light or dark interface</p>
          </div>
          <div role="group" aria-label="Theme" className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-white/[0.06]">
            {(['light', 'dark'] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={theme === t}
                onClick={() => theme !== t && toggleTheme()}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium capitalize',
                  theme === t ? 'bg-white text-slate-900 shadow-sm dark:bg-white/15 dark:text-white' : 'text-slate-500 dark:text-slate-400',
                )}
              >
                {t === 'light' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 pt-4">
          <div>
            <p className="font-medium text-slate-900 dark:text-white">Sign out</p>
            <p className="text-[12.5px] text-slate-500 dark:text-slate-400">End your session on this browser</p>
          </div>
          <Button icon={<LogOut className="h-4 w-4" />} onClick={() => logout()} className="hover:!text-rose-600 dark:hover:!text-rose-400">
            Sign out
          </Button>
        </div>
      </div>
    </SettingsCard>
  )
}

const SECTIONS: Array<{ id: string; label: string; icon: LucideIcon; admin?: boolean }> = [
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'rules', label: 'Alert rules', icon: Gauge, admin: true },
  { id: 'operations', label: 'Fleet operations', icon: Coins, admin: true },
  { id: 'telegram', label: 'Telegram bot', icon: Bot, admin: true },
  { id: 'email', label: 'Email (SMTP)', icon: Mail, admin: true },
  { id: 'driver-app', label: 'Driver app', icon: Smartphone, admin: true },
  { id: 'google-maps', label: 'Google Maps', icon: MapIcon, admin: true },
  { id: 'traccar', label: 'Traccar bridge', icon: Waypoints, admin: true },
  { id: 'account', label: 'Account', icon: UserRound },
]

export default function SettingsPage() {
  const isAdmin = useAuth((s) => s.user?.role === 'admin')
  const settings = useQuery({ queryKey: qk.settings, queryFn: api.settings, meta: { silent: true } })
  const sections = SECTIONS.filter((s) => !s.admin || isAdmin)
  const [active, setActive] = useState(sections[0].id)

  // highlight the section in view
  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e)
    if (!els.length) return
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (vis[0]) setActive(vis[0].target.id)
      },
      { rootMargin: '0px 0px -65% 0px' },
    )
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, settings.isSuccess])

  const s = settings.data
  // deep links like /settings#email (global search)
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (!id || !settings.isSuccess) return
    const t = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 80)
    return () => window.clearTimeout(t)
  }, [settings.isSuccess])
  const adminBody = (node: (x: NonNullable<typeof s>) => ReactNode, id: string) =>
    s ? node(s) : settings.isLoading ? <Skeleton key={id} className="h-48 rounded-2xl" /> : null

  return (
    <div className="h-full overflow-y-auto" id="settings-scroll">
      <div className="mx-auto max-w-5xl p-3 sm:p-5 lg:p-6">
        <div className="mb-4">
          <h1 className="page-title">Settings</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400">Notifications, alert rules and integrations for {APP_NAME}</p>
        </div>
        <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-6">
          <nav aria-label="Settings sections" className="hidden lg:block">
            <ul className="sticky top-0 space-y-0.5">
              {sections.map(({ id, label, icon: Icon }) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    onClick={(e) => {
                      e.preventDefault()
                      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      setActive(id)
                    }}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                      active === id
                        ? 'bg-brand-500/10 text-navy-700 dark:bg-brand-400/[0.12] dark:text-brand-200'
                        : 'text-slate-600 hover:bg-slate-900/[0.04] hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-white',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="min-w-0 space-y-4">
            <NotificationsSection settings={s} />
            {isAdmin && (
              <>
                {adminBody((x) => <AlertRulesSection settings={x} />, 'rules')}
                {adminBody((x) => <OperationsSection settings={x} />, 'operations')}
                {adminBody((x) => <TelegramBotSection settings={x} />, 'telegram')}
                {adminBody((x) => <EmailSection settings={x} />, 'email')}
                {adminBody((x) => <DriverAppSection settings={x} />, 'driver-app')}
                {adminBody((x) => <GoogleMapsSection settings={x} />, 'google-maps')}
                {adminBody((x) => <TraccarSection settings={x} />, 'traccar')}
                {settings.isError && (
                  <p className="card px-4 py-3 text-[12.5px] text-slate-500">Workspace settings are unavailable on this server.</p>
                )}
              </>
            )}
            <AccountSection />
          </div>
        </div>
      </div>
    </div>
  )
}
