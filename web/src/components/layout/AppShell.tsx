import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, qk } from '@/api/client'
import { useAlerts } from '@/store/alerts'
import { installAudioUnlock } from '@/lib/sound'
import { useAuth } from '@/store/auth'
import { liveConnection } from '@/store/connection'
import { startClock } from '@/store/now'
import { BottomNav, NavRail } from './NavRail'
import { TopBar } from './TopBar'
import { NAV } from './nav'
import { normRole } from '@/lib/access'

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
