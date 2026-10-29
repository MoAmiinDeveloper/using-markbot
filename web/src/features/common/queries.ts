import { useQuery } from '@tanstack/react-query'
import { api, qk } from '@/api/client'
import type { CustomEvent, Driver, Group, ParamDef, Place } from '@/api/types'

/** Shared, long-lived lookups (groups, drivers, places, settings). Failures stay silent: callers degrade. */
export function useGroups(enabled = true) {
  return useQuery<Group[]>({ queryKey: qk.groups, queryFn: api.groups, staleTime: 5 * 60_000, enabled, meta: { silent: true } })
}

export function useDrivers(enabled = true) {
  return useQuery<Driver[]>({ queryKey: qk.drivers, queryFn: api.drivers, staleTime: 2 * 60_000, enabled, meta: { silent: true } })
}

export function usePlaces(enabled = true) {
  return useQuery<Place[]>({ queryKey: qk.places, queryFn: api.places, staleTime: 5 * 60_000, enabled, meta: { silent: true } })
}

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: api.settings, staleTime: 5 * 60_000, meta: { silent: true } })
}

export function useCurrency(): string {
  return useSettings().data?.currency || 'USD'
}

/** Parameter names and calculated parameters (kept fresh by the live 'params' message). */
export function useParamDefs(enabled = true) {
  return useQuery<ParamDef[]>({ queryKey: qk.params, queryFn: () => api.params(), staleTime: 10 * 60_000, enabled, meta: { silent: true } })
}

export function useCustomEvents(enabled = true) {
  return useQuery<CustomEvent[]>({ queryKey: qk.customEvents, queryFn: api.customEvents, staleTime: 60_000, enabled, meta: { silent: true } })
}
