// Types mirroring docs/API.md (v1 + Phase 2 + Phase 3 additions). Keep in sync with the contract.

/** Phase 3 roles. Legacy `user` rows migrate to `manager` server-side; the UI treats `user` as manager too. */
export type Role = 'admin' | 'manager' | 'viewer' | 'user'
export const ROLES = ['admin', 'manager', 'viewer'] as const

export interface User {
  id: number
  email: string
  name: string
  role: Role
  /** Phase 3: groups the user belongs to (non-admins only see devices in these) */
  groupIds?: number[]
  active?: boolean
  createdAt?: string
  lastLoginAt?: string | null
}

export interface LoginResponse {
  token: string
  user: User
}

export type DeviceStatus = 'moving' | 'idle' | 'stopped' | 'offline' | 'never'

export const DEVICE_CATEGORIES = ['car', 'truck', 'van', 'bus', 'motorcycle', 'trailer', 'other'] as const
export type DeviceCategory = (typeof DEVICE_CATEGORIES)[number]

export const PROTOCOLS = ['teltonika'] as const
export type Protocol = (typeof PROTOCOLS)[number]

/** Well-known attribute keys plus arbitrary vendor IO values. */
export interface PositionAttributes {
  ignition?: boolean
  power?: number
  battery?: number
  odometer?: number
  rssi?: number
  [key: string]: unknown
}

export interface Position {
  deviceId: number
  imei: string
  protocol: string
  time: string
  serverTime: string
  lat: number
  lng: number
  altitude: number
  speed: number
  course: number
  satellites: number
  valid: boolean
  priority: number
  eventId: number
  attributes: PositionAttributes
}

export interface Device {
  id: number
  name: string
  imei: string
  protocol: string
  plate: string
  model: string
  category: DeviceCategory | string
  phone: string
  status: DeviceStatus
  lastSeen: string | null
  position: Position | null
  createdAt: string
  /** km/h, 0 = use the global default from /settings (Phase 2) */
  speedLimit: number
  /** direct = connected to our gateway, traccar = bridged (no commands) */
  source: DeviceSource
  /** whether the device can receive commands right now (direct + connected) */
  commands: boolean
  /** Phase 3 */
  groupIds?: number[]
  /** km — tracker odometer if reported, else accumulated GPS distance */
  odometer?: number
  /** hours of ignition-on time */
  engineHours?: number
  /** current driver */
  driverId?: number | null
}

export type DeviceSource = 'direct' | 'traccar'

export interface DeviceInput {
  name: string
  imei: string
  protocol?: string
  plate?: string
  model?: string
  category?: string
  phone?: string
  speedLimit?: number
  /** Phase 3 calibration (km / hours) */
  odometer?: number
  engineHours?: number
}

export interface Trip {
  start: string
  end: string
  startLat: number
  startLng: number
  endLat: number
  endLng: number
  /** meters */
  distance: number
  /** seconds */
  duration: number
  maxSpeed: number
  avgSpeed: number
}

export interface Summary {
  total: number
  moving: number
  idle: number
  stopped: number
  offline: number
  never: number
}

// ---------------------------------------------------------------- Phase 2

export const EVENT_TYPES = [
  'geofenceEnter',
  'geofenceExit',
  'overspeed',
  'ignitionOn',
  'ignitionOff',
  'alarm',
  'harshAcceleration',
  'harshBraking',
  'harshCornering',
  'idle',
  'maintenanceDue',
  'documentExpiry',
  'commandResult',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

/** Event types users can configure notifications for (commandResult is in-app only). */
export const NOTIFY_EVENT_TYPES = [
  'geofenceEnter',
  'geofenceExit',
  'overspeed',
  'ignitionOn',
  'ignitionOff',
  'alarm',
  'harshAcceleration',
  'harshBraking',
  'harshCornering',
  'idle',
  'maintenanceDue',
  'documentExpiry',
] as const
export type NotifyEventType = (typeof NOTIFY_EVENT_TYPES)[number]

export interface EventAttributes {
  speed?: number
  limit?: number
  /** overspeed: peak speed during the episode */
  maxSpeed?: number
  alarm?: string
  geofenceName?: string
  [key: string]: unknown
}

/** `Event` in docs/API.md (renamed to avoid clashing with the DOM Event type). */
export interface FleetEvent {
  id: number
  deviceId: number
  type: EventType
  /** device time of the triggering fix */
  time: string
  lat: number
  lng: number
  geofenceId: number | null
  attributes: EventAttributes
  message: string
}

export interface EventQuery {
  deviceId?: number
  /** one type, or several joined with commas */
  type?: EventType | string
  from?: string
  to?: string
  limit?: number
}

export type GeofenceType = 'circle' | 'polygon'

export interface Geofence {
  id: number
  name: string
  color: string
  type: GeofenceType
  /** [lng, lat], circle only */
  center?: [number, number] | null
  /** meters, circle only */
  radius?: number | null
  /** [[lng, lat], ...] not closed, polygon only */
  polygon?: Array<[number, number]> | null
  /** empty = applies to all devices */
  deviceIds: number[]
  createdAt: string
}

export interface GeofenceInput {
  name: string
  color: string
  type: GeofenceType
  center?: [number, number]
  radius?: number
  polygon?: Array<[number, number]>
  deviceIds: number[]
}

export const COMMAND_TYPES = ['engineStop', 'engineResume', 'reboot', 'getInfo', 'getVersion', 'custom'] as const
export type CommandType = (typeof COMMAND_TYPES)[number]
export type CommandStatus = 'queued' | 'sent' | 'success' | 'failed' | 'expired'

export interface Command {
  id: number
  deviceId: number
  userId: number
  type: CommandType
  text: string
  status: CommandStatus
  response: string
  createdAt: string
  completedAt: string | null
}

export interface Settings {
  speedLimit: number
  overspeedMinDuration: number
  /** write-only: always "" on GET */
  telegramBotToken: string
  telegramConfigured: boolean
  telegramBotUsername: string
  traccarToken: string
  /** Phase 3 */
  currency?: string
  /** 0 = off */
  idleAlertMinutes?: number
  harshScoring?: boolean
}

export type SettingsPatch = Partial<
  Pick<Settings, 'speedLimit' | 'overspeedMinDuration' | 'telegramBotToken' | 'currency' | 'idleAlertMinutes' | 'harshScoring'>
>

export interface ChannelPrefs {
  inApp: boolean
  telegram: boolean
  push: boolean
}
export type Channel = keyof ChannelPrefs

export interface NotificationPrefs {
  telegramLinked: boolean
  push: { enabled: boolean }
  /** older servers may not return the Phase 3 keys */
  events: Partial<Record<NotifyEventType, ChannelPrefs>>
}

export interface TestNotificationResult {
  /** delivered to the linked Telegram chat */
  telegram: boolean
  /** number of push subscriptions that accepted it */
  push: number
}

export interface TelegramLink {
  url: string
  expiresAt: string
}

export type WsMessage =
  | { type: 'position'; data: Position }
  | { type: 'device'; data: Device }
  | { type: 'deleted'; data: { id: number } }
  | { type: 'event'; data: FleetEvent }
  | { type: 'command'; data: Command }
  | { type: 'geofences' }
  | { type: 'notifications' }

// ---------------------------------------------------------------- Phase 3

export interface Group {
  id: number
  name: string
  color: string
  deviceIds: number[]
  createdAt: string
}
export type GroupInput = Pick<Group, 'name' | 'color' | 'deviceIds'>

export interface UserInput {
  email: string
  name: string
  password?: string
  role: Exclude<Role, 'user'>
  groupIds: number[]
  active?: boolean
}

export interface MePatch {
  name?: string
  currentPassword?: string
  newPassword?: string
}

export interface Driver {
  id: number
  name: string
  phone: string
  licenseNumber: string
  /** YYYY-MM-DD or "" */
  licenseExpiry: string
  /** iButton / RFID id (hex) */
  tag: string
  deviceId: number | null
  notes: string
  createdAt: string
}
export type DriverInput = Omit<Driver, 'id' | 'createdAt'>

export type DueStatus = 'ok' | 'dueSoon' | 'overdue'

export interface Maintenance {
  id: number
  deviceId: number
  name: string
  intervalKm: number
  intervalDays: number
  intervalHours: number
  lastServiceDate: string
  lastServiceKm: number
  lastServiceHours: number
  notifyBeforeKm: number
  notifyBeforeDays: number
  notifyBeforeHours: number
  status: DueStatus
  nextDueKm: number | null
  nextDueDate: string | null
  nextDueHours: number | null
  remainingKm: number | null
  remainingDays: number | null
  remainingHours: number | null
}
export type MaintenanceInput = Pick<
  Maintenance,
  | 'deviceId'
  | 'name'
  | 'intervalKm'
  | 'intervalDays'
  | 'intervalHours'
  | 'lastServiceDate'
  | 'lastServiceKm'
  | 'lastServiceHours'
  | 'notifyBeforeKm'
  | 'notifyBeforeDays'
  | 'notifyBeforeHours'
>

export interface ServiceRecord {
  id: number
  maintenanceId: number
  deviceId: number
  date: string
  odometer: number | null
  engineHours: number | null
  cost: number | null
  notes: string
}

export interface CompleteMaintenanceInput {
  date: string
  odometer?: number
  engineHours?: number
  cost?: number
  notes?: string
}

export const REMINDER_KINDS = ['insurance', 'registration', 'license', 'permit', 'inspection', 'other'] as const
export type ReminderKind = (typeof REMINDER_KINDS)[number]

export interface Reminder {
  id: number
  deviceId: number | null
  driverId: number | null
  kind: ReminderKind
  title: string
  dueDate: string
  notifyDaysBefore: number
  status: DueStatus
  notes: string
}
export type ReminderInput = Omit<Reminder, 'id' | 'status'>

export const EXPENSE_CATEGORIES = ['fuel', 'maintenance', 'toll', 'parking', 'fine', 'insurance', 'tyres', 'other'] as const
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export interface Expense {
  id: number
  deviceId: number
  driverId: number | null
  category: ExpenseCategory
  amount: number
  liters: number | null
  odometer: number | null
  date: string
  notes: string
  createdAt: string
}
export type ExpenseInput = Omit<Expense, 'id' | 'createdAt'>

export interface ExpenseQuery {
  deviceId?: number
  from?: string
  to?: string
  category?: string
}

export interface Share {
  token: string
  /** relative, e.g. /share/<token> */
  url: string
  expiresAt: string
  createdAt?: string
}

export interface PublicShare {
  name: string
  category: string
  position: Position | null
  status: DeviceStatus
  expiresAt: string
}

export const PLACE_CATEGORIES = ['depot', 'customer', 'fuel', 'parking', 'workshop', 'other'] as const
export type PlaceCategory = (typeof PLACE_CATEGORIES)[number]

export interface Place {
  id: number
  name: string
  category: PlaceCategory
  lat: number
  lng: number
  radius: number
  color: string
  createdAt: string
}
export type PlaceInput = Omit<Place, 'id' | 'createdAt'>

export interface Geocode {
  address: string
  place: Place | null
}

export const REPORT_TYPES = [
  'summary',
  'daily',
  'trips',
  'stops',
  'idle',
  'ignition',
  'overspeed',
  'geofence',
  'alerts',
  'driver',
  'maintenance',
  'expenses',
  'systemLog',
] as const
export type ReportType = (typeof REPORT_TYPES)[number]
export type ReportFormat = 'json' | 'csv' | 'xlsx' | 'pdf'
export type ColumnKind = 'number' | 'duration' | 'datetime' | 'text' | 'speed' | 'money' | 'link'

export interface ReportColumn {
  key: string
  label: string
  unit?: string
  kind: ColumnKind
}

export type ReportValue = string | number | boolean | null | undefined
export type ReportRow = Record<string, ReportValue>

export interface Report {
  type: ReportType | string
  title: string
  subtitle?: string
  from: string
  to: string
  columns: ReportColumn[]
  rows: ReportRow[]
  totals?: Record<string, ReportValue>
}

export interface ReportQuery {
  deviceIds?: number[]
  groupId?: number
  driverId?: number
  from: string
  to: string
}

export interface DashboardData {
  distanceByDay: Array<{ date: string; distance: number }>
  alertsByType: Record<string, number>
  topVehicles: Array<{ deviceId: number; name: string; distance: number }>
  driverScores: Array<{ driverId: number | null; name: string; score: number; distance: number }>
  maintenance: { dueSoon: number; overdue: number }
  reminders: { dueSoon: number; overdue: number }
  expenses: { total: number; currency: string }
  /** 0..1 */
  utilization: number
}
