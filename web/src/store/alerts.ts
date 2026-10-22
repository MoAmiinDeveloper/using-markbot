import { create } from 'zustand'
import type { FleetEvent } from '@/api/types'
import { readLS, writeLS } from '@/lib/storage'

const MAX = 100
const MUTE_KEY = 'fleet.alerts.muted'
const seenKey = (userId: number | null) => `fleet.alerts.lastSeen.${userId ?? 'anon'}`

interface AlertsState {
  /** most recent events, newest first (seeded from /events, then live) */
  recent: FleetEvent[]
  loaded: boolean
  /** highest event id the user has acknowledged; persisted per user */
  lastSeenId: number
  userId: number | null
  muted: boolean
  setUser: (userId: number | null) => void
  setRecent: (events: FleetEvent[]) => void
  add: (e: FleetEvent) => void
  markAllRead: () => void
  toggleMuted: () => void
  reset: () => void
}

const byNewest = (a: FleetEvent, b: FleetEvent) => b.id - a.id

export const useAlerts = create<AlertsState>((set, get) => ({
  recent: [],
  loaded: false,
  lastSeenId: 0,
  userId: null,
  muted: readLS(MUTE_KEY) === '1',
  setUser: (userId) => {
    if (get().userId === userId) return
    set({ userId, lastSeenId: Number(readLS(seenKey(userId)) ?? 0) || 0 })
  },
  setRecent: (events) =>
    set((s) => {
      const ids = new Set(events.map((e) => e.id))
      // keep live events that arrived while the fetch was in flight
      const merged = [...events, ...s.recent.filter((e) => !ids.has(e.id))].sort(byNewest).slice(0, MAX)
      return { recent: merged, loaded: true }
    }),
  add: (e) =>
    set((s) => {
      if (s.recent.some((x) => x.id === e.id)) return s
      return { recent: [e, ...s.recent].sort(byNewest).slice(0, MAX) }
    }),
  markAllRead: () => {
    const max = get().recent.reduce((m, e) => Math.max(m, e.id), get().lastSeenId)
    writeLS(seenKey(get().userId), String(max))
    set({ lastSeenId: max })
  },
  toggleMuted: () => {
    const muted = !get().muted
    writeLS(MUTE_KEY, muted ? '1' : null)
    set({ muted })
  },
  reset: () => set({ recent: [], loaded: false }),
}))

export const useUnreadCount = () => useAlerts((s) => s.recent.reduce((n, e) => n + (e.id > s.lastSeenId ? 1 : 0), 0))
