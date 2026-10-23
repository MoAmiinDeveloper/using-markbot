import {
  BellRing,
  ChartColumn,
  Cpu,
  Hexagon,
  History,
  IdCard,
  LayoutDashboard,
  Map,
  Settings,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useAccess } from '@/lib/access'

export type NavSection = 'monitor' | 'analyse' | 'manage' | 'system'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  section: NavSection
  /** shown directly in the phone bottom bar (others go under "More") */
  primary?: boolean
  adminOnly?: boolean
  /** extra words matched by the global quick search */
  keywords?: string
  description?: string
}

export const SECTION_LABEL: Record<NavSection, string> = {
  monitor: 'Monitor',
  analyse: 'Analyse',
  manage: 'Manage',
  system: 'System',
}

export const NAV: NavItem[] = [
  { to: '/live', label: 'Live Map', icon: Map, section: 'monitor', primary: true, keywords: 'tracking realtime vehicles map', description: 'Where every vehicle is right now' },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, section: 'monitor', primary: true, keywords: 'overview kpi charts utilisation', description: 'Fleet KPIs and trends' },
  { to: '/alerts', label: 'Alerts', icon: BellRing, section: 'monitor', primary: true, keywords: 'events notifications alarms', description: 'Every event, filterable' },
  { to: '/history', label: 'History', icon: History, section: 'monitor', keywords: 'playback route replay trips', description: 'Replay routes and trips' },
  { to: '/reports', label: 'Reports', icon: ChartColumn, section: 'analyse', primary: true, keywords: 'export excel pdf csv', description: 'Activity, alert, driver and fleet reports' },
  { to: '/geofences', label: 'Geofences', icon: Hexagon, section: 'manage', keywords: 'zones places poi', description: 'Zones and points of interest' },
  { to: '/drivers', label: 'Drivers', icon: IdCard, section: 'manage', keywords: 'ibutton rfid license score', description: 'Drivers, licences and behaviour' },
  { to: '/maintenance', label: 'Maintenance', icon: Wrench, section: 'manage', keywords: 'service reminders documents expenses fuel', description: 'Service schedules, documents & expenses' },
  { to: '/devices', label: 'Devices', icon: Cpu, section: 'manage', keywords: 'trackers imei odometer', description: 'Trackers and vehicle settings' },
  { to: '/admin', label: 'Users & Groups', icon: ShieldCheck, section: 'system', adminOnly: true, keywords: 'admin users roles groups permissions', description: 'Accounts, roles and vehicle groups' },
  { to: '/settings', label: 'Settings', icon: Settings, section: 'system', keywords: 'notifications telegram profile password', description: 'Notifications, rules and your profile' },
]

/** Nav items the current user may open. */
export function useNav(): NavItem[] {
  const { isAdmin } = useAccess()
  return NAV.filter((n) => !n.adminOnly || isAdmin)
}
