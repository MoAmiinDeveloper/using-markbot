import { Bell, Building2, KeyRound, Moon, Sun, Users } from 'lucide-react'
import { useAuth } from '@/store/auth'
import { useUi } from '@/store/ui'
import { APP_NAME } from '@/config'
import { cn } from '@/lib/cn'

export default function SettingsPage() {
  const user = useAuth((s) => s.user)
  const { theme, toggleTheme } = useUi()
  const soon = [
    { icon: Bell, title: 'Alerts & notifications', text: 'Overspeed, ignition, geofence enter/exit — Phase 2' },
    { icon: Users, title: 'Users & permissions', text: 'Sub-users, groups and per-device access — Phase 3' },
    { icon: Building2, title: 'Organization', text: 'Companies, resellers and white-label branding — Phase 4' },
    { icon: KeyRound, title: 'API tokens', text: 'Programmatic access for integrations' },
  ]
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 p-3 sm:p-5 lg:p-6">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-slate-900 dark:text-white">Settings</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400">Workspace preferences for {APP_NAME}</p>
        </div>
        <section className="card divide-y divide-slate-100 dark:divide-white/[0.05]">
          <div className="flex items-center justify-between gap-4 p-4">
            <div>
              <h2 className="font-medium text-slate-900 dark:text-white">Profile</h2>
              <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
                {user?.name} · {user?.email} · <span className="uppercase">{user?.role}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 p-4">
            <div>
              <h2 className="font-medium text-slate-900 dark:text-white">Appearance</h2>
              <p className="text-[12.5px] text-slate-500 dark:text-slate-400">Choose light or dark interface</p>
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
        </section>
        <section className="grid gap-3 sm:grid-cols-2">
          {soon.map(({ icon: Icon, title, text }) => (
            <div key={title} className="card flex gap-3 p-4 opacity-80">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/[0.05] dark:text-slate-400">
                <Icon className="h-4 w-4" />
              </span>
              <div>
                <h3 className="flex items-center gap-2 font-medium text-slate-900 dark:text-white">
                  {title}
                  <span className="rounded bg-brand-500/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300">Soon</span>
                </h3>
                <p className="mt-0.5 text-[12.5px] text-slate-500 dark:text-slate-400">{text}</p>
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
