// Types mirroring docs/API.md (v1 + Phase 2 additions). Keep in sync with the contract.

export type Role = 'admin' | 'user'

export interface User {
  id: number
  email: string
  name: string
  role: Role
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
  'commandResult',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

/** Event types users can configure notifications for (commandResult is in-app only). */
export const NOTIFY_EVENT_TYPES = ['geofenceEnter', 'geofenceExit', 'overspeed', 'ignitionOn', 'ignitionOff', 'alarm'] as const
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
}

export type SettingsPatch = Partial<Pick<Settings, 'speedLimit' | 'overspeedMinDuration' | 'telegramBotToken'>>

export interface ChannelPrefs {
  inApp: boolean
  telegram: boolean
  push: boolean
}
export type Channel = keyof ChannelPrefs

export interface NotificationPrefs {
  telegramLinked: boolean
  push: { enabled: boolean }
  events: Record<NotifyEventType, ChannelPrefs>
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
