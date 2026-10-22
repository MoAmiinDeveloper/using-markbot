import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { ApiError } from './client'
import { toast } from '@/store/toast'

const reportError = (e: unknown) => {
  if (e instanceof ApiError && e.status === 401) return
  toast.error('Something went wrong', e instanceof Error ? e.message : String(e))
}

/**
 * Shared QueryClient. Exported as a module singleton so non-React code (the live
 * WebSocket connection) can patch and invalidate cached queries.
 */
export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (e, q) => {
      if (q.meta?.silent) return
      reportError(e)
    },
  }),
  mutationCache: new MutationCache({
    onError: (e, _v, _c, m) => {
      if (m.meta?.silent) return
      reportError(e)
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
    },
  },
})
