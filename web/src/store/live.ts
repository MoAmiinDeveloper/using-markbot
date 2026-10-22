import { create } from 'zustand'
import type { Device, Position } from '@/api/types'
import { statusFromPosition } from '@/lib/status'

export type WsState = 'idle' | 'connecting' | 'open' | 'reconnecting'

interface LiveState {
  byId: Record<number, Device>
  loaded: boolean
  error: string | null
  ws: WsState
  /** ms timestamp of the last frame received */
  lastMessageAt: number | null
  setAll: (devices: Device[]) => void
  upsert: (d: Device) => void
  remove: (id: number) => void
  applyBatch: (devices: Device[], positions: Position[], deleted: number[]) => void
  setWs: (s: WsState) => void
  setError: (e: string | null) => void
  reset: () => void
}

export const useLive = create<LiveState>((set) => ({
  byId: {},
  loaded: false,
  error: null,
  ws: 'idle',
  lastMessageAt: null,
  setAll: (devices) => {
    const byId: Record<number, Device> = {}
    for (const d of devices) byId[d.id] = d
    set({ byId, loaded: true, error: null })
  },
  upsert: (d) => set((s) => ({ byId: { ...s.byId, [d.id]: d } })),
  remove: (id) =>
    set((s) => {
      const byId = { ...s.byId }
      delete byId[id]
      return { byId }
    }),
  applyBatch: (devices, positions, deleted) =>
    set((s) => {
      const byId = { ...s.byId }
      for (const d of devices) byId[d.id] = d
      for (const p of positions) {
        const cur = byId[p.deviceId]
        if (!cur) continue
        // ignore out-of-order fixes (e.g. buffered records replayed by the tracker)
        if (cur.position && Date.parse(cur.position.time) > Date.parse(p.time)) continue
        byId[p.deviceId] = {
          ...cur,
          position: p,
          lastSeen: p.serverTime || p.time,
          status: statusFromPosition(p),
        }
      }
      for (const id of deleted) delete byId[id]
      return { byId, lastMessageAt: Date.now() }
    }),
  setWs: (ws) => set({ ws }),
  setError: (error) => set({ error }),
  reset: () => set({ byId: {}, loaded: false, error: null, ws: 'idle', lastMessageAt: null }),
}))

const byName = (a: Device, b: Device) => a.name.localeCompare(b.name, undefined, { numeric: true })

let cacheSrc: Record<number, Device> | null = null
let cacheList: Device[] = []
/** Stable, name-sorted array of devices (memoized on the byId identity). */
export function selectDeviceList(s: LiveState): Device[] {
  if (s.byId !== cacheSrc) {
    cacheSrc = s.byId
    cacheList = Object.values(s.byId).sort(byName)
  }
  return cacheList
}

export const useDeviceList = () => useLive(selectDeviceList)
export const useDevice = (id: number | null | undefined) => useLive((s) => (id == null ? undefined : s.byId[id]))
