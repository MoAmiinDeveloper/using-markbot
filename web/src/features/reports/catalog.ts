import {
  BadgeCheck,
  BellRing,
  CalendarRange,
  ChartColumn,
  CircleParking,
  Gauge,
  Hexagon,
  Hourglass,
  Key,
  Receipt,
  Route,
  ScrollText,
  Wrench,
  Fuel,
  Thermometer,
  type LucideIcon,
} from 'lucide-react'
import type { ReportType } from '@/api/types'

export type ReportGroup = 'Activity' | 'Alerts' | 'Driver' | 'Fleet' | 'Sensors'

export interface ReportDef {
  type: ReportType
  label: string
  group: ReportGroup
  icon: LucideIcon
  description: string
  /** keys summarised as KPI chips above the table */
  kpis?: string[]
}

/** Report catalogue, grouped like Trakzee. Kept tiny: the global quick search imports it. */
export const REPORTS: ReportDef[] = [
  { type: 'summary', label: 'Travel summary', group: 'Activity', icon: ChartColumn, description: 'Distance, driving, idle & stop time per vehicle', kpis: ['distance', 'drivingTime', 'idleTime', 'trips', 'maxSpeed', 'alerts'] },
  { type: 'daily', label: 'Daily', group: 'Activity', icon: CalendarRange, description: 'One row per vehicle per day', kpis: ['distance', 'drivingTime', 'idleTime'] },
  { type: 'trips', label: 'Trips', group: 'Activity', icon: Route, description: 'Every trip with start/end address', kpis: ['distance', 'duration'] },
  { type: 'stops', label: 'Stops', group: 'Activity', icon: CircleParking, description: 'Stops of 5 minutes or more', kpis: ['duration'] },
  { type: 'idle', label: 'Idle', group: 'Activity', icon: Hourglass, description: 'Engine running while stationary (≥ 3 min)', kpis: ['duration'] },
  { type: 'ignition', label: 'Ignition', group: 'Activity', icon: Key, description: 'Ignition on → off spans', kpis: ['duration', 'distance'] },
  { type: 'overspeed', label: 'Overspeed', group: 'Alerts', icon: Gauge, description: 'Overspeed events with peak speed' },
  { type: 'geofence', label: 'Geofence visits', group: 'Alerts', icon: Hexagon, description: 'Enter / exit and time inside each zone', kpis: ['duration'] },
  { type: 'alerts', label: 'Alerts', group: 'Alerts', icon: BellRing, description: 'All alerts with address' },
  { type: 'driver', label: 'Driver behaviour', group: 'Driver', icon: BadgeCheck, description: 'Overspeed, harsh driving, idling and a 0–100 score', kpis: ['score', 'distance', 'overspeeds', 'harshAcceleration', 'harshBraking', 'harshCornering'] },
  { type: 'maintenance', label: 'Maintenance', group: 'Fleet', icon: Wrench, description: 'Service schedules and what is due' },
  { type: 'expenses', label: 'Expenses', group: 'Fleet', icon: Receipt, description: 'Fuel, tolls, fines… with totals per category', kpis: ['amount', 'liters'] },
  { type: 'fuel', label: 'Fuel', group: 'Sensors', icon: Fuel, description: 'Per fuel sensor: levels, consumption, refuels, drains, L/100 km', kpis: ['consumed', 'refuelLiters', 'drainLiters', 'distance'] },
  { type: 'temperature', label: 'Temperature', group: 'Sensors', icon: Thermometer, description: 'Min / avg / max per sensor and time out of range', kpis: ['minutesOutOfRange', 'excursions'] },
  { type: 'systemLog', label: 'System log', group: 'Fleet', icon: ScrollText, description: 'Packets, gaps and reporting health per tracker', kpis: ['packets'] },
]

export const REPORT_GROUPS: ReportGroup[] = ['Activity', 'Alerts', 'Driver', 'Fleet', 'Sensors']

export const reportDef = (t: string | null | undefined): ReportDef | undefined => REPORTS.find((r) => r.type === t)
