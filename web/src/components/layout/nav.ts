import {
  CalendarClock,
  ClipboardList,
  Gauge,
  Mail,
  Route,
  Smartphone,
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
  SlidersHorizontal,
  Sparkles,
  TableProperties,
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
  { to: '/data', label: 'Data window', icon: TableProperties, section: 'monitor', keywords: 'raw data records io parameters packets log tracker avl', description: 'Every record a tracker sends, all parameters' },
  { to: '/reports', label: 'Reports', icon: ChartColumn, section: 'analyse', primary: true, keywords: 'export excel pdf csv', description: 'Activity, alert, driver and fleet reports' },
  { to: '/dispatch', label: 'Dispatch', icon: ClipboardList, section: 'manage', keywords: 'jobs deliveries orders tasks pod proof signature stops driver app', description: 'Jobs, stops and proof of delivery' },
  { to: '/geofences', label: 'Geofences', icon: Hexagon, section: 'manage', keywords: 'zones places poi routes corridor', description: 'Zones, places and planned routes' },
  { to: '/drivers', label: 'Drivers', icon: IdCard, section: 'manage', keywords: 'ibutton rfid license score', description: 'Drivers, licences and behaviour' },
  { to: '/maintenance', label: 'Maintenance', icon: Wrench, section: 'manage', keywords: 'service reminders documents expenses fuel', description: 'Service schedules, documents & expenses' },
  { to: '/devices', label: 'Devices', icon: Cpu, section: 'manage', keywords: 'trackers imei odometer register owner sim icon', description: 'Trackers, vehicles and owners' },
  { to: '/parameters', label: 'Parameters', icon: SlidersHorizontal, section: 'manage', keywords: 'io data parameters attributes calculated formula virtual mapping custom events', description: 'Data parameters, formulas & custom events' },
  { to: '/admin', label: 'Users & Groups', icon: ShieldCheck, section: 'system', adminOnly: true, keywords: 'admin users roles groups permissions', description: 'Accounts, roles and vehicle groups' },
  { to: '/settings', label: 'Settings', icon: Settings, section: 'system', keywords: 'notifications telegram profile password', description: 'Notifications, rules and your profile' },
]

/** Screens inside pages, offered by the global quick search only. */
export interface SubScreen {
  to: string
  label: string
  icon: LucideIcon
  keywords: string
  description: string
  manage?: boolean
  adminOnly?: boolean
}
export const SUB_SCREENS: SubScreen[] = [
  { to: '/dispatch?new=1', label: 'New job', icon: ClipboardList, keywords: 'create job delivery order dispatch', description: 'Dispatch · create a job with stops', manage: true },
  { to: '/geofences?tab=routes', label: 'Routes', icon: Route, keywords: 'routes path corridor deviation planned', description: 'Geofences · planned routes & deviation alerts' },
  { to: '/reports?view=schedules', label: 'Scheduled reports', icon: CalendarClock, keywords: 'schedules email telegram automatic daily weekly', description: 'Reports · automatic delivery by email & Telegram' },
  { to: '/reports?type=fuel', label: 'Fuel report', icon: Gauge, keywords: 'fuel sensor drain refuel consumption', description: 'Reports · levels, refuels and drains' },
  { to: '/devices', label: 'Sensors', icon: Gauge, keywords: 'sensors fuel temperature calibration io', description: 'Devices · edit a device → Sensors', manage: true },
  { to: '/parameters?tab=events', label: 'Custom events', icon: Sparkles, keywords: 'custom events rules conditions alerts formula', description: 'Parameters · alerts from your own conditions' },
  { to: '/parameters?tab=calculated', label: 'Calculated parameters', icon: SlidersHorizontal, keywords: 'virtual calculated formula parameters', description: 'Parameters · formulas on tracker data' },
  { to: '/settings#email', label: 'Email (SMTP)', icon: Mail, keywords: 'smtp email mail server', description: 'Settings · outgoing email', adminOnly: true },
  { to: '/settings#driver-app', label: 'Driver app', icon: Smartphone, keywords: 'driver app phone tracking android', description: 'Settings · driver app tracking', adminOnly: true },
]

export function useSubScreens(): SubScreen[] {
  const { isAdmin, canManage } = useAccess()
  return SUB_SCREENS.filter((s) => (!s.adminOnly || isAdmin) && (!s.manage || canManage))
}

/** Nav items the current user may open. */
export function useNav(): NavItem[] {
  const { isAdmin } = useAccess()
  return NAV.filter((n) => !n.adminOnly || isAdmin)
}
