import { create } from 'zustand'
import type { User } from '@/api/types'
import { readLS, writeLS } from '@/lib/storage'

const TOKEN_KEY = 'fleet.token'
const USER_KEY = 'fleet.user'

function loadUser(): User | null {
  const raw = readLS(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

interface AuthState {
  token: string | null
  user: User | null
  /** set when the session ended because of a 401, shown on the login screen */
  reason: 'expired' | null
  login: (token: string, user: User) => void
  setUser: (user: User) => void
  logout: (reason?: 'expired') => void
}

export const useAuth = create<AuthState>((set) => ({
  token: readLS(TOKEN_KEY),
  user: loadUser(),
  reason: null,
  login: (token, user) => {
    writeLS(TOKEN_KEY, token)
    writeLS(USER_KEY, JSON.stringify(user))
    set({ token, user, reason: null })
  },
  setUser: (user) => {
    writeLS(USER_KEY, JSON.stringify(user))
    set({ user })
  },
  logout: (reason) => {
    writeLS(TOKEN_KEY, null)
    writeLS(USER_KEY, null)
    set({ token: null, user: null, reason: reason ?? null })
  },
}))
