import { format } from 'date-fns'

export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'never'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60 ? `${m % 60}m ` : ''}ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return format(t, 'd MMM yyyy')
}

export const fmtSpeed = (kmh: number | null | undefined) => (kmh == null ? '—' : `${Math.round(kmh)} km/h`)

export function fmtDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  if (meters < 100_000) return `${(meters / 1000).toFixed(1)} km`
  return `${Math.round(meters / 1000).toLocaleString()} km`
}

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`
  if (m > 0) return `${m}m ${(s % 60).toString().padStart(2, '0')}s`
  return `${s}s`
}

export const fmtCoord = (lat: number, lng: number) => `${lat.toFixed(6)}, ${lng.toFixed(6)}`

export const fmtTime = (iso: string | number) => format(typeof iso === 'number' ? iso : Date.parse(iso), 'HH:mm:ss')
export const fmtDateTime = (iso: string | number) =>
  format(typeof iso === 'number' ? iso : Date.parse(iso), 'd MMM yyyy, HH:mm:ss')
export const fmtShortDateTime = (iso: string | number) =>
  format(typeof iso === 'number' ? iso : Date.parse(iso), 'd MMM, HH:mm')

export function fmtVoltage(v: unknown): string {
  if (typeof v !== 'number') return '—'
  return `${v.toFixed(v >= 100 ? 0 : 1)} V`
}

export function fmtOdometer(v: unknown): string {
  if (typeof v !== 'number') return '—'
  // odometer attribute is in meters
  return `${Math.round(v / 1000).toLocaleString()} km`
}

export function headingLabel(course: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round((((course % 360) + 360) % 360) / 45) % 8]
}
