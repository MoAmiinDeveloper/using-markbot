import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, qk } from '@/api/client'
import type { FleetRoute, Job, JobInput, JobQuery, JobStatus, User } from '@/api/types'
import { toast } from '@/store/toast'
import { jobStatusMeta } from './meta'

export function useJobs(q: JobQuery) {
  return useQuery({ queryKey: qk.jobs(q), queryFn: () => api.jobs(q), staleTime: 30_000, refetchInterval: 120_000, placeholderData: (p) => p })
}

export function useJob(id: number | null, initial?: Job) {
  return useQuery({
    queryKey: qk.job(id ?? 0),
    queryFn: () => api.job(id!),
    enabled: id != null,
    initialData: initial,
    staleTime: 15_000,
  })
}

export function useRoutes(enabled = true) {
  return useQuery<FleetRoute[]>({ queryKey: qk.routes, queryFn: api.routes, staleTime: 5 * 60_000, enabled, meta: { silent: true } })
}

/** Users for name lookups (admin-only endpoint; others degrade to ids). */
export function useUsersLookup(enabled = true) {
  return useQuery<User[]>({ queryKey: qk.users, queryFn: api.users, staleTime: 5 * 60_000, enabled, retry: false, meta: { silent: true } })
}

/** Write a job everywhere it's cached. */
export function useStoreJob() {
  const qc = useQueryClient()
  return (j: Job, removed = false) => {
    qc.setQueriesData<Job[]>({ queryKey: qk.jobs() }, (l) => {
      if (!Array.isArray(l)) return l
      if (removed) return l.filter((x) => x.id !== j.id)
      const i = l.findIndex((x) => x.id === j.id)
      if (i === -1) return [j, ...l]
      const n = l.slice()
      n[i] = j
      return n
    })
    if (!removed) qc.setQueryData(qk.job(j.id), j)
    void qc.invalidateQueries({ queryKey: qk.jobs() })
    void qc.invalidateQueries({ queryKey: qk.jobTimeline(j.id) })
  }
}

export function useJobStatus() {
  const store = useStoreJob()
  return useMutation({
    meta: { silent: true },
    mutationFn: ({ job, status, reason }: { job: Job; status: JobStatus; reason?: string }) => api.setJobStatus(job.id, status, reason),
    onSuccess: (j, v) => {
      store(j ?? { ...v.job, status: v.status })
      toast.success(`${v.job.reference}: ${jobStatusMeta(v.status).label}`)
    },
    onError: (e) =>
      toast.error(
        'Status not changed',
        e instanceof ApiError && e.status === 409 ? 'That transition isn’t allowed from the job’s current status.' : e instanceof Error ? e.message : String(e),
      ),
  })
}

export function useSaveJob(onDone?: (j: Job) => void) {
  const store = useStoreJob()
  return useMutation({
    meta: { silent: true },
    mutationFn: ({ id, input }: { id: number | null; input: JobInput }) => (id == null ? api.createJob(input) : api.updateJob(id, input)),
    onSuccess: (j, v) => {
      store(j)
      toast.success(v.id == null ? 'Job created' : 'Job saved', `${j.reference} · ${j.title}`)
      onDone?.(j)
    },
    onError: (e) => toast.error('Could not save the job', e instanceof ApiError ? e.message : String(e)),
  })
}
