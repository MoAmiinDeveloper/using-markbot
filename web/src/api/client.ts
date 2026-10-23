import { API_BASE } from '@/config'
import { useAuth } from '@/store/auth'
import type {
  CompleteMaintenanceInput,
  DashboardData,
  Driver,
  DriverInput,
  Expense,
  ExpenseInput,
  ExpenseQuery,
  Geocode,
  Group,
  GroupInput,
  Maintenance,
  MaintenanceInput,
  MePatch,
  Place,
  PlaceInput,
  PublicShare,
  Reminder,
  ReminderInput,
  Report,
  ReportFormat,
  ReportQuery,
  ServiceRecord,
  Share,
  UserInput,
  Command,
  CommandType,
  Device,
  DeviceInput,
  EventQuery,
  FleetEvent,
  Geofence,
  GeofenceInput,
  LoginResponse,
  NotificationPrefs,
  Position,
  Settings,
  SettingsPatch,
  Summary,
  TelegramLink,
  TestNotificationResult,
  Trip,
  User,
} from './types'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type Query = Record<string, string | number | undefined>

function qs(q?: Query): string {
  if (!q) return ''
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query, auth = true): Promise<T> {
  const token = auth ? useAuth.getState().token : null
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}${qs(query)}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.')
  }

  if (res.status === 401 && auth && path !== '/auth/login') {
    useAuth.getState().logout('expired')
    throw new ApiError(401, 'Your session has expired. Please sign in again.')
  }
  if (res.status === 204) return undefined as T

  const text = await res.text()
  let data: unknown = undefined
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = undefined
    }
  }
  if (!res.ok) {
    const msg =
      (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : null) ?? `Request failed (${res.status})`
    throw new ApiError(res.status, msg)
  }
  return data as T
}

export const api = {
  login: (email: string, password: string) => request<LoginResponse>('POST', '/auth/login', { email, password }),
  me: () => request<User>('GET', '/me'),

  devices: () => request<Device[]>('GET', '/devices'),
  device: (id: number) => request<Device>('GET', `/devices/${id}`),
  createDevice: (input: DeviceInput) => request<Device>('POST', '/devices', input),
  updateDevice: (id: number, input: Partial<DeviceInput>) => request<Device>('PATCH', `/devices/${id}`, input),
  deleteDevice: (id: number) => request<void>('DELETE', `/devices/${id}`),

  positions: (id: number, from: string, to: string, limit?: number) =>
    request<Position[]>('GET', `/devices/${id}/positions`, undefined, { from, to, limit }),
  trips: (id: number, from: string, to: string) =>
    request<Trip[]>('GET', `/devices/${id}/trips`, undefined, { from, to }),

  summary: () => request<Summary>('GET', '/summary'),

  // ---- Phase 2
  events: (q: EventQuery = {}) =>
    request<FleetEvent[]>('GET', '/events', undefined, {
      deviceId: q.deviceId,
      type: q.type,
      from: q.from,
      to: q.to,
      limit: q.limit,
    }),

  geofences: () => request<Geofence[]>('GET', '/geofences'),
  createGeofence: (input: GeofenceInput) => request<Geofence>('POST', '/geofences', input),
  updateGeofence: (id: number, input: Partial<GeofenceInput>) => request<Geofence>('PATCH', `/geofences/${id}`, input),
  deleteGeofence: (id: number) => request<void>('DELETE', `/geofences/${id}`),

  commands: (deviceId: number, limit = 20) =>
    request<Command[]>('GET', `/devices/${deviceId}/commands`, undefined, { limit }),
  sendCommand: (deviceId: number, type: CommandType, text?: string) =>
    request<Command>('POST', `/devices/${deviceId}/commands`, text !== undefined ? { type, text } : { type }),

  settings: () => request<Settings>('GET', '/settings'),
  updateSettings: (patch: SettingsPatch) => request<Settings>('PATCH', '/settings', patch),
  regenerateTraccarToken: () => request<Settings>('POST', '/settings/traccar-token'),

  notificationPrefs: () => request<NotificationPrefs>('GET', '/me/notifications'),
  updateNotificationPrefs: (events: NotificationPrefs['events']) =>
    request<NotificationPrefs>('PUT', '/me/notifications', { events }),
  telegramLink: () => request<TelegramLink>('POST', '/me/telegram/link'),
  telegramUnlink: () => request<void>('DELETE', '/me/telegram'),
  testNotification: () => request<TestNotificationResult>('POST', '/me/notifications/test'),

  vapidKey: () => request<{ publicKey: string }>('GET', '/push/vapid-key'),
  pushSubscribe: (sub: PushSubscriptionJSON) => request<unknown>('POST', '/push/subscriptions', sub),
  pushUnsubscribe: (endpoint: string) => request<void>('DELETE', '/push/subscriptions', { endpoint }),

  // ---- Phase 3: access control
  updateMe: (patch: MePatch) => request<User>('PATCH', '/me', patch),
  groups: () => request<Group[]>('GET', '/groups'),
  createGroup: (input: GroupInput) => request<Group>('POST', '/groups', input),
  updateGroup: (id: number, input: Partial<GroupInput>) => request<Group>('PATCH', `/groups/${id}`, input),
  deleteGroup: (id: number) => request<void>('DELETE', `/groups/${id}`),
  users: () => request<User[]>('GET', '/users'),
  createUser: (input: UserInput) => request<User>('POST', '/users', input),
  updateUser: (id: number, input: Partial<UserInput>) => request<User>('PATCH', `/users/${id}`, input),
  deleteUser: (id: number) => request<void>('DELETE', `/users/${id}`),

  // drivers
  drivers: () => request<Driver[]>('GET', '/drivers'),
  createDriver: (input: DriverInput) => request<Driver>('POST', '/drivers', input),
  updateDriver: (id: number, input: Partial<DriverInput>) => request<Driver>('PATCH', `/drivers/${id}`, input),
  deleteDriver: (id: number) => request<void>('DELETE', `/drivers/${id}`),

  // maintenance & reminders
  maintenance: (deviceId?: number) => request<Maintenance[]>('GET', '/maintenance', undefined, { deviceId }),
  createMaintenance: (input: MaintenanceInput) => request<Maintenance>('POST', '/maintenance', input),
  updateMaintenance: (id: number, input: Partial<MaintenanceInput>) => request<Maintenance>('PATCH', `/maintenance/${id}`, input),
  deleteMaintenance: (id: number) => request<void>('DELETE', `/maintenance/${id}`),
  completeMaintenance: (id: number, input: CompleteMaintenanceInput) =>
    request<Maintenance>('POST', `/maintenance/${id}/complete`, input),
  maintenanceHistory: (id: number) => request<ServiceRecord[]>('GET', `/maintenance/${id}/history`),
  reminders: (q: { deviceId?: number; driverId?: number } = {}) => request<Reminder[]>('GET', '/reminders', undefined, q),
  createReminder: (input: ReminderInput) => request<Reminder>('POST', '/reminders', input),
  updateReminder: (id: number, input: Partial<ReminderInput>) => request<Reminder>('PATCH', `/reminders/${id}`, input),
  deleteReminder: (id: number) => request<void>('DELETE', `/reminders/${id}`),

  // expenses
  expenses: (q: ExpenseQuery = {}) =>
    request<Expense[]>('GET', '/expenses', undefined, { deviceId: q.deviceId, from: q.from, to: q.to, category: q.category }),
  createExpense: (input: ExpenseInput) => request<Expense>('POST', '/expenses', input),
  updateExpense: (id: number, input: Partial<ExpenseInput>) => request<Expense>('PATCH', `/expenses/${id}`, input),
  deleteExpense: (id: number) => request<void>('DELETE', `/expenses/${id}`),

  // share live location
  createShare: (deviceId: number, hours: number) => request<Share>('POST', `/devices/${deviceId}/share`, { hours }),
  shares: (deviceId: number) => request<Share[]>('GET', `/devices/${deviceId}/shares`),
  revokeShare: (token: string) => request<void>('DELETE', `/shares/${encodeURIComponent(token)}`),
  publicShare: (token: string) =>
    request<PublicShare>('GET', `/public/share/${encodeURIComponent(token)}`, undefined, undefined, false),

  // places & geocoding
  places: () => request<Place[]>('GET', '/places'),
  createPlace: (input: PlaceInput) => request<Place>('POST', '/places', input),
  updatePlace: (id: number, input: Partial<PlaceInput>) => request<Place>('PATCH', `/places/${id}`, input),
  deletePlace: (id: number) => request<void>('DELETE', `/places/${id}`),
  geocode: (lat: number, lng: number) => request<Geocode>('GET', '/geocode', undefined, { lat, lng }),

  // reports & dashboard
  report: (type: string, q: ReportQuery) => request<Report>('GET', `/reports/${type}`, undefined, reportQuery(q)),
  dashboard: (days: number) => request<DashboardData>('GET', '/dashboard', undefined, { days }),
}

function reportQuery(q: ReportQuery, format?: ReportFormat): Query {
  return {
    deviceIds: q.deviceIds?.length ? q.deviceIds.join(',') : undefined,
    groupId: q.groupId,
    driverId: q.driverId,
    from: q.from,
    to: q.to,
    format,
  }
}

const EXT: Record<Exclude<ReportFormat, 'json'>, string> = { csv: 'csv', xlsx: 'xlsx', pdf: 'pdf' }

/** Download a report export with the auth header (a plain link can't carry the bearer token). */
export async function downloadReport(type: string, q: ReportQuery, format: Exclude<ReportFormat, 'json'>): Promise<string> {
  const token = useAuth.getState().token
  let res: Response
  try {
    res = await fetch(`${API_BASE}/reports/${type}${qs(reportQuery(q, format))}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.')
  }
  if (res.status === 401) {
    useAuth.getState().logout('expired')
    throw new ApiError(401, 'Your session has expired. Please sign in again.')
  }
  if (!res.ok) {
    let msg = `Export failed (${res.status})`
    try {
      const j = (await res.json()) as { error?: string }
      if (j?.error) msg = j.error
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, msg)
  }
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') ?? ''
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)
  const name = m ? decodeURIComponent(m[1]) : `${type}-report-${q.from.slice(0, 10)}_${q.to.slice(0, 10)}.${EXT[format]}`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
  return name
}

/** Query keys shared between pages and the live connection (which patches/invalidates them). */
export const qk = {
  events: (q?: EventQuery) => (q ? (['events', q] as const) : (['events'] as const)),
  geofences: ['geofences'] as const,
  commands: (deviceId: number) => ['commands', deviceId] as const,
  settings: ['settings'] as const,
  notificationPrefs: ['notificationPrefs'] as const,
  groups: ['groups'] as const,
  users: ['users'] as const,
  drivers: ['drivers'] as const,
  maintenance: ['maintenance'] as const,
  reminders: ['reminders'] as const,
  expenses: (q?: ExpenseQuery) => (q ? (['expenses', q] as const) : (['expenses'] as const)),
  places: ['places'] as const,
  shares: (deviceId: number) => ['shares', deviceId] as const,
  geocode: (lat: number, lng: number) => ['geocode', lat.toFixed(4), lng.toFixed(4)] as const,
  report: (type: string, q: ReportQuery) => ['report', type, q] as const,
  dashboard: (days: number) => ['dashboard', days] as const,
}

export function wsUrl(token: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}${API_BASE}/ws?token=${encodeURIComponent(token)}`
}
