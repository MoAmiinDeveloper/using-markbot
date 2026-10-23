import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, Share2, Trash2 } from 'lucide-react'
import { api, ApiError, qk } from '@/api/client'
import type { Device, Share } from '@/api/types'
import { Button, IconButton } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Misc'
import { Segmented } from '@/components/ui/Tabs'
import { CopyField } from '@/features/settings/ui'
import { useNow } from '@/store/now'
import { toast } from '@/store/toast'
import { fmtShortDateTime } from '@/lib/format'
import { cn } from '@/lib/cn'

const DURATIONS = [
  { id: 1, label: '1 hour' },
  { id: 8, label: '8 hours' },
  { id: 24, label: '24 hours' },
  { id: 168, label: '7 days' },
]

const fullUrl = (s: Share) => (s.url.startsWith('http') ? s.url : `${window.location.origin}${s.url.startsWith('/') ? '' : '/'}${s.url || `share/${s.token}`}`)

function left(iso: string, now: number) {
  const ms = Date.parse(iso) - now
  if (ms <= 0) return 'expired'
  const h = Math.floor(ms / 3600e3)
  const m = Math.floor((ms % 3600e3) / 60e3)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h left`
  return h ? `${h}h ${m}m left` : `${m}m left`
}

/** Create a time-limited public link to a vehicle's live location, and manage active links. */
export function ShareDialog({ device, open, onClose }: { device: Device; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const now = useNow()
  const [hours, setHours] = useState(24)
  const [created, setCreated] = useState<Share | null>(null)
  const shares = useQuery({ queryKey: qk.shares(device.id), queryFn: () => api.shares(device.id), enabled: open, meta: { silent: true } })
  const active = (shares.data ?? []).filter((s) => Date.parse(s.expiresAt) > now).sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))

  const create = useMutation({
    meta: { silent: true },
    mutationFn: () => api.createShare(device.id, hours),
    onSuccess: (s) => {
      setCreated(s)
      qc.setQueryData<Share[]>(qk.shares(device.id), (l) => [s, ...(l ?? []).filter((x) => x.token !== s.token)])
      void navigator.clipboard?.writeText(fullUrl(s)).then(
        () => toast.success('Link copied', `Anyone with the link can follow ${device.name} until ${fmtShortDateTime(s.expiresAt)}.`),
        () => undefined,
      )
    },
    onError: (e) => toast.error('Could not create the link', e instanceof ApiError ? e.message : String(e)),
  })
  const revoke = useMutation({
    meta: { silent: true },
    mutationFn: (s: Share) => api.revokeShare(s.token),
    onSuccess: (_, s) => {
      qc.setQueryData<Share[]>(qk.shares(device.id), (l) => l?.filter((x) => x.token !== s.token))
      if (created?.token === s.token) setCreated(null)
      toast.success('Link revoked', 'It stops working immediately.')
    },
    onError: (e) => toast.error('Could not revoke the link', e instanceof ApiError ? e.message : String(e)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Share ${device.name}’s live location`}
      description="Anyone with the link sees this vehicle on a map until the link expires — no sign-in needed. IMEI and phone numbers are never shown."
      className="max-w-lg"
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Link valid for</span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Segmented<number> label="Link duration" value={hours} onChange={setHours} options={DURATIONS} className="flex-1" />
            <Button variant="primary" icon={<Link2 className="h-4 w-4" />} loading={create.isPending} onClick={() => create.mutate()} data-autofocus>
              Create link
            </Button>
          </div>
        </div>
        {created && (
          <div className="animate-fade-in space-y-1.5 rounded-xl border border-brand-500/40 bg-brand-500/[0.07] p-3">
            <div className="flex items-center justify-between text-[12px]">
              <span className="font-medium text-navy-800 dark:text-brand-100">New link — copied to clipboard</span>
              <span className="text-slate-500 dark:text-slate-400">until {fmtShortDateTime(created.expiresAt)}</span>
            </div>
            <CopyField value={fullUrl(created)} label="share link" />
          </div>
        )}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Active links</span>
            <span className="text-[11.5px] text-slate-400">{active.length}</span>
          </div>
          {shares.isLoading ? (
            <Skeleton className="h-12 w-full rounded-xl" />
          ) : active.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 px-3 py-3 text-center text-[12.5px] text-slate-500 dark:border-white/10 dark:text-slate-400">
              No active links for this vehicle.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/80 dark:divide-white/[0.05] dark:border-white/[0.07]">
              {active.map((s) => {
                const soon = Date.parse(s.expiresAt) - now < 3600e3
                return (
                  <li key={s.token} className="flex items-center gap-2.5 px-3 py-2">
                    <Share2 className="h-4 w-4 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[11.5px] text-slate-700 dark:text-slate-200">{fullUrl(s).replace(/^https?:\/\//, '')}</div>
                      <div className={cn('text-[11.5px]', soon ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400')}>
                        {left(s.expiresAt, now)} · until {fmtShortDateTime(s.expiresAt)}
                      </div>
                    </div>
                    <IconButton
                      size="sm"
                      label="Copy link"
                      onClick={() => void navigator.clipboard?.writeText(fullUrl(s)).then(() => toast.success('Link copied'))}
                    >
                      <Link2 className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton size="sm" label="Revoke link" onClick={() => revoke.mutate(s)} className="hover:!bg-rose-500/10 hover:!text-rose-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}
