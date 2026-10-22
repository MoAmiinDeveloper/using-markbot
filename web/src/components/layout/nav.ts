import { BellRing, Cpu, Hexagon, History, LayoutDashboard, Map, Settings, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** shown directly in the phone bottom bar (others go under "More") */
  primary?: boolean
}

export const NAV: NavItem[] = [
  { to: '/live', label: 'Live Map', icon: Map, primary: true },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, primary: true },
  { to: '/alerts', label: 'Alerts', icon: BellRing, primary: true },
  { to: '/history', label: 'History', icon: History, primary: true },
  { to: '/geofences', label: 'Geofences', icon: Hexagon },
  { to: '/devices', label: 'Devices', icon: Cpu },
  { to: '/settings', label: 'Settings', icon: Settings },
]
