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

/** Report-style duration: "2h 14m", "14m", "45s", "3d 4h". */
export function fmtDurationHM(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const s = Math.max(0, Math.round(seconds))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

const moneyFmt = new Map<string, Intl.NumberFormat>()
export function fmtMoney(v: number | null | undefined, currency = 'USD', compact = false): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const key = `${currency}|${compact}`
  let f = moneyFmt.get(key)
  if (!f) {
    try {
      f = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        maximumFractionDigits: compact ? 0 : 2,
        minimumFractionDigits: compact ? 0 : 2,
      })
    } catch {
      f = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })
    }
    moneyFmt.set(key, f)
  }
  return f.format(v)
}

export function fmtNumber(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const d = Number.isInteger(v) ? 0 : digits
  return v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d })
}

/** Device odometer is km (Phase 3), shown without decimals. */
export const fmtKm = (km: number | null | undefined) => (km == null ? '—' : `${Math.round(km).toLocaleString()} km`)
export const fmtHours = (h: number | null | undefined) => (h == null ? '—' : `${h.toLocaleString(undefined, { maximumFractionDigits: 1 })} h`)

/** Date-only ("2026-12-31") → "31 Dec 2026". */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const t = Date.parse(d.length === 10 ? `${d}T00:00:00` : d)
  return Number.isNaN(t) ? d : format(t, 'd MMM yyyy')
}

/** Whole days from today (local) until a YYYY-MM-DD date; negative when past. */
export function daysUntil(d: string | null | undefined, now = Date.now()): number | null {
  if (!d) return null
  const t = Date.parse(d.length === 10 ? `${d}T00:00:00` : d)
  if (Number.isNaN(t)) return null
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  return Math.round((t - today.getTime()) / 86400000)
}

export const todayISO = () => format(Date.now(), 'yyyy-MM-dd')
