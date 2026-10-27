import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, qk } from '@/api/client'
import { useAlerts } from '@/store/alerts'
import { installAudioUnlock } from '@/lib/sound'
import { useAuth } from '@/store/auth'
import { useUi } from '@/store/ui'
import { liveConnection } from '@/store/connection'
import { startClock } from '@/store/now'
import { BottomNav, NavRail } from './NavRail'
import { TopBar } from './TopBar'
import { NAV } from './nav'
import { normRole } from '@/lib/access'
import { Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { APP_NAME } from '@/config'
import { Logo } from './Logo'

/** Driver accounts (Phase 4a) only work in the driver app — the web console APIs return 403 for them. */
function DriverNotice() {
  const { user, logout } = useAuth()
  return (
    <div className="grid h-full place-items-center bg-navy-800 p-6 text-center">
      <div className="max-w-sm">
        <Logo size="h-12" className="mx-auto text-white" />
        <span className="mx-auto mt-8 grid h-14 w-14 place-items-center rounded-2xl bg-brand-500 text-navy-900">
          <Smartphone className="h-7 w-7" />
        </span>
        <h1 className="mt-4 text-[18px] font-semibold text-white">Use the {APP_NAME} Driver app</h1>
        <p className="mt-2 text-[13px] text-white/70">
          {user?.name ? `${user.name}, your` : 'Your'} account is a driver login. Sign in with the same email and password in the Android
          driver app to see and complete your jobs.
        </p>
        <Button variant="primary" className="mt-6" onClick={() => logout()}>
          Sign out
        </Button>
      </div>
    </div>
  )
}

export function AppShell() {
  const token = useAuth((s) => s.token)
  const setUser = useAuth((s) => s.setUser)
  const loc = useLocation()
  const qc = useQueryClient()
  const user = useAuth((s) => s.user)
  const userId = user?.id ?? null

  useEffect(() => {
    useAlerts.getState().setUser(userId)
  }, [userId])

  // notification preferences decide which live events toast; cached for the connection to read
  useQuery({
    queryKey: qk.notificationPrefs,
    queryFn: api.notificationPrefs,
    enabled: !!token,
    staleTime: 5 * 60_000,
    meta: { silent: true },
  })

  // Google Maps key (if configured) drives the Google basemaps
  const settingsQ = useQuery({ queryKey: qk.settings, queryFn: api.settings, enabled: !!token, staleTime: 5 * 60_000, meta: { silent: true } })
  const setGoogleKey = useUi((s) => s.setGoogleMapsKey)
  useEffect(() => setGoogleKey(settingsQ.data?.googleMapsKey ?? ''), [settingsQ.data?.googleMapsKey, setGoogleKey])

  useEffect(() => {
    if (!token) return
    startClock()
    installAudioUnlock()
    liveConnection.start(token)
    api.me().then(setUser, () => {
      /* 401 handled by client */
    })
    return () => {
      liveConnection.stop()
      qc.clear() // don't leak cached data across sessions
    }
  }, [token, setUser, qc])

  if (!token) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />
  if (user?.role === 'driver') return <DriverNotice />

  const title = NAV.find((n) => loc.pathname.startsWith(n.to))?.label ?? ''
  if (loc.pathname.startsWith('/admin') && user && normRole(user.role) !== 'admin') return <Navigate to="/live" replace />

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <TopBar title={title} />
      <div className="flex min-h-0 flex-1">
        <NavRail />
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="relative min-h-0 flex-1 overflow-hidden">
            <Outlet />
          </main>
          <BottomNav />
        </div>
      </div>
    </div>
  )
}
