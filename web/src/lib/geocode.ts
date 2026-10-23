import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, qk } from '@/api/client'
import type { Geocode } from '@/api/types'

/**
 * Reverse-geocode a coordinate through the server (/geocode, which caches and rate-limits).
 * Client side: coordinates are rounded to ~10 m for the cache key, debounced so a moving
 * vehicle doesn't fire a lookup per fix, and results are cached for the session.
 */
export function useAddress(lat: number | null | undefined, lng: number | null | undefined, debounceMs = 800) {
  const [key, setKey] = useState<[number, number] | null>(
    lat != null && lng != null ? [round(lat), round(lng)] : null,
  )
  useEffect(() => {
    if (lat == null || lng == null) {
      setKey(null)
      return
    }
    const next: [number, number] = [round(lat), round(lng)]
    if (key && key[0] === next[0] && key[1] === next[1]) return
    if (!key) {
      setKey(next)
      return
    }
    const t = window.setTimeout(() => setKey(next), debounceMs)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng])
  return useQuery<Geocode>({
    queryKey: key ? qk.geocode(key[0], key[1]) : ['geocode', 'none'],
    queryFn: () => queue(() => api.geocode(key![0], key![1])),
    enabled: !!key,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
    meta: { silent: true },
  })
}

const round = (v: number) => Math.round(v * 1e4) / 1e4

// The server geocoder is rate-limited (1 req/s upstream); keep at most 2 lookups in flight.
let active = 0
const waiting: Array<() => void> = []
function queue<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      active++
      fn()
        .then(resolve, reject)
        .finally(() => {
          active--
          waiting.shift()?.()
        })
    }
    if (active < 2) run()
    else waiting.push(run)
  })
}
