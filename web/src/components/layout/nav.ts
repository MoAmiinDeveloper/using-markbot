import { History, LayoutDashboard, Map, Cpu, Settings, type LucideIcon } from 'lucide-react'

export const NAV: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: '/live', label: 'Live Map', icon: Map },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/history', label: 'History', icon: History },
  { to: '/devices', label: 'Devices', icon: Cpu },
  { to: '/settings', label: 'Settings', icon: Settings },
]
