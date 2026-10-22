import { API_BASE } from '@/config'
import { useAuth } from '@/store/auth'
import type { Device, DeviceInput, LoginResponse, Position, Summary, Trip, User } from './types'

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

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const token = useAuth.getState().token
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

  if (res.status === 401 && path !== '/auth/login') {
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
}

export function wsUrl(token: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}${API_BASE}/ws?token=${encodeURIComponent(token)}`
}
