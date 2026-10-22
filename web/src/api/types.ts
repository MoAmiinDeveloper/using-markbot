// Types mirroring docs/API.md (v1). Keep in sync with the contract.

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
}

export interface DeviceInput {
  name: string
  imei: string
  protocol?: string
  plate?: string
  model?: string
  category?: string
  phone?: string
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

export type WsMessage =
  | { type: 'position'; data: Position }
  | { type: 'device'; data: Device }
  | { type: 'deleted'; data: { id: number } }
