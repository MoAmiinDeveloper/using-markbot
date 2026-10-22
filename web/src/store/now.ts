import { create } from 'zustand'

/** A shared clock ticking every few seconds so "x ago" labels stay fresh without per-row timers. */
export const useNowStore = create<{ now: number }>(() => ({ now: Date.now() }))

let timer: number | undefined
export function startClock(intervalMs = 5000) {
  if (timer !== undefined) return
  timer = window.setInterval(() => useNowStore.setState({ now: Date.now() }), intervalMs)
}

export const useNow = () => useNowStore((s) => s.now)
