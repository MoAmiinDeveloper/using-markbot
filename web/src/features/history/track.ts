import type { Position, Trip } from '@/api/types'
import { bearing, haversine } from '@/lib/geo'

/** Max virtual seconds a gap between fixes may take during playback (stops are fast-forwarded). */
export const GAP_CAP_S = 30

export interface Track {
  positions: Position[]
  t: number[] // epoch ms per point
  vt: number[] // virtual seconds per point
  cum: number[] // cumulative distance (m)
  duration: number // virtual seconds
}

export function buildTrack(positions: Position[]): Track {
  const t: number[] = []
  const vt: number[] = []
  const cum: number[] = []
  let v = 0
  let d = 0
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]
    const ms = Date.parse(p.time)
    if (i > 0) {
      const prev = positions[i - 1]
      v += Math.min(Math.max(0, (ms - t[i - 1]) / 1000), GAP_CAP_S)
      d += haversine(prev.lat, prev.lng, p.lat, p.lng)
    }
    t.push(ms)
    vt.push(v)
    cum.push(d)
  }
  return { positions, t, vt, cum, duration: v }
}

export interface Sample {
  lng: number
  lat: number
  course: number
  speed: number
  time: number
  index: number
}

export function sampleAt(track: Track, v: number): Sample | null {
  const { positions: ps, vt, t } = track
  if (ps.length === 0) return null
  if (v <= 0 || ps.length === 1) return { lng: ps[0].lng, lat: ps[0].lat, course: ps[0].course, speed: ps[0].speed, time: t[0], index: 0 }
  const last = ps.length - 1
  if (v >= vt[last]) return { lng: ps[last].lng, lat: ps[last].lat, course: ps[last].course, speed: ps[last].speed, time: t[last], index: last }
  // binary search for vt[i] <= v < vt[i+1]
  let lo = 0
  let hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (vt[mid] <= v) lo = mid
    else hi = mid
  }
  const a = ps[lo]
  const b = ps[hi]
  const span = vt[hi] - vt[lo] || 1
  const k = (v - vt[lo]) / span
  const moved = a.lat !== b.lat || a.lng !== b.lng
  return {
    lng: a.lng + (b.lng - a.lng) * k,
    lat: a.lat + (b.lat - a.lat) * k,
    course: moved ? bearing(a.lat, a.lng, b.lat, b.lng) : a.course,
    speed: a.speed + (b.speed - a.speed) * k,
    time: t[lo] + (t[hi] - t[lo]) * k,
    index: lo,
  }
}

/** Virtual time for a real timestamp (for jumping to a trip start). */
export function virtualAt(track: Track, ms: number): number {
  const { t, vt } = track
  for (let i = 0; i < t.length; i++) if (t[i] >= ms) return vt[i]
  return track.duration
}

export interface TrackStats {
  distance: number
  maxSpeed: number
  avgSpeed: number
  duration: number // real seconds from first to last fix
  movingTime: number
  points: number
}

export function computeStats(track: Track): TrackStats {
  const ps = track.positions
  let max = 0
  let movingTime = 0
  let movingDist = 0
  for (let i = 0; i < ps.length; i++) {
    if (ps[i].speed > max) max = ps[i].speed
    if (i > 0 && ps[i - 1].speed > 3) {
      const dt = (track.t[i] - track.t[i - 1]) / 1000
      if (dt < 600) {
        movingTime += dt
        movingDist += track.cum[i] - track.cum[i - 1]
      }
    }
  }
  return {
    distance: track.cum[track.cum.length - 1] ?? 0,
    maxSpeed: max,
    avgSpeed: movingTime > 0 ? movingDist / movingTime * 3.6 : 0,
    duration: ps.length > 1 ? (track.t[ps.length - 1] - track.t[0]) / 1000 : 0,
    movingTime,
    points: ps.length,
  }
}

export interface Stop {
  lat: number
  lng: number
  start: string
  end: string
  duration: number
}

/** Stops are the gaps between consecutive trips. */
export function stopsFromTrips(trips: Trip[]): Stop[] {
  const out: Stop[] = []
  for (let i = 0; i < trips.length - 1; i++) {
    const a = trips[i]
    const b = trips[i + 1]
    out.push({
      lat: a.endLat,
      lng: a.endLng,
      start: a.end,
      end: b.start,
      duration: Math.max(0, (Date.parse(b.start) - Date.parse(a.end)) / 1000),
    })
  }
  return out
}

export const SPEED_STOPS: Array<[number, string]> = [
  [0, '#38bdf8'],
  [30, '#10b981'],
  [60, '#eab308'],
  [90, '#f97316'],
  [120, '#ef4444'],
]
