import { useQuery } from '@tanstack/react-query'
import { api, qk } from '@/api/client'

/** All geofences; kept fresh by the WebSocket `geofences` message (no polling). */
export function useGeofences(enabled = true, silent = false) {
  return useQuery({
    queryKey: qk.geofences,
    queryFn: api.geofences,
    enabled,
    staleTime: Infinity,
    meta: silent ? { silent: true } : undefined,
  })
}
