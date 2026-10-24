import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import {
  CalendarClock,
  Check,
  CircleAlert,
  Clock,
  Copy,
  MapPin,
  Maximize2,
  Pencil,
  Phone,
  Route as RouteIcon,
  StickyNote,
  Trash2,
  Truck,
  UserRound,
  X,
} from 'lucide-react'
import { api } from '@/api/client'
import type { Job, JobStatus } from '@/api/types'
import { MapCanvas } from '@/components/map/MapCanvas'
import { VehicleLayer } from '@/components/map/VehicleLayer'
import { RoutesLayer } from '@/components/map/RoutesLayer'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { StatusPill } from '@/components/ui/Misc'
import { Tabs } from '@/components/ui/Tabs'
import { useDrivers } from '@/features/common/queries'
import { useAccess } from '@/lib/access'
import { fmtDateTime, fmtShortDateTime } from '@/lib/format'
import { useLive } from '@/store/live'
import { useNow } from '@/store/now'
import { toast } from '@/store/toast'
import { cn } from '@/lib/cn'
import { AttachmentsGallery } from './Attachments'
import { DriverAvatar, JobStatusPill, LateBadge, PriorityPill, fmtWhen } from './JobBits'
import { DISPATCH_TRANSITIONS, NEEDS_REASON, isTerminal, jobStatusMeta, lateBy, stopMeta, stopProgress } from './meta'
import { useJobStatus, useRoutes, useStoreJob } from './queries'
import { FitStops, StopsLayer } from './StopsLayer'
import { JobTimeline } from './Timeline'

type Tab = 'details' | 'stops' | 'checklist' | 'timeline' | 'files'

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span className="mt-0.5 text-slate-400 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</p>
        <div className="mt-0.5 text-[13px] text-slate-900 dark:text-white">{children}</div>
      </div>
    </div>
  )
}

/** Map of a job: stops, planned route, assigned vehicle. */
export function JobMap({ job, className, tall }: { job: Job; className?: string; tall?: boolean }) {
  const device = useLive((s) => (job.deviceId != null ? s.byId[job.deviceId] : undefined))
  const routes = useRoutes(job.routeId != null)
  const route = routes.data?.find((r) => r.id === job.routeId)
  const pts: Array<[number, number]> = job.stops.map((s) => [s.lng, s.lat])
  if (device?.position && !isTerminal(job.status)) pts.push([device.position.lng, device.position.lat])
  const [fit, setFit] = useState(0)
  return (
    <div className={cn('relative overflow-hidden', className)}>
      <MapCanvas className="absolute inset-0" attribution={false}>
        {route && <RoutesLayer routes={[route]} prefix="job-route" labels={false} />}
        <StopsLayer stops={job.stops.map((s) => ({ ...s, name: s.name }))} prefix="job-stops" />
        {device && <VehicleLayer devices={[device]} cluster={false} hover={false} />}
        <FitStops points={pts} fitKey={`${job.id}:${fit}:${tall ? 1 : 0}`} padding={{ top: 36, left: 36, right: 36, bottom: 84 }} />
      </MapCanvas>
      <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-end justify-between gap-2">
        <div className="glass pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-600 dark:text-slate-300">
          {(['pending', 'arrived', 'completed', 'skipped'] as const).map((s) => (
            <span key={s} className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: stopMeta(s).color }} />
              {stopMeta(s).label}
            </span>
          ))}
          {route && (
            <span className="inline-flex items-center gap-1">
              <span className="h-1 w-3 rounded-full" style={{ background: route.color }} />
              {route.name}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setFit((f) => f + 1)}
          aria-label="Fit job on map"
          title="Fit job on map"
          className="glass pointer-events-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function StatusActions({ job }: { job: Job }) {
  const st = useJobStatus()
  const [reasonFor, setReasonFor] = useState<JobStatus | null>(null)
  const [reason, setReason] = useState('')
  const reopen = job.status === 'failed' || job.status === 'cancelled'
  const options = DISPATCH_TRANSITIONS[job.status].filter((s) => s !== 'assigned' || job.driverId != null)
  if (!options.length) return null
  const forward = reopen ? options.slice(0, 1) : options.filter((s) => !NEEDS_REASON.includes(s) && s !== 'unassigned').slice(0, 2)
  const negative = reopen ? [] : options.filter((s) => NEEDS_REASON.includes(s) || s === 'unassigned')
  const go = (s: JobStatus) => {
    if (NEEDS_REASON.includes(s)) {
      setReason('')
      setReasonFor(s)
    } else st.mutate({ job, status: s })
  }
  const label = (s: JobStatus) =>
    reopen ? 'Reopen' : s === 'enRoute' && (job.status === 'arrived' || job.status === 'inProgress') ? 'Next stop' : jobStatusMeta(s).action
  return (
    <div className="flex flex-wrap gap-2">
      {forward.map((s, i) => {
        const Icon = jobStatusMeta(s).icon
        return (
          <Button
            key={s}
            size="sm"
            variant={i === 0 ? 'primary' : 'secondary'}
            icon={<Icon className="h-3.5 w-3.5" />}
            loading={st.isPending && st.variables?.status === s}
            onClick={() => go(s)}
          >
            {label(s)}
          </Button>
        )
      })}
      {negative.map((s) => (
        <Button
          key={s}
          size="sm"
          variant="ghost"
          onClick={() => go(s)}
          className={s === 'failed' ? 'hover:!text-rose-600 dark:hover:!text-rose-400' : undefined}
        >
          {s === 'failed' ? 'Mark failed…' : s === 'unassigned' ? 'Unassign' : 'Cancel job…'}
        </Button>
      ))}
      <Modal
        open={!!reasonFor}
        onClose={() => !st.isPending && setReasonFor(null)}
        title={reasonFor === 'failed' ? `Mark ${job.reference} as failed?` : `Cancel ${job.reference}?`}
        description={reasonFor === 'failed' ? 'The driver will see the job as failed. Add the reason for the record.' : 'The job is removed from the driver’s list.'}
        footer={
          <>
            <Button onClick={() => setReasonFor(null)} disabled={st.isPending}>
              Back
            </Button>
            <Button
              variant="danger"
              loading={st.isPending}
              disabled={reasonFor === 'failed' && !reason.trim()}
              onClick={() => reasonFor && st.mutate({ job, status: reasonFor, reason: reason.trim() || undefined }, { onSuccess: () => setReasonFor(null) })}
            >
              {reasonFor === 'failed' ? 'Mark failed' : 'Cancel job'}
            </Button>
          </>
        }
      >
        <div className="mt-4">
          <Field label="Reason" required={reasonFor === 'failed'}>
            {(id) => (
              <Textarea
                id={id}
                data-autofocus
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={reasonFor === 'failed' ? 'Customer not available, shop closed…' : 'Optional'}
              />
            )}
          </Field>
        </div>
      </Modal>
    </div>
  )
}

export function JobPanel({
  job,
  onClose,
  onEdit,
  layout = 'pane',
}: {
  job: Job
  onClose: () => void
  onEdit: () => void
  /** pane = docked right column; sheet = overlay */
  layout?: 'pane' | 'sheet'
}) {
  const { canManage } = useAccess()
  const nav = useNavigate()
  const now = useNow()
  const [tab, setTab] = useState<Tab>('details')
  const [deleting, setDeleting] = useState(false)
  const drivers = useDrivers()
  const byId = useLive((s) => s.byId)
  const routes = useRoutes(job.routeId != null)
  const store = useStoreJob()
  const driver = drivers.data?.find((d) => d.id === job.driverId)
  const device = job.deviceId != null ? byId[job.deviceId] : undefined
  const late = lateBy(job, now)
  const prog = stopProgress(job)
  const doneChecks = job.checklist.filter((c) => c.done).length
  const route = routes.data?.find((r) => r.id === job.routeId)
  const del = useMutation({
    mutationFn: () => api.deleteJob(job.id),
    onSuccess: () => {
      store(job, true)
      toast.success('Job deleted', job.reference)
      setDeleting(false)
      onClose()
    },
  })
  const sortedStops = useMemo(() => [...job.stops].sort((a, b) => a.seq - b.seq), [job.stops])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <JobMap job={job} className={cn('shrink-0', layout === 'sheet' ? 'h-[34vh] min-h-[220px]' : 'h-[260px]')} />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="px-4 pb-3 pt-3.5">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(job.reference).then(() => toast.success('Reference copied', job.reference))}
                  className="inline-flex items-center gap-1 rounded font-mono text-[11px] font-semibold tracking-wide text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                  title="Copy reference"
                >
                  {job.reference} <Copy className="h-3 w-3 opacity-60" />
                </button>
                <JobStatusPill status={job.status} />
                <PriorityPill priority={job.priority} hideNormal />
                {late != null && <LateBadge minutes={late} />}
              </div>
              <h2 className="mt-1 text-[16px] font-semibold leading-snug tracking-tight text-slate-900 dark:text-white">{job.title}</h2>
            </div>
            {canManage && (
              <>
                <IconButton size="sm" label="Edit job" onClick={onEdit}>
                  <Pencil className="h-4 w-4" />
                </IconButton>
                <IconButton size="sm" label="Delete job" onClick={() => setDeleting(true)} className="hover:!bg-rose-500/10 hover:!text-rose-500">
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </>
            )}
            <IconButton size="sm" label="Close job" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>
          {canManage && (
            <div className="mt-3">
              <StatusActions job={job} />
            </div>
          )}
          {job.status === 'failed' && job.failureReason && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-700 dark:text-rose-300">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <b className="font-semibold">Failed:</b> {job.failureReason}
              </span>
            </div>
          )}
        </div>
        <Tabs<Tab>
          className="mx-4 !mx-0 px-4 sm:!px-4"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'details', label: 'Details' },
            { id: 'stops', label: 'Stops', count: job.stops.length },
            { id: 'checklist', label: 'Checklist', count: job.checklist.length || undefined },
            { id: 'timeline', label: 'Timeline' },
            { id: 'files', label: 'Files', count: job.attachments?.length || undefined },
          ]}
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {tab === 'details' && (
            <div className="divide-y divide-slate-100 dark:divide-white/[0.05]">
              <Row icon={<UserRound />} label="Driver">
                <span className="flex items-center gap-2">
                  <DriverAvatar name={driver?.name} />
                  {driver ? (
                    <>
                      <span className="font-medium">{driver.name}</span>
                      {driver.phone && (
                        <a href={`tel:${driver.phone.replace(/\s/g, '')}`} className="ml-auto text-[12px] font-medium text-navy-600 hover:underline dark:text-brand-300">
                          {driver.phone}
                        </a>
                      )}
                    </>
                  ) : (
                    <span className="text-slate-400">Not assigned</span>
                  )}
                </span>
              </Row>
              <Row icon={<Truck />} label="Vehicle">
                {device ? (
                  <button type="button" onClick={() => nav(`/live?device=${device.id}`)} className="flex w-full items-center gap-2 text-left hover:text-navy-600 dark:hover:text-brand-300">
                    <span className="font-medium">{device.name}</span>
                    {device.plate && <span className="text-[11.5px] text-slate-400">{device.plate}</span>}
                    <StatusPill status={device.status} className="ml-auto" />
                  </button>
                ) : (
                  <span className="text-slate-400">{job.driverId != null ? 'Driver’s assigned vehicle' : 'Not assigned'}</span>
                )}
              </Row>
              {(job.customerName || job.customerPhone) && (
                <Row icon={<Phone />} label="Customer">
                  <span className="flex flex-wrap items-center gap-x-3">
                    <span className="font-medium">{job.customerName || '—'}</span>
                    {job.customerPhone && (
                      <a href={`tel:${job.customerPhone.replace(/\s/g, '')}`} className="text-[12px] font-medium text-navy-600 hover:underline dark:text-brand-300">
                        {job.customerPhone}
                      </a>
                    )}
                  </span>
                </Row>
              )}
              <Row icon={<CalendarClock />} label="Schedule">
                <span className="grid grid-cols-2 gap-2 text-[12.5px]">
                  <span>
                    <span className="block text-[11px] text-slate-400">Start</span>
                    <span className="tabular">{fmtWhen(job.scheduledStart)}</span>
                  </span>
                  <span>
                    <span className="block text-[11px] text-slate-400">Due by</span>
                    <span className={cn('tabular', late != null && 'font-semibold text-rose-600 dark:text-rose-400')}>{fmtWhen(job.dueBy)}</span>
                  </span>
                </span>
              </Row>
              <Row icon={<MapPin />} label="Progress">
                <span className="flex items-center gap-3">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.08]">
                    <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }} />
                  </span>
                  <span className="tabular text-[12px] text-slate-500">
                    {prog.done}/{prog.total} stops
                  </span>
                </span>
              </Row>
              {route && (
                <Row icon={<RouteIcon />} label="Planned route">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-1.5 w-4 rounded-full" style={{ background: route.color }} />
                    {route.name}
                    <span className="text-[11.5px] text-slate-400">· ±{route.corridor} m corridor</span>
                  </span>
                </Row>
              )}
              {(job.description || job.notes) && (
                <Row icon={<StickyNote />} label="Notes">
                  {job.description && <p className="whitespace-pre-line leading-relaxed">{job.description}</p>}
                  {job.notes && <p className="mt-1 whitespace-pre-line text-[12.5px] leading-relaxed text-slate-500 dark:text-slate-400">{job.notes}</p>}
                </Row>
              )}
              <Row icon={<Clock />} label="Created">
                <span className="tabular text-[12.5px]">
                  {fmtDateTime(job.createdAt)}
                  {job.completedAt && <span className="block text-slate-500">Completed {fmtDateTime(job.completedAt)}</span>}
                </span>
              </Row>
            </div>
          )}
          {tab === 'stops' && (
            <ol className="space-y-2">
              {sortedStops.map((s, i) => {
                const m = stopMeta(s.status)
                const files = job.attachments?.filter((a) => a.stopId != null && a.stopId === s.id).length ?? 0
                return (
                  <li key={s.id ?? i} className="flex gap-3 rounded-xl border border-slate-200/80 bg-white/60 p-3 dark:border-white/[0.06] dark:bg-white/[0.025]">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold shadow-sm" style={{ background: m.color, color: m.fg }}>
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <p className="min-w-0 flex-1 font-medium text-slate-900 dark:text-white">{s.name || `Stop ${i + 1}`}</p>
                        <span className="shrink-0 text-[11px] font-semibold" style={{ color: m.color }}>
                          {m.label}
                        </span>
                      </div>
                      {s.address && <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">{s.address}</p>}
                      <p className="tabular mt-1 flex flex-wrap gap-x-3 text-[11.5px] text-slate-500 dark:text-slate-400">
                        <span>r {s.radius} m</span>
                        {s.arrivedAt && <span>In {fmtShortDateTime(s.arrivedAt)}</span>}
                        {s.departedAt && <span>Out {fmtShortDateTime(s.departedAt)}</span>}
                        {s.completedAt && <span className="text-emerald-600 dark:text-emerald-400">Done {fmtShortDateTime(s.completedAt)}</span>}
                        {files > 0 && <span>{files} file{files === 1 ? '' : 's'}</span>}
                      </p>
                      {s.notes && <p className="mt-1 rounded-md bg-slate-100 px-2 py-1 text-[12px] text-slate-600 dark:bg-white/[0.05] dark:text-slate-300">{s.notes}</p>}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
          {tab === 'checklist' &&
            (job.checklist.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-slate-500">No checklist for this job.</p>
            ) : (
              <div>
                <p className="mb-2 text-[12px] text-slate-500 dark:text-slate-400">
                  {doneChecks} of {job.checklist.length} done · ticked by the driver in the app
                </p>
                <ul className="space-y-1.5">
                  {job.checklist.map((c, i) => (
                    <li key={c.id ?? i} className="flex items-center gap-2.5 rounded-lg border border-slate-200/80 px-3 py-2 dark:border-white/[0.06]">
                      <span
                        className={cn(
                          'grid h-5 w-5 shrink-0 place-items-center rounded-md border',
                          c.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 dark:border-white/20',
                        )}
                      >
                        {c.done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                      </span>
                      <span className={cn('min-w-0 flex-1 text-[13px]', c.done ? 'text-slate-500 line-through dark:text-slate-400' : 'text-slate-900 dark:text-white')}>{c.text}</span>
                      {c.required && !c.done && <span className="rounded bg-rose-500/10 px-1.5 text-[10px] font-semibold uppercase text-rose-600 dark:text-rose-300">Required</span>}
                      {c.doneAt && <span className="tabular text-[11px] text-slate-400">{fmtShortDateTime(c.doneAt)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          {tab === 'timeline' && <JobTimeline job={job} />}
          {tab === 'files' && <AttachmentsGallery job={job} canUpload={canManage} />}
        </div>
      </div>
      <Modal
        open={deleting}
        onClose={() => !del.isPending && setDeleting(false)}
        title={`Delete ${job.reference}?`}
        description="The job, its timeline and attachments are removed permanently. Prefer “Cancel job” to keep the record."
        footer={
          <>
            <Button onClick={() => setDeleting(false)} disabled={del.isPending} data-autofocus>
              Keep job
            </Button>
            <Button variant="danger" loading={del.isPending} icon={<Trash2 className="h-4 w-4" />} onClick={() => del.mutate()}>
              Delete
            </Button>
          </>
        }
      />
    </div>
  )
}
