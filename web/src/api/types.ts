// Types mirroring docs/API.md (v1 + Phase 2 + Phase 3 additions). Keep in sync with the contract.

/** Phase 3 roles. Legacy `user` rows migrate to `manager` server-side; the UI treats `user` as manager too. */
export type Role = 'admin' | 'manager' | 'viewer' | 'user' | 'driver'
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
  /** Phase 4a (assumed, optional): whether the user has linked a Telegram chat — used to pick report recipients */
  telegramLinked?: boolean
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
  /** Phase 4a: computed sensor values keyed by sensor id (only with `?sensors=1`) */
  sensors?: Record<string, number | null>
}

export interface Device {
  /** Client-only: earlier fixes [lng, lat] of the last live batch, oldest first (for smooth animation). */
  trail?: Array<[number, number]>
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
  /** Phase 4a: latest computed sensor values */
  sensors?: DeviceSensorValue[]
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
  // Phase 4a
  'jobAssigned',
  'jobStatus',
  'jobStopArrived',
  'jobLate',
  'routeDeviation',
  'routeReturn',
  'fuelDrain',
  'refuel',
  'sensorHigh',
  'sensorLow',
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
  'jobAssigned',
  'jobStatus',
  'jobStopArrived',
  'jobLate',
  'routeDeviation',
  'routeReturn',
  'fuelDrain',
  'refuel',
  'sensorHigh',
  'sensorLow',
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
  /** Phase 4a */
  driverAppTracking?: boolean
  smtp?: SmtpSettings
}

export type SmtpTls = 'starttls' | 'tls' | 'none'
export interface SmtpSettings {
  host: string
  port: number
  username: string
  /** write-only: always "" on GET */
  password: string
  from: string
  tls: SmtpTls
  configured: boolean
}

export type SettingsPatch = Partial<
  Pick<Settings, 'speedLimit' | 'overspeedMinDuration' | 'telegramBotToken' | 'currency' | 'idleAlertMinutes' | 'harshScoring' | 'driverAppTracking'>
> & { smtp?: Partial<Omit<SmtpSettings, 'configured'>> }

export interface ChannelPrefs {
  inApp: boolean
  telegram: boolean
  push: boolean
  /** Phase 4a (default off) */
  email?: boolean
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
  | { type: 'job'; data: Job }
  | { type: 'jobDeleted'; data: { id: number } }
  | { type: 'routes' }

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
  /** Phase 4a: linked driver-app login (User with role `driver`) */
  userId?: number | null
}
export type DriverInput = Omit<Driver, 'id' | 'createdAt' | 'userId'>

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
  // Phase 4a (sensors)
  'fuel',
  'temperature',
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

// ---------------------------------------------------------------- Phase 4a

export const JOB_STATUSES = [
  'unassigned',
  'assigned',
  'accepted',
  'enRoute',
  'arrived',
  'inProgress',
  'completed',
  'failed',
  'cancelled',
] as const
export type JobStatus = (typeof JOB_STATUSES)[number]
export type JobPriority = 'normal' | 'high' | 'urgent'
export type StopStatus = 'pending' | 'arrived' | 'completed' | 'skipped'

export interface JobStop {
  id?: number
  seq: number
  name: string
  address: string
  lat: number
  lng: number
  /** meters */
  radius: number
  status: StopStatus
  arrivedAt: string | null
  departedAt: string | null
  completedAt: string | null
  notes: string
}

export interface ChecklistItem {
  id?: number
  text: string
  required: boolean
  done: boolean
  doneAt: string | null
}

export type AttachmentKind = 'photo' | 'signature' | 'document'
export interface Attachment {
  id: number
  /** implementation notes: also jobId, contentType, size (bytes), userId */
  jobId?: number
  contentType?: string
  size?: number
  userId?: number | null
  kind: AttachmentKind
  stopId: number | null
  /** e.g. /api/v1/files/9 — needs the bearer token */
  url: string
  name: string
  createdAt: string
}

export interface Job {
  id: number
  reference: string
  title: string
  description: string
  priority: JobPriority
  status: JobStatus
  deviceId: number | null
  driverId: number | null
  customerName: string
  customerPhone: string
  scheduledStart: string | null
  dueBy: string | null
  stops: JobStop[]
  checklist: ChecklistItem[]
  attachments: Attachment[]
  notes: string
  failureReason: string
  /** null when the creator was deleted */
  createdBy: number | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  routeId: number | null
  /** server-computed: dueBy passed and not completed/failed/cancelled */
  late?: boolean
}

export type JobInput = Pick<
  Job,
  | 'title'
  | 'description'
  | 'priority'
  | 'deviceId'
  | 'driverId'
  | 'customerName'
  | 'customerPhone'
  | 'scheduledStart'
  | 'dueBy'
  | 'notes'
  | 'routeId'
> & {
  stops: Array<Pick<JobStop, 'name' | 'address' | 'lat' | 'lng' | 'radius' | 'seq' | 'notes'> & { id?: number }>
  checklist: Array<Pick<ChecklistItem, 'text' | 'required'> & { id?: number; done?: boolean }>
}

export interface JobQuery {
  status?: string
  deviceId?: number
  driverId?: number
  from?: string
  to?: string
  q?: string
}

export type JobEventKind =
  | 'created'
  | 'assigned'
  | 'status'
  | 'stopArrived'
  | 'stopDeparted'
  | 'stopCompleted'
  | 'stopSkipped'
  | 'checklist'
  | 'attachment'
  | 'note'
  | 'updated'
  | 'late'
export interface JobEvent {
  id: number
  jobId: number
  time: string
  userId: number | null
  kind: JobEventKind | string
  data: Record<string, unknown>
}

/** Planned route (`Route` in docs/API.md — renamed to avoid clashing with react-router). */
export interface FleetRoute {
  id: number
  name: string
  color: string
  /** [[lng, lat], ...] ≥ 2 points */
  path: Array<[number, number]>
  /** meters each side */
  corridor: number
  deviceIds: number[]
  minDeviationSeconds: number
  createdAt: string
  updatedAt?: string
}
export type RouteInput = Pick<FleetRoute, 'name' | 'color' | 'path' | 'corridor' | 'deviceIds' | 'minDeviationSeconds'>

export type SchedulePeriod = 'yesterday' | 'today' | 'lastWeek' | 'thisWeek' | 'lastMonth' | 'thisMonth'
export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly'
export interface ReportSchedule {
  id: number
  name: string
  reportType: ReportType | string
  filters: { deviceIds: number[]; groupId: number | null; driverId: number | null }
  period: SchedulePeriod
  frequency: ScheduleFrequency
  hour: number
  /** 0 = Sunday … 6 = Saturday (weekly) */
  weekday: number
  /** 1–28 (monthly) */
  monthDay: number
  timezone: string
  format: 'pdf' | 'xlsx' | 'csv'
  telegramUserIds: number[]
  emails: string[]
  enabled: boolean
  lastRunAt: string | null
  lastStatus: 'ok' | 'error' | null
  lastError: string
  nextRunAt: string | null
  createdBy?: number | null
  createdAt?: string
}
export type ReportScheduleInput = Omit<ReportSchedule, 'id' | 'lastRunAt' | 'lastStatus' | 'lastError' | 'nextRunAt' | 'createdBy' | 'createdAt'>
export interface ScheduleRun {
  time: string
  status: 'ok' | 'error'
  error: string
  /** successful deliveries: "telegram:<user email>" / "email:<address>" */
  recipients: string[] | string
  /** true for "Send now" runs */
  manual?: boolean
}

export const SENSOR_TYPES = ['fuel', 'temperature', 'humidity', 'voltage', 'generic'] as const
export type SensorType = (typeof SENSOR_TYPES)[number]
export interface Sensor {
  id: number
  deviceId: number
  name: string
  type: SensorType
  /** position attribute key: io<ID>, fuel, power, temp1 … */
  source: string
  /** [raw, value] points; [] = use multiplier/offset */
  calibration: Array<[number, number]>
  multiplier: number
  offset: number
  unit: string
  decimals: number
  min: number | null
  max: number | null
  tankCapacity: number | null
  fuelDropThreshold: number | null
  fuelFillThreshold: number | null
  smoothing: number
  createdAt: string
}
export type SensorInput = Omit<Sensor, 'id' | 'createdAt'>

export interface DeviceSensorValue {
  id: number
  name: string
  type: SensorType | string
  value: number | null
  unit: string
  time: string | null
}

export interface DriverMe {
  user: User
  driver: Driver
  vehicle: Device | null
}
