import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CloudOff,
  Cpu,
  Info,
  OctagonX,
  Play,
  RotateCcw,
  Send,
  ShieldAlert,
  Tag,
  Terminal,
  Unplug,
} from 'lucide-react'
import { api, ApiError, qk } from '@/api/client'
import type { Command, CommandType, Device } from '@/api/types'
import { useAccess } from '@/lib/access'
import { useNow } from '@/store/now'
import { toast } from '@/store/toast'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Misc'
import { COMMAND_LABEL, COMMAND_STATUS_META } from '@/lib/events'
import { fmtDateTime, fmtSpeed, timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'

const ADMIN_ONLY: CommandType[] = ['engineStop', 'engineResume', 'custom']

export function CommandStatusPill({ status }: { status: Command['status'] }) {
  const m = COMMAND_STATUS_META[status] ?? COMMAND_STATUS_META.queued
  const pending = status === 'queued' || status === 'sent'
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset', m.pill)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', m.dot, pending && 'animate-pulse')} />
      {m.label}
    </span>
  )
}

function CmdButton({
  icon,
  label,
  onClick,
  disabled,
  reason,
  danger,
  loading,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  reason?: string
  danger?: boolean
  loading?: boolean
}) {
  return (
    // the wrapper carries the tooltip: disabled buttons don't receive hover events
    <span title={disabled ? reason : undefined} className="block">
      <Button
        size="sm"
        variant="secondary"
        icon={icon}
        onClick={onClick}
        disabled={disabled}
        loading={loading}
        className={cn(
          'w-full justify-start',
          danger &&
            '!border-rose-500/30 !text-rose-600 hover:!bg-rose-500/10 dark:!border-rose-500/30 dark:!text-rose-400 dark:hover:!bg-rose-500/10',
          disabled && 'pointer-events-none',
        )}
      >
        {label}
      </Button>
    </span>
  )
}

function EngineStopDialog({
  device,
  open,
  onClose,
  onConfirm,
  pending,
}: {
  device: Device
  open: boolean
  onClose: () => void
  onConfirm: () => void
  pending: boolean
}) {
  const [typed, setTyped] = useState('')
  const ok = typed.trim().toLowerCase() === device.name.trim().toLowerCase()
  const speed = device.position?.speed ?? 0
  const queued = device.commands === false
  const close = () => {
    setTyped('')
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={() => !pending && close()}
      title={`Stop the engine of ${device.name}?`}
      className="max-w-[460px]"
      footer={
        <>
          <Button onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            icon={<OctagonX className="h-4 w-4" />}
            disabled={!ok}
            loading={pending}
            onClick={onConfirm}
          >
            Stop engine
          </Button>
        </>
      }
    >
      <div className="mt-3 space-y-3 text-[13px] text-slate-600 dark:text-slate-300">
        <div className="flex gap-3 rounded-xl border border-rose-500/30 bg-rose-500/[0.07] p-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
          <div className="space-y-1.5">
            <p className="font-medium text-rose-700 dark:text-rose-300">This immobilises the vehicle.</p>
            <p>
              The tracker switches its output relay (<span className="font-mono text-[12px]">setdigout 1</span>) which cuts the fuel
              pump or starter. If the vehicle is moving it can lose power on the road — only use this when it is safe, e.g. a
              confirmed theft, and inform the driver.
            </p>
          </div>
        </div>
        {speed > 3 && (
          <p className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[12.5px] font-medium text-amber-700 dark:text-amber-300">
            <Info className="h-4 w-4 shrink-0" /> {device.name} is currently moving at {fmtSpeed(speed)}.
          </p>
        )}
        {queued && (
          <p className="flex items-center gap-2 rounded-lg bg-slate-500/10 px-3 py-2 text-[12.5px]">
            <CloudOff className="h-4 w-4 shrink-0 text-slate-400" /> The device is offline — the command will be queued and run
            as soon as it reconnects (within 24 h).
          </p>
        )}
        <p>Engine resume reverses this at any time.</p>
        <label className="block space-y-1.5">
          <span className="text-[12.5px] font-medium text-slate-700 dark:text-slate-300">
            Type <span className="rounded bg-slate-100 px-1 py-px font-semibold text-slate-900 dark:bg-white/10 dark:text-white">{device.name}</span> to confirm
          </span>
          <Input
            data-autofocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ok && !pending && onConfirm()}
            placeholder={device.name}
            autoComplete="off"
            aria-label="Vehicle name confirmation"
          />
        </label>
      </div>
    </Modal>
  )
}

function CommandRow({ c, now }: { c: Command; now: number }) {
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-slate-900 dark:text-white">
          {COMMAND_LABEL[c.type] ?? c.type}
          {c.text && <span className="ml-1.5 font-mono text-[11.5px] font-normal text-slate-400">{c.text}</span>}
        </span>
        <CommandStatusPill status={c.status} />
      </div>
      <div className="mt-0.5 text-[11.5px] text-slate-400" title={fmtDateTime(c.createdAt)}>
        {timeAgo(c.createdAt, now)}
        {c.completedAt && c.status !== 'queued' ? ` · done ${timeAgo(c.completedAt, now)}` : ''}
      </div>
      {c.response && (
        <pre className="mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-100 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-slate-700 dark:bg-black/30 dark:text-slate-300">
          {c.response}
        </pre>
      )}
    </li>
  )
}

export function CommandsSection({ device }: { device: Device }) {
  const { isAdmin, canManageDevice } = useAccess()
  const readOnly = !canManageDevice(device)
  const qc = useQueryClient()
  const now = useNow()
  const [confirmStop, setConfirmStop] = useState(false)
  const [custom, setCustom] = useState('')
  const [showAll, setShowAll] = useState(false)
  const bridged = device.source === 'traccar'
  const offline = !bridged && device.commands === false

  const history = useQuery({
    queryKey: qk.commands(device.id),
    queryFn: () => api.commands(device.id, 20),
    enabled: !bridged,
    meta: { silent: true },
  })

  const send = useMutation({
    mutationFn: ({ type, text }: { type: CommandType; text?: string }) => api.sendCommand(device.id, type, text),
    meta: { silent: true },
    onSuccess: (c) => {
      qc.setQueryData<Command[]>(qk.commands(device.id), (list) => [c, ...(list ?? []).filter((x) => x.id !== c.id)])
      toast.success(
        c.status === 'queued' ? 'Command queued' : 'Command sent',
        `${COMMAND_LABEL[c.type]} → ${device.name}${c.status === 'queued' ? ' (will run when the device connects)' : ''}`,
      )
      if (c.type === 'engineStop') setConfirmStop(false)
      if (c.type === 'custom') setCustom('')
    },
    onError: (e) => toast.error('Command not sent', e instanceof ApiError ? e.message : String(e)),
  })

  const reason = (t: CommandType): string | undefined => {
    if (bridged) return 'Bridged via Traccar — commands are not supported for this device'
    if (readOnly) return 'Read-only access — ask a manager to send commands'
    if (ADMIN_ONLY.includes(t) && !isAdmin) return 'Only administrators can send this command'
    return undefined
  }
  const btn = (t: CommandType, icon: ReactNode, danger?: boolean, onClick?: () => void) => (
    <CmdButton
      icon={icon}
      label={COMMAND_LABEL[t]}
      danger={danger}
      disabled={!!reason(t)}
      reason={reason(t)}
      loading={send.isPending && send.variables?.type === t && t !== 'engineStop'}
      onClick={onClick ?? (() => send.mutate({ type: t }))}
    />
  )

  const submitCustom = (e: FormEvent) => {
    e.preventDefault()
    const text = custom.trim()
    if (text) send.mutate({ type: 'custom', text })
  }

  const list = history.data ?? []
  const shown = showAll ? list : list.slice(0, 4)

  return (
    <section aria-label="Commands" className="mt-3 overflow-hidden rounded-xl border border-slate-200/80 bg-white/60 dark:border-white/[0.06] dark:bg-white/[0.025]">
      <header className="flex items-center gap-2 px-3 pb-2 pt-2.5">
        <Terminal className="h-4 w-4 text-slate-400" />
        <h3 className="flex-1 text-[12.5px] font-semibold text-slate-900 dark:text-white">Commands</h3>
        {!bridged && (
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-[11px] font-medium',
              offline ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400',
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', offline ? 'bg-amber-500' : 'bg-emerald-500')} />
            {offline ? 'Offline · will queue' : 'Connected'}
          </span>
        )}
      </header>

      {bridged ? (
        <p className="mx-3 mb-3 flex gap-2 rounded-lg bg-slate-500/10 px-3 py-2 text-[12px] text-slate-600 dark:text-slate-300">
          <Unplug className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          This vehicle reports through the Traccar bridge, which only forwards positions. Connect the tracker directly to send
          commands.
        </p>
      ) : offline ? (
        <p className="mx-3 mb-2 flex gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-200">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />
          Not connected right now. Commands are queued and sent when it reconnects; they expire after 24 h.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-1.5 px-3 pb-3">
        {btn('engineStop', <OctagonX className="h-3.5 w-3.5" />, true, () => setConfirmStop(true))}
        {btn('engineResume', <Play className="h-3.5 w-3.5" />)}
        {btn('reboot', <RotateCcw className="h-3.5 w-3.5" />)}
        {btn('getInfo', <Info className="h-3.5 w-3.5" />)}
        {btn('getVersion', <Tag className="h-3.5 w-3.5" />)}
        {btn('custom', <Cpu className="h-3.5 w-3.5" />, false, () => document.getElementById(`custom-cmd-${device.id}`)?.focus())}
      </div>

      {isAdmin && !bridged && (
        <form onSubmit={submitCustom} className="flex gap-1.5 px-3 pb-3">
          <Input
            id={`custom-cmd-${device.id}`}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Custom command, e.g. getstatus"
            aria-label="Custom command text"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 [&_input]:font-mono [&_input]:text-[12px]"
          />
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={!custom.trim()}
            loading={send.isPending && send.variables?.type === 'custom'}
            icon={<Send className="h-3.5 w-3.5" />}
            aria-label="Send custom command"
          />
        </form>
      )}

      {!bridged && (
        <div className="border-t border-slate-200/80 dark:border-white/[0.06]">
          {history.isLoading ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : history.isError ? (
            <p className="px-3 py-3 text-[12px] text-slate-500">Command history unavailable.</p>
          ) : list.length === 0 ? (
            <p className="px-3 py-3 text-center text-[12px] text-slate-500 dark:text-slate-400">No commands sent yet</p>
          ) : (
            <>
              <ul className="divide-y divide-slate-200/70 dark:divide-white/[0.05]">
                {shown.map((c) => (
                  <CommandRow key={c.id} c={c} now={now} />
                ))}
              </ul>
              {list.length > 4 && (
                <button
                  type="button"
                  onClick={() => setShowAll((s) => !s)}
                  className="w-full border-t border-slate-200/70 py-2 text-[12px] font-medium text-navy-600 hover:bg-slate-900/[0.03] dark:border-white/[0.05] dark:text-brand-300 dark:hover:bg-white/[0.03]"
                >
                  {showAll ? 'Show less' : `Show all ${list.length}`}
                </button>
              )}
            </>
          )}
        </div>
      )}

      <EngineStopDialog
        device={device}
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        pending={send.isPending && send.variables?.type === 'engineStop'}
        onConfirm={() => send.mutate({ type: 'engineStop' })}
      />
    </section>
  )
}
