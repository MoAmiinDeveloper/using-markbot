import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useAuth } from '@/store/auth'
import { liveConnection } from '@/store/connection'
import { startClock } from '@/store/now'
import { BottomNav, NavRail } from './NavRail'
import { TopBar } from './TopBar'
import { NAV } from './nav'

export function AppShell() {
  const token = useAuth((s) => s.token)
  const setUser = useAuth((s) => s.setUser)
  const loc = useLocation()
  const qc = useQueryClient()

  useEffect(() => {
    if (!token) return
    startClock()
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

  return (
    <div className="flex h-full w-full overflow-hidden">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} />
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
        <BottomNav />
      </div>
    </div>
  )
}
