import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { Toaster } from './components/ui/Toaster'
import { LoginPage } from './pages/Login'
import { LiveMapPage } from './pages/LiveMap'

const DashboardPage = lazy(() => import('./pages/Dashboard'))
const HistoryPage = lazy(() => import('./pages/History'))
const DevicesPage = lazy(() => import('./pages/Devices'))
const SettingsPage = lazy(() => import('./pages/Settings'))
const AlertsPage = lazy(() => import('./pages/Alerts'))
const GeofencesPage = lazy(() => import('./pages/Geofences'))
const ReportsPage = lazy(() => import('./pages/Reports'))
const DriversPage = lazy(() => import('./pages/Drivers'))
const MaintenancePage = lazy(() => import('./pages/Maintenance'))
const AdminPage = lazy(() => import('./pages/Admin'))
const SharePage = lazy(() => import('./pages/Share'))

const lazyEl = (el: JSX.Element) => <Suspense fallback={<PageFallback />}>{el}</Suspense>

function PageFallback() {
  return (
    <div className="grid h-full place-items-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
    </div>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/share/:token" element={lazyEl(<SharePage />)} />
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/live" replace />} />
          <Route path="/live" element={<LiveMapPage />} />
          <Route
            path="/dashboard"
            element={
              <Suspense fallback={<PageFallback />}>
                <DashboardPage />
              </Suspense>
            }
          />
          <Route
            path="/history"
            element={
              <Suspense fallback={<PageFallback />}>
                <HistoryPage />
              </Suspense>
            }
          />
          <Route
            path="/devices"
            element={
              <Suspense fallback={<PageFallback />}>
                <DevicesPage />
              </Suspense>
            }
          />
          <Route
            path="/alerts"
            element={
              <Suspense fallback={<PageFallback />}>
                <AlertsPage />
              </Suspense>
            }
          />
          <Route
            path="/geofences"
            element={
              <Suspense fallback={<PageFallback />}>
                <GeofencesPage />
              </Suspense>
            }
          />
          <Route
            path="/settings"
            element={
              <Suspense fallback={<PageFallback />}>
                <SettingsPage />
              </Suspense>
            }
          />
          <Route path="/reports" element={lazyEl(<ReportsPage />)} />
          <Route path="/drivers" element={lazyEl(<DriversPage />)} />
          <Route path="/maintenance" element={lazyEl(<MaintenancePage />)} />
          <Route path="/admin" element={lazyEl(<AdminPage />)} />
          <Route path="*" element={<Navigate to="/live" replace />} />
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}
