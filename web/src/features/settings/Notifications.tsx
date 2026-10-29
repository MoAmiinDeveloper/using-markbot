import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellRing, CircleCheck, ExternalLink, LoaderCircle, Mail, MonitorSmartphone, Send, Smartphone, Unlink } from 'lucide-react'
import { useAuth } from '@/store/auth'
import { api, ApiError, qk } from '@/api/client'
import type { Channel, ChannelPrefs, NotificationPrefs, NotifyEventType, Settings } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Misc'
import { Switch } from '@/components/ui/Switch'
import { toast } from '@/store/toast'
import { EVENT_META } from '@/lib/events'
import { cn } from '@/lib/cn'
import { QrCode } from './QrCode'
import { currentSubscription, disablePush, enablePush, pushSupported } from './push'
import { SettingsCard } from './ui'

/** Matrix rows, grouped. */
const GROUPS: Array<{ label: string; types: NotifyEventType[] }> = [
  { label: 'Zones & trips', types: ['geofenceEnter', 'geofenceExit', 'ignitionOn', 'ignitionOff'] },
  { label: 'Safety & driving', types: ['alarm', 'overspeed', 'harshAcceleration', 'harshBraking', 'harshCornering', 'idle'] },
  { label: 'Fleet operations', types: ['maintenanceDue', 'documentExpiry'] },
  { label: 'Dispatch', types: ['jobAssigned', 'jobStatus', 'jobStopArrived', 'jobLate'] },
  { label: 'Routes', types: ['routeDeviation', 'routeReturn'] },
  { label: 'Sensors & fuel', types: ['fuelDrain', 'refuel', 'sensorHigh', 'sensorLow'] },
  { label: 'Custom events', types: ['custom'] },
]

/** Server defaults for keys an older server may not return yet. */
function defaultChannels(t: NotifyEventType): ChannelPrefs {
  const quiet = t === 'idle' || t.startsWith('harsh') || t === 'jobStopArrived' || t === 'routeReturn' || t === 'refuel' || t === 'jobStatus'
  return { inApp: true, telegram: !quiet, push: !quiet, email: false }
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M9.78 15.27 9.6 19.3c.36 0 .52-.16.71-.35l1.7-1.63 3.53 2.58c.65.36 1.11.17 1.29-.6l2.34-10.97c.21-.97-.35-1.35-.98-1.11L4.43 12.5c-.94.37-.92.9-.16 1.13l3.52 1.1 8.17-5.15c.38-.25.73-.11.45.14z" />
    </svg>
  )
}

function ChannelTile({
  icon,
  title,
  status,
  ok,
  children,
}: {
  icon: ReactNode
  title: string
  status: string
  ok: boolean
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-200/80 p-3 dark:border-white/[0.07]">
      <div className="flex items-center gap-2.5">
        <span className={cn('grid h-8 w-8 place-items-center rounded-lg', ok ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400' : 'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400')}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-slate-900 dark:text-white">{title}</p>
          <p className={cn('truncate text-[11.5px]', ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400')}>{status}</p>
        </div>
      </div>
      {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
    </div>
  )
}

function TelegramConnect({ open, onClose, linked }: { open: boolean; onClose: () => void; linked: boolean }) {
  const qc = useQueryClient()
  const link = useMutation({ mutationFn: api.telegramLink, meta: { silent: true } })
  const [now, setNow] = useState(Date.now())
  const { mutate, reset } = link

  useEffect(() => {
    if (!open) return
    reset()
    mutate()
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    // fallback if the WebSocket `notifications` message is missed
    const p = window.setInterval(() => void qc.invalidateQueries({ queryKey: qk.notificationPrefs }), 4000)
    return () => {
      window.clearInterval(t)
      window.clearInterval(p)
    }
  }, [open, mutate, reset, qc])

  useEffect(() => {
    if (!open || !linked) return
    toast.success('Telegram connected', 'Alerts will be sent to your Telegram chat.')
    const t = window.setTimeout(onClose, 1600)
    return () => window.clearTimeout(t)
  }, [open, linked, onClose])

  const expires = link.data ? Date.parse(link.data.expiresAt) : 0
  const left = Math.max(0, Math.round((expires - now) / 1000))
  const expired = !!link.data && expires > 0 && left === 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connect Telegram"
      description="Link your Telegram account to receive alerts in a chat with the fleet bot."
      className="max-w-[440px]"
      footer={<Button onClick={onClose}>{linked ? 'Done' : 'Close'}</Button>}
    >
      <div className="mt-4">
        {linked ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CircleCheck className="h-10 w-10 text-emerald-500" />
            <p className="font-medium text-slate-900 dark:text-white">Telegram is connected</p>
          </div>
        ) : link.isPending || link.isIdle ? (
          <div className="flex items-center gap-4">
            <Skeleton className="h-[176px] w-[176px] rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        ) : link.isError ? (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-[12.5px] text-rose-700 dark:text-rose-300">
            {link.error instanceof ApiError ? link.error.message : 'Could not create a link.'}
            <Button size="sm" className="mt-2" onClick={() => link.mutate()}>
              Try again
            </Button>
          </div>
        ) : (
          link.data && (
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <div className={cn('rounded-xl border border-slate-200 bg-white p-2 shadow-soft dark:border-white/10', expired && 'opacity-30')}>
                <QrCode value={link.data.url} size={160} />
              </div>
              <div className="min-w-0 flex-1 space-y-3 text-[12.5px] text-slate-600 dark:text-slate-300">
                <ol className="list-decimal space-y-1.5 pl-4">
                  <li>Scan the code with your phone camera, or open the link on this device.</li>
                  <li>
                    Press <b className="text-slate-900 dark:text-white">Start</b> in the chat with the bot.
                  </li>
                </ol>
                <a
                  href={link.data.url}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    'inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#229ED9] px-3.5 text-[13px] font-medium text-white shadow-sm hover:bg-[#1c8fc4]',
                    expired && 'pointer-events-none opacity-50',
                  )}
                >
                  <TelegramIcon className="h-4 w-4" /> Open Telegram <ExternalLink className="h-3.5 w-3.5 opacity-80" />
                </a>
                {expired ? (
                  <p className="flex items-center justify-between gap-2 text-amber-600 dark:text-amber-400">
                    Link expired.
                    <Button size="sm" onClick={() => link.mutate()}>
                      New link
                    </Button>
                  </p>
                ) : (
                  <p className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    Waiting for you to press Start…
                    {expires > 0 && (
                      <span className="tabular ml-auto text-[11.5px]">
                        {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>
          )
        )}
      </div>
    </Modal>
  )
}

export function NotificationsSection({ settings }: { settings: Settings | undefined }) {
  const qc = useQueryClient()
  const prefs = useQuery({ queryKey: qk.notificationPrefs, queryFn: api.notificationPrefs })
  const [tgOpen, setTgOpen] = useState(false)
  const closeTg = useCallback(() => setTgOpen(false), [])
  const [thisDevice, setThisDevice] = useState<boolean | null>(null)
  const supported = pushSupported()

  useEffect(() => {
    let alive = true
    void currentSubscription()
      .then((s) => alive && setThisDevice(!!s))
      .catch(() => alive && setThisDevice(false))
    return () => {
      alive = false
    }
  }, [])

  const save = useMutation({
    mutationFn: (events: NotificationPrefs['events']) => api.updateNotificationPrefs(events),
    onMutate: async (events) => {
      await qc.cancelQueries({ queryKey: qk.notificationPrefs })
      const prev = qc.getQueryData<NotificationPrefs>(qk.notificationPrefs)
      if (prev) qc.setQueryData<NotificationPrefs>(qk.notificationPrefs, { ...prev, events })
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(qk.notificationPrefs, ctx.prev),
    onSuccess: (p) => p && qc.setQueryData(qk.notificationPrefs, p),
  })

  const unlink = useMutation({
    mutationFn: api.telegramUnlink,
    onSuccess: () => {
      toast.success('Telegram disconnected')
      void qc.invalidateQueries({ queryKey: qk.notificationPrefs })
    },
  })

  const push = useMutation({
    meta: { silent: true },
    mutationFn: async (on: boolean) => {
      if (on) await enablePush()
      else await disablePush()
      return on
    },
    onSuccess: (on) => {
      setThisDevice(on)
      toast.success(on ? 'Push notifications enabled' : 'Push notifications disabled', on ? 'This browser will show alerts even when FleetOS is closed.' : undefined)
      void qc.invalidateQueries({ queryKey: qk.notificationPrefs })
    },
    onError: (e) => toast.error('Push notifications', e instanceof Error ? e.message : String(e)),
  })

  const test = useMutation({
    mutationFn: api.testNotification,
    onSuccess: (r) => {
      const parts = [
        r?.telegram ? 'Telegram' : null,
        r?.push ? `${r.push} push device${r.push === 1 ? '' : 's'}` : null,
      ].filter(Boolean)
      if (parts.length) toast.success('Test notification sent', `Delivered to ${parts.join(' and ')}.`)
      else toast.error('Test notification not delivered', 'No linked channel accepted it. Reconnect Telegram or re-enable push.')
    },
  })

  const p = prefs.data
  const tgLinked = !!p?.telegramLinked
  const tgConfigured = settings?.telegramConfigured ?? true
  const pushAny = !!p?.push?.enabled

  const myEmail = useAuth((x) => x.user?.email)
  const smtpOk = !!settings?.smtp?.configured
  const prefOf = (t: NotifyEventType): ChannelPrefs => ({ ...defaultChannels(t), ...(p?.events[t] ?? {}) })
  const toggle = (type: NotifyEventType, ch: Channel, v: boolean) => {
    if (!p) return
    const events = { ...p.events, [type]: { ...prefOf(type), [ch]: v } }
    save.mutate(events)
  }

  const columns: Array<{ ch: Channel; label: string; short?: string; disabled: boolean; why?: string }> = [
    { ch: 'inApp', label: 'In-app', short: 'App', disabled: false },
    { ch: 'telegram', label: 'Telegram', short: 'TG', disabled: !tgLinked, why: 'Connect Telegram first' },
    { ch: 'push', label: 'Push', disabled: !pushAny, why: 'Enable push on a device first' },
    { ch: 'email', label: 'Email', disabled: !smtpOk || !myEmail, why: !smtpOk ? 'An admin must configure SMTP first' : 'Your account has no email address' },
  ]

  return (
    <SettingsCard
      id="notifications"
      icon={<Bell />}
      title="Notifications"
      description="Choose how you hear about alerts. These settings are personal to your account."
    >
      {prefs.isLoading ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-56" />
        </div>
      ) : prefs.isError || !p ? (
        <p className="text-[12.5px] text-slate-500">Notification settings are unavailable on this server.</p>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ChannelTile icon={<BellRing className="h-4 w-4" />} title="In-app" status="Toasts, sound & bell" ok />
            <ChannelTile
              icon={<TelegramIcon className="h-4 w-4" />}
              title="Telegram"
              ok={tgLinked}
              status={tgLinked ? 'Connected' : tgConfigured ? 'Not connected' : 'Bot not configured'}
            >
              {tgLinked ? (
                <Button size="sm" icon={<Unlink className="h-3.5 w-3.5" />} loading={unlink.isPending} onClick={() => unlink.mutate()}>
                  Disconnect
                </Button>
              ) : (
                <span title={tgConfigured ? undefined : 'An administrator must add a Telegram bot token first'}>
                  <Button size="sm" variant="primary" disabled={!tgConfigured} onClick={() => setTgOpen(true)}>
                    Connect
                  </Button>
                </span>
              )}
            </ChannelTile>
            <ChannelTile
              icon={<Smartphone className="h-4 w-4" />}
              title="Browser push"
              ok={!!thisDevice}
              status={
                !supported
                  ? 'Not supported here (needs HTTPS)'
                  : thisDevice
                    ? 'On for this device'
                    : pushAny
                      ? 'On for other devices'
                      : 'Off'
              }
            >
              {supported &&
                (thisDevice ? (
                  <Button size="sm" loading={push.isPending} onClick={() => push.mutate(false)}>
                    Disable here
                  </Button>
                ) : (
                  <Button size="sm" variant="primary" icon={<MonitorSmartphone className="h-3.5 w-3.5" />} loading={push.isPending} onClick={() => push.mutate(true)}>
                    Enable on this device
                  </Button>
                ))}
            </ChannelTile>
            <ChannelTile icon={<Mail className="h-4 w-4" />} title="Email" ok={smtpOk && !!myEmail} status={!smtpOk ? 'Server not configured' : myEmail ? `To ${myEmail}` : 'No address on your account'} />
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200/80 dark:border-white/[0.07]">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-50/80 text-[11.5px] text-slate-500 dark:bg-white/[0.02] dark:text-slate-400">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium sm:px-4">
                    Event
                  </th>
                  {columns.map((c) => (
                    <th key={c.ch} scope="col" className="w-[50px] px-0.5 py-2 text-center font-medium sm:w-[84px]" title={c.disabled ? c.why : undefined}>
                      <span className={cn(c.disabled && 'opacity-50')}>
                        <span className="hidden sm:inline">{c.label}</span>
                        <span className="sm:hidden">{c.short ?? c.label}</span>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                {GROUPS.map((g) => (
                  <Fragment key={g.label}>
                    <tr className="bg-slate-50/60 dark:bg-white/[0.015]">
                      <th scope="colgroup" colSpan={columns.length + 1} className="px-3 pb-1.5 pt-2.5 text-left sm:px-4">
                        <span className="label-xs !text-[10.5px]">{g.label}</span>
                      </th>
                    </tr>
                    {g.types.map((t) => {
                      const m = EVENT_META[t]
                      const Icon = m.icon
                      const pref = prefOf(t)
                      return (
                        <tr key={t}>
                          <td className="px-3 py-2.5 sm:px-4">
                            <div className="flex items-center gap-2.5">
                              <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg', m.chip)}>
                                <Icon className="h-3.5 w-3.5" />
                              </span>
                              <div className="min-w-0">
                                <p className="truncate font-medium text-slate-900 dark:text-white">{m.label}</p>
                                <p className="hidden truncate text-[11.5px] text-slate-500 dark:text-slate-400 sm:block">{m.description}</p>
                              </div>
                            </div>
                          </td>
                          {columns.map((c) => (
                            <td key={c.ch} className="px-0.5 py-2.5 text-center">
                              <span title={c.disabled ? c.why : undefined} className="inline-flex">
                                <Switch
                                  size="sm"
                                  checked={!!pref[c.ch]}
                                  disabled={c.disabled}
                                  onChange={(v) => toggle(t, c.ch, v)}
                                  label={`${m.label} via ${c.label}`}
                                  className={cn(c.disabled && 'pointer-events-none')}
                                />
                              </span>
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] text-slate-500 dark:text-slate-400">
              Command results always appear in-app. Sound can be muted from the bell menu.
            </p>
            <Button
              size="sm"
              icon={<Send className="h-3.5 w-3.5" />}
              loading={test.isPending}
              disabled={!tgLinked && !pushAny}
              title={!tgLinked && !pushAny ? 'Connect Telegram or enable push first' : undefined}
              onClick={() => test.mutate()}
            >
              Send test notification
            </Button>
          </div>
        </div>
      )}
      <TelegramConnect open={tgOpen} onClose={closeTg} linked={tgLinked} />
    </SettingsCard>
  )
}
