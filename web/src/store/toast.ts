import { create } from 'zustand'

export type ToastKind = 'error' | 'success' | 'info'
export interface Toast {
  id: number
  kind: ToastKind
  title: string
  message?: string
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
    window.setTimeout(() => get().dismiss(id), t.kind === 'error' ? 6000 : 3500)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}))

export const toast = {
  error: (title: string, message?: string) => useToasts.getState().push({ kind: 'error', title, message }),
  success: (title: string, message?: string) => useToasts.getState().push({ kind: 'success', title, message }),
  info: (title: string, message?: string) => useToasts.getState().push({ kind: 'info', title, message }),
}
