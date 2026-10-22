import { create } from 'zustand'
import type { FleetEvent } from '@/api/types'

export type ToastKind = 'error' | 'success' | 'info' | 'event'
export interface Toast {
  id: number
  kind: ToastKind
  title: string
  message?: string
  /** live alert shown as a rich, clickable toast */
  event?: FleetEvent
  deviceName?: string
}

interface ToastState {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
}

let seq = 0

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = ++seq
    // de-duplicate identical messages that arrive in a burst
    if (get().toasts.some((x) => x.title === t.title && x.message === t.message)) return
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }))
    const ms = t.event ? (t.event.type === 'alarm' ? 15000 : 7000) : t.kind === 'error' ? 6000 : 3500
    window.setTimeout(() => get().dismiss(id), ms)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}))

export const toast = {
  error: (title: string, message?: string) => useToasts.getState().push({ kind: 'error', title, message }),
  success: (title: string, message?: string) => useToasts.getState().push({ kind: 'success', title, message }),
  info: (title: string, message?: string) => useToasts.getState().push({ kind: 'info', title, message }),
  event: (event: FleetEvent, deviceName?: string) =>
    useToasts.getState().push({ kind: 'event', title: event.message, message: `#${event.id}`, event, deviceName }),
}
