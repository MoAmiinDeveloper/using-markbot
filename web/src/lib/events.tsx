import {
  ChevronsDown,
  ChevronsUp,
  CornerUpRight,
  FileClock,
  Gauge,
  Hourglass,
  Key,
  LogIn,
  LogOut,
  PowerOff,
  Siren,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { CommandStatus, CommandType, EventType, FleetEvent } from '@/api/types'
import { fmtSpeed } from './format'

export interface EventMeta {
  label: string
  /** short noun used in filters / matrix rows */
  short: string
  description: string
  icon: LucideIcon
  color: string
  /** tailwind classes for the round icon chip */
  chip: string
  pill: string
}

export const EVENT_META: Record<EventType, EventMeta> = {
  geofenceEnter: {
    label: 'Geofence enter',
    short: 'Enter',
    description: 'A vehicle drives into a geofence',
    icon: LogIn,
    color: '#10b981',
    chip: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
    pill: 'bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300',
  },
  geofenceExit: {
    label: 'Geofence exit',
    short: 'Exit',
    description: 'A vehicle leaves a geofence',
    icon: LogOut,
    color: '#8b5cf6',
    chip: 'bg-violet-500/12 text-violet-600 dark:text-violet-400',
    pill: 'bg-violet-500/12 text-violet-700 ring-violet-500/25 dark:text-violet-300',
  },
  overspeed: {
    label: 'Overspeed',
    short: 'Overspeed',
    description: 'Speed above the limit for the configured duration',
    icon: Gauge,
    color: '#f97316',
    chip: 'bg-orange-500/12 text-orange-600 dark:text-orange-400',
    pill: 'bg-orange-500/12 text-orange-700 ring-orange-500/25 dark:text-orange-300',
  },
  ignitionOn: {
    label: 'Ignition on',
    short: 'Ignition on',
    description: 'Engine started',
    icon: Key,
    color: '#0ea5e9',
    chip: 'bg-sky-500/12 text-sky-600 dark:text-sky-400',
    pill: 'bg-sky-500/12 text-sky-700 ring-sky-500/25 dark:text-sky-300',
  },
  ignitionOff: {
    label: 'Ignition off',
    short: 'Ignition off',
    description: 'Engine switched off',
    icon: PowerOff,
    color: '#64748b',
    chip: 'bg-slate-500/12 text-slate-600 dark:text-slate-300',
    pill: 'bg-slate-500/12 text-slate-700 ring-slate-500/25 dark:text-slate-300',
  },
  alarm: {
    label: 'Alarm',
    short: 'Alarm',
    description: 'SOS, power cut, towing, crash or jamming',
    icon: Siren,
    color: '#f43f5e',
    chip: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
    pill: 'bg-rose-500/15 text-rose-700 ring-rose-500/30 dark:text-rose-300',
  },
  harshAcceleration: {
    label: 'Harsh acceleration',
    short: 'Harsh accel.',
    description: 'Aggressive acceleration detected by the tracker',
    icon: ChevronsUp,
    color: '#ec4899',
    chip: 'bg-pink-500/12 text-pink-600 dark:text-pink-400',
    pill: 'bg-pink-500/12 text-pink-700 ring-pink-500/25 dark:text-pink-300',
  },
  harshBraking: {
    label: 'Harsh braking',
    short: 'Harsh braking',
    description: 'Sudden, hard braking',
    icon: ChevronsDown,
    color: '#d946ef',
    chip: 'bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-400',
    pill: 'bg-fuchsia-500/12 text-fuchsia-700 ring-fuchsia-500/25 dark:text-fuchsia-300',
  },
  harshCornering: {
    label: 'Harsh cornering',
    short: 'Harsh cornering',
    description: 'Taking a corner too fast',
    icon: CornerUpRight,
    color: '#a855f7',
    chip: 'bg-purple-500/12 text-purple-600 dark:text-purple-400',
    pill: 'bg-purple-500/12 text-purple-700 ring-purple-500/25 dark:text-purple-300',
  },
  idle: {
    label: 'Excessive idle',
    short: 'Idle',
    description: 'Engine running while stationary longer than the idle limit',
    icon: Hourglass,
    color: '#f59e0b',
    chip: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
    pill: 'bg-amber-500/12 text-amber-700 ring-amber-500/25 dark:text-amber-300',
  },
  maintenanceDue: {
    label: 'Maintenance due',
    short: 'Maintenance',
    description: 'A service schedule is due soon or overdue',
    icon: Wrench,
    color: '#14b8a6',
    chip: 'bg-teal-500/12 text-teal-600 dark:text-teal-400',
    pill: 'bg-teal-500/12 text-teal-700 ring-teal-500/25 dark:text-teal-300',
  },
  documentExpiry: {
    label: 'Document expiry',
    short: 'Documents',
    description: 'Insurance, registration or a licence is about to expire',
    icon: FileClock,
    color: '#6366f1',
    chip: 'bg-indigo-500/12 text-indigo-600 dark:text-indigo-400',
    pill: 'bg-indigo-500/12 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300',
  },
  commandResult: {
    label: 'Command result',
    short: 'Command',
    description: 'A device answered a command',
    icon: Terminal,
    color: '#e6c200',
    chip: 'bg-brand-500/12 text-navy-600 dark:text-brand-300',
    pill: 'bg-brand-500/12 text-navy-700 ring-brand-500/25 dark:text-brand-300',
  },
}

export function eventMeta(type: string): EventMeta {
  return EVENT_META[type as EventType] ?? EVENT_META.commandResult
}

const ALARMS: Record<string, string> = {
  sos: 'SOS',
  powerCut: 'Power cut',
  towing: 'Towing',
  crash: 'Crash',
  jamming: 'GSM jamming',
}

export const alarmLabel = (a: unknown) => (typeof a === 'string' ? (ALARMS[a] ?? a) : 'Alarm')

/** Short secondary detail line for an event (speed vs limit, geofence name, alarm kind). */
export function eventDetail(e: FleetEvent): string | null {
  const a = e.attributes ?? {}
  switch (e.type) {
    case 'overspeed':
      return typeof a.speed === 'number'
        ? `${fmtSpeed(a.speed)}${typeof a.maxSpeed === 'number' && a.maxSpeed > a.speed ? ` · max ${Math.round(a.maxSpeed)}` : ''}${
            typeof a.limit === 'number' ? ` · limit ${Math.round(a.limit)}` : ''
          }`
        : null
    case 'geofenceEnter':
    case 'geofenceExit':
      return typeof a.geofenceName === 'string' ? a.geofenceName : null
    case 'alarm':
      return alarmLabel(a.alarm)
    case 'idle':
      return typeof a.minutes === 'number' ? `Idling ${Math.round(a.minutes)} min` : null
    case 'harshAcceleration':
    case 'harshBraking':
    case 'harshCornering':
      return typeof a.speed === 'number' ? `at ${fmtSpeed(a.speed)}` : null
    case 'maintenanceDue':
    case 'documentExpiry': {
      const name = typeof a.name === 'string' ? a.name : null
      const st = a.status === 'overdue' ? 'Overdue' : a.status === 'dueSoon' ? 'Due soon' : null
      return [name, st].filter(Boolean).join(' · ') || null
    }
    default:
      return null
  }
}

export const COMMAND_LABEL: Record<CommandType, string> = {
  engineStop: 'Engine stop',
  engineResume: 'Engine resume',
  reboot: 'Reboot',
  getInfo: 'Get info',
  getVersion: 'Get version',
  custom: 'Custom',
}

export const COMMAND_STATUS_META: Record<CommandStatus, { label: string; pill: string; dot: string }> = {
  queued: { label: 'Queued', pill: 'bg-amber-500/12 text-amber-700 ring-amber-500/25 dark:text-amber-300', dot: 'bg-amber-500' },
  sent: { label: 'Sent', pill: 'bg-brand-500/12 text-navy-700 ring-brand-500/25 dark:text-brand-300', dot: 'bg-brand-500' },
  success: { label: 'Success', pill: 'bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300', dot: 'bg-emerald-500' },
  failed: { label: 'Failed', pill: 'bg-rose-500/12 text-rose-700 ring-rose-500/25 dark:text-rose-300', dot: 'bg-rose-500' },
  expired: { label: 'Expired', pill: 'bg-slate-500/12 text-slate-600 ring-slate-500/25 dark:text-slate-400', dot: 'bg-slate-400' },
}
