import { useQuery } from '@tanstack/react-query'
import { api, qk } from '@/api/client'
import type { Driver, Group, Place } from '@/api/types'

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
