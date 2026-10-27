import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Bot, CircleCheck, Coins, Map as MapIcon, Eye, EyeOff, Gauge, KeyRound, Mail, RefreshCw, Send, ShieldCheck, Smartphone, Waypoints } from 'lucide-react'
import { Segmented } from '@/components/ui/Tabs'
import { api, ApiError, qk } from '@/api/client'
import type { Settings, SettingsPatch, SmtpTls } from '@/api/types'
import { API_BASE } from '@/config'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Input'
import { Switch } from '@/components/ui/Switch'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/store/toast'
import { AdminBadge, Code, CopyField, SettingsCard, Steps } from './ui'

function useSaveSettings(success: string) {
  const qc = useQueryClient()
  return useMutation({
    meta: { silent: true },
    mutationFn: (patch: SettingsPatch) => api.updateSettings(patch),
    onSuccess: (s) => {
      qc.setQueryData(qk.settings, s)
      toast.success(success)
    },
    onError: (e) => toast.error('Could not save settings', e instanceof ApiError ? e.message : String(e)),
  })
}

export function AlertRulesSection({ settings }: { settings: Settings }) {
  const [speed, setSpeed] = useState(String(settings.speedLimit))
  const [dur, setDur] = useState(String(settings.overspeedMinDuration))
  useEffect(() => {
    setSpeed(String(settings.speedLimit))
    setDur(String(settings.overspeedMinDuration))
  }, [settings.speedLimit, settings.overspeedMinDuration])
  const save = useSaveSettings('Alert rules saved')
  const speedErr = !/^\d{1,3}$/.test(speed) || +speed < 1 || +speed > 300 ? 'Between 1 and 300 km/h' : undefined
  const durErr = !/^\d{1,4}$/.test(dur) || +dur > 3600 ? 'Between 0 and 3600 seconds' : undefined
  const dirty = speed !== String(settings.speedLimit) || dur !== String(settings.overspeedMinDuration)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (speedErr || durErr) return
    save.mutate({ speedLimit: +speed, overspeedMinDuration: +dur })
  }
  return (
    <SettingsCard
      id="rules"
      icon={<Gauge />}
      title="Alert rules"
      badge={<AdminBadge />}
      description="Fleet-wide defaults. A vehicle’s own speed limit (Devices → Edit) overrides the default."
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Default speed limit" error={speedErr} hint={speedErr ? undefined : 'Overspeed fires above this speed'}>
            {(id, d) => (
              <Input
                id={id}
                aria-describedby={d}
                inputMode="numeric"
                value={speed}
                invalid={!!speedErr}
                onChange={(e) => setSpeed(e.target.value.replace(/\D/g, '').slice(0, 3))}
                trailing={<span className="pr-1.5 text-[11px] text-slate-400">km/h</span>}
              />
            )}
          </Field>
          <Field label="Minimum overspeed duration" error={durErr} hint={durErr ? undefined : 'Must stay above the limit this long'}>
            {(id, d) => (
              <Input
                id={id}
                aria-describedby={d}
                inputMode="numeric"
                value={dur}
                invalid={!!durErr}
                onChange={(e) => setDur(e.target.value.replace(/\D/g, '').slice(0, 4))}
                trailing={<span className="pr-1.5 text-[11px] text-slate-400">sec</span>}
              />
            )}
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setSpeed(String(settings.speedLimit))
                setDur(String(settings.overspeedMinDuration))
              }}
            >
              Reset
            </Button>
          )}
          <Button type="submit" variant="primary" disabled={!dirty || !!speedErr || !!durErr} loading={save.isPending}>
            Save rules
          </Button>
        </div>
      </form>
    </SettingsCard>
  )
}

export function TelegramBotSection({ settings }: { settings: Settings }) {
  const [token, setToken] = useState('')
  const [show, setShow] = useState(false)
  const [removing, setRemoving] = useState(false)
  const save = useSaveSettings('Telegram bot updated')
  const valid = /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token.trim())
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    save.mutate({ telegramBotToken: token.trim() }, { onSuccess: () => setToken('') })
  }
  return (
    <SettingsCard
      id="telegram"
      icon={<Bot />}
      title="Telegram bot"
      badge={<AdminBadge />}
      description="One bot for the whole workspace. Users then link their own chat from Notifications."
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-slate-200/80 px-3 py-2.5 dark:border-white/[0.07]">
          {settings.telegramConfigured ? (
            <>
              <CircleCheck className="h-5 w-5 shrink-0 text-emerald-500" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-slate-900 dark:text-white">Bot configured</p>
                {settings.telegramBotUsername && (
                  <a
                    href={`https://t.me/${settings.telegramBotUsername}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12px] font-medium text-navy-600 hover:underline dark:text-brand-300"
                  >
                    @{settings.telegramBotUsername}
                  </a>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                loading={save.isPending && save.variables?.telegramBotToken === ''}
                onClick={() => setRemoving(true)}
                className="hover:!text-rose-600 dark:hover:!text-rose-400"
              >
                Remove bot
              </Button>
            </>
          ) : (
            <>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-slate-400" />
              <p className="flex-1 text-[13px] text-slate-600 dark:text-slate-300">No bot configured yet</p>
            </>
          )}
        </div>
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-start" noValidate>
          <div className="flex-1">
            <Input
              type={show ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={settings.telegramConfigured ? 'Paste a new token to replace the current one' : '123456789:AAH…'}
              aria-label="Bot token"
              icon={<KeyRound className="h-4 w-4" />}
              invalid={!!token && !valid}
              className="[&_input:not(:placeholder-shown)]:font-mono [&_input:not(:placeholder-shown)]:text-[12px]"
              trailing={
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? 'Hide token' : 'Show token'}
                  className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-white"
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              }
            />
            {token && !valid && <p className="mt-1.5 text-[12px] text-rose-500">That doesn’t look like a bot token (digits:letters).</p>}
          </div>
          <Button type="submit" variant="primary" disabled={!valid} loading={save.isPending && !!save.variables?.telegramBotToken}>
            {settings.telegramConfigured ? 'Replace token' : 'Save token'}
          </Button>
        </form>
        <Modal
          open={removing}
          onClose={() => !save.isPending && setRemoving(false)}
          title="Remove the Telegram bot?"
          description="Nobody will receive Telegram alerts until a new bot token is added. Users will need to link their chats again."
          footer={
            <>
              <Button onClick={() => setRemoving(false)} disabled={save.isPending} data-autofocus>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={save.isPending}
                onClick={() => save.mutate({ telegramBotToken: '' }, { onSuccess: () => setRemoving(false) })}
              >
                Remove bot
              </Button>
            </>
          }
        />
        <div className="rounded-xl bg-slate-50 p-3.5 dark:bg-white/[0.025]">
          <p className="mb-2.5 text-[12px] font-semibold text-slate-700 dark:text-slate-200">Create a bot in a minute</p>
          <Steps>
            {[
              <>
                In Telegram, open{' '}
                <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="font-medium text-navy-600 hover:underline dark:text-brand-300">
                  @BotFather
                </a>{' '}
                and send <Code>/newbot</Code>.
              </>,
              <>Pick a display name and a username ending in “bot”, e.g. <Code>acme_fleet_bot</Code>.</>,
              <>BotFather replies with an HTTP API token — paste it above. The server verifies it with Telegram, then stores it; it is never shown again.</>,
            ]}
          </Steps>
        </div>
      </div>
    </SettingsCard>
  )
}

export function TraccarSection({ settings }: { settings: Settings }) {
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const regen = useMutation({
    mutationFn: api.regenerateTraccarToken,
    onSuccess: (s) => {
      qc.setQueryData(qk.settings, s)
      setConfirm(false)
      toast.success('New Traccar token generated', 'Update traccar.xml with the new URL.')
    },
  })
  const url = `${window.location.origin}${API_BASE}/ingest/traccar?token=${settings.traccarToken}`
  const xml = [`<entry key='forward.type'>json</entry>`, `<entry key='forward.url'>${url}</entry>`].join('\n')
  const localUrl = `http://localhost:${window.location.port || (window.location.protocol === 'https:' ? '443' : '80')}${API_BASE}/ingest/traccar?token=${settings.traccarToken}`

  return (
    <SettingsCard
      id="traccar"
      icon={<Waypoints />}
      title="Traccar bridge"
      badge={<AdminBadge />}
      description="Already running Traccar? Forward its positions here so those vehicles appear live with alerts — no re-configuring trackers."
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Forward URL</span>
            <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => setConfirm(true)} className="-mr-2">
              Regenerate token
            </Button>
          </div>
          <CopyField value={url} label="forward URL" />
        </div>
        <div className="space-y-1.5">
          <span className="text-[12.5px] font-medium text-slate-700 dark:text-slate-300">traccar.xml entries</span>
          <CopyField value={xml} label="traccar.xml snippet" multiline />
        </div>
        <div className="rounded-xl bg-slate-50 p-3.5 dark:bg-white/[0.025]">
          <p className="mb-2.5 text-[12px] font-semibold text-slate-700 dark:text-slate-200">Set up on the Traccar server</p>
          <Steps>
            {[
              <>
                Open the Traccar configuration file. On Windows it is <Code>C:\Program Files\Traccar\conf\traccar.xml</Code> (edit it as
                Administrator); on Linux <Code>/opt/traccar/conf/traccar.xml</Code>.
              </>,
              <>
                Paste the two <Code>&lt;entry&gt;</Code> lines above inside the <Code>&lt;properties&gt;</Code> element and save. Replace
                any existing <Code>forward.*</Code> entries.
              </>,
              <>
                Restart Traccar: on Windows open <b>Services</b> (<Code>services.msc</Code>), right-click <b>Traccar</b> → <b>Restart</b>; on
                Linux run <Code>sudo systemctl restart traccar</Code>.
              </>,
              <>
                Vehicles appear automatically under Devices with a <b>Traccar</b> badge as soon as they report.
              </>,
              <>
                The Traccar server must be able to reach the URL. If FleetOS runs on the <b>same machine</b> as Traccar, use{' '}
                <Code>http://localhost:&lt;port&gt;</Code> instead, e.g. <span className="break-all font-mono text-[11.5px]">{localUrl}</span>;
                otherwise use this server’s LAN IP or public hostname.
              </>,
            ]}
          </Steps>
        </div>
      </div>
      <Modal
        open={confirm}
        onClose={() => !regen.isPending && setConfirm(false)}
        title="Regenerate the Traccar token?"
        description="The current forward URL stops working immediately. You’ll need to update traccar.xml and restart Traccar with the new URL."
        footer={
          <>
            <Button onClick={() => setConfirm(false)} disabled={regen.isPending} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" loading={regen.isPending} icon={<RefreshCw className="h-4 w-4" />} onClick={() => regen.mutate()}>
              Regenerate
            </Button>
          </>
        }
      />
    </SettingsCard>
  )
}

const CURRENCIES = ['USD', 'SOS', 'AED', 'EUR', 'KES', 'ETB', 'DJF', 'SAR', 'GBP']

export function OperationsSection({ settings }: { settings: Settings }) {
  const [currency, setCurrency] = useState(settings.currency || 'USD')
  const [idle, setIdle] = useState(String(settings.idleAlertMinutes ?? 0))
  const [harsh, setHarsh] = useState(settings.harshScoring ?? true)
  useEffect(() => {
    setCurrency(settings.currency || 'USD')
    setIdle(String(settings.idleAlertMinutes ?? 0))
    setHarsh(settings.harshScoring ?? true)
  }, [settings.currency, settings.idleAlertMinutes, settings.harshScoring])
  const save = useSaveSettings('Fleet operations saved')
  const idleErr = !/^\d{1,4}$/.test(idle) || +idle > 1440 ? '0 – 1440 minutes' : undefined
  const dirty = currency !== (settings.currency || 'USD') || idle !== String(settings.idleAlertMinutes ?? 0) || harsh !== (settings.harshScoring ?? true)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (idleErr) return
    save.mutate({ currency, idleAlertMinutes: +idle, harshScoring: harsh })
  }
  return (
    <SettingsCard id="operations" icon={<Coins />} title="Fleet operations" badge={<AdminBadge />} description="Currency for expenses and reports, idle alerts and driver-behaviour scoring.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Currency" hint="Used for expenses, maintenance costs and reports">
            {(id, d) => (
              <Select id={id} aria-describedby={d} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {[...new Set([currency, ...CURRENCIES])].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Idle alert after" error={idleErr} hint={idleErr ? undefined : '0 turns idle alerts off'}>
            {(id, d) => (
              <Input
                id={id}
                aria-describedby={d}
                inputMode="numeric"
                value={idle}
                invalid={!!idleErr}
                onChange={(e) => setIdle(e.target.value.replace(/\D/g, '').slice(0, 4))}
                trailing={<span className="pr-1.5 text-[11px] text-slate-400">min</span>}
              />
            )}
          </Field>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200/80 px-3 py-2.5 dark:border-white/[0.07]">
          <div>
            <p className="text-[13px] font-medium text-slate-900 dark:text-white">Harsh driving in scores</p>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">Count harsh acceleration, braking and cornering in the driver behaviour score</p>
          </div>
          <Switch checked={harsh} onChange={setHarsh} label="Harsh driving in scores" />
        </div>
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={!dirty || !!idleErr} loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </SettingsCard>
  )
}

export function EmailSection({ settings }: { settings: Settings }) {
  const smtp = settings.smtp
  const init = () => ({
    host: smtp?.host ?? '',
    port: String(smtp?.port ?? 587),
    username: smtp?.username ?? '',
    password: '',
    from: smtp?.from ?? '',
    tls: (smtp?.tls ?? 'starttls') as SmtpTls,
  })
  const [v, setV] = useState(init)
  const [show, setShow] = useState(false)
  const [to, setTo] = useState('')
  const [touched, setTouched] = useState(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setV(init()), [smtp?.host, smtp?.port, smtp?.username, smtp?.from, smtp?.tls])
  const save = useSaveSettings('Email settings saved')
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }))
  const errors = {
    host: v.host.trim() && !/^[a-z0-9.-]+$/i.test(v.host.trim()) ? 'Host name only, e.g. smtp.somtel.so' : !v.host.trim() ? 'Required' : undefined,
    port: !/^\d{1,5}$/.test(v.port) || +v.port < 1 || +v.port > 65535 ? '1 – 65535' : undefined,
    from: v.from.trim() && !/@/.test(v.from) ? 'Include an email address' : undefined,
  }
  const dirty =
    v.host !== (smtp?.host ?? '') || v.port !== String(smtp?.port ?? 587) || v.username !== (smtp?.username ?? '') || !!v.password || v.from !== (smtp?.from ?? '') || v.tls !== (smtp?.tls ?? 'starttls')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (errors.host || errors.port || errors.from) return
    save.mutate(
      { smtp: { host: v.host.trim(), port: +v.port, username: v.username.trim(), from: v.from.trim(), tls: v.tls, ...(v.password ? { password: v.password } : {}) } },
      { onSuccess: () => set('password', '') },
    )
  }
  const test = useMutation({
    meta: { silent: true },
    mutationFn: () => api.testSmtp(to.trim()),
    onSuccess: (r) => toast.success('Test email sent', `Check the inbox of ${r?.to || to.trim()}`),
    onError: (e) => toast.error('Test email failed', e instanceof ApiError ? e.message : String(e)),
  })
  const toOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())
  const portFor: Record<SmtpTls, string> = { starttls: '587', tls: '465', none: '25' }

  return (
    <SettingsCard
      id="email"
      icon={<Mail />}
      title="Email (SMTP)"
      badge={<AdminBadge />}
      description="Outgoing mail for scheduled reports and email alerts. Use your mail provider’s SMTP server."
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="flex items-center gap-3 rounded-xl border border-slate-200/80 px-3 py-2.5 dark:border-white/[0.07]">
          {smtp?.configured ? <CircleCheck className="h-5 w-5 shrink-0 text-emerald-500" /> : <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-slate-400" />}
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-slate-900 dark:text-white">{smtp?.configured ? 'Email is configured' : 'Email not configured yet'}</p>
            <p className="truncate text-[12px] text-slate-500 dark:text-slate-400">{smtp?.configured ? `Sending as ${smtp.from || smtp.username}` : 'Reports and alerts can’t be emailed until a server is set'}</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
          <Field label="SMTP host" error={touched ? errors.host : undefined}>
            {(id, d) => <Input id={id} aria-describedby={d} value={v.host} invalid={touched && !!errors.host} autoComplete="off" spellCheck={false} placeholder="smtp.somtel.so" onChange={(e) => set('host', e.target.value)} />}
          </Field>
          <Field label="Port" error={errors.port}>
            {(id, d) => <Input id={id} aria-describedby={d} inputMode="numeric" value={v.port} invalid={!!errors.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, '').slice(0, 5))} />}
          </Field>
        </div>
        <div className="space-y-1.5">
          <span className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Encryption</span>
          <Segmented<SmtpTls>
            label="Encryption"
            value={v.tls}
            onChange={(t) => setV((s) => ({ ...s, tls: t, port: Object.values(portFor).includes(s.port) ? portFor[t] : s.port }))}
            className="sm:w-[360px]"
            options={[
              { id: 'starttls', label: 'STARTTLS', title: 'Port 587' },
              { id: 'tls', label: 'SSL / TLS', title: 'Port 465' },
              { id: 'none', label: 'None', title: 'Unencrypted — not recommended' },
            ]}
          />
          {v.tls === 'none' && <p className="text-[12px] text-amber-600 dark:text-amber-400">Passwords and reports are sent unencrypted. Only use on a trusted network.</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Username">
            {(id) => <Input id={id} value={v.username} autoComplete="off" spellCheck={false} placeholder="fleet@somtel.so" onChange={(e) => set('username', e.target.value)} />}
          </Field>
          <Field label="Password" hint={smtp?.configured ? 'Leave empty to keep the current password' : 'Stored on the server, never shown again'}>
            {(id, d) => (
              <Input
                id={id}
                aria-describedby={d}
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                value={v.password}
                placeholder={smtp?.configured ? '••••••••' : ''}
                icon={<KeyRound className="h-4 w-4" />}
                onChange={(e) => set('password', e.target.value)}
                trailing={
                  <button type="button" onClick={() => setShow((x) => !x)} aria-label={show ? 'Hide password' : 'Show password'} className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-white">
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                }
              />
            )}
          </Field>
        </div>
        <Field label="From" error={touched ? errors.from : undefined} hint="Name and address recipients see">
          {(id, d) => <Input id={id} aria-describedby={d} value={v.from} invalid={touched && !!errors.from} placeholder="Somtel Fleet <fleet@somtel.so>" onChange={(e) => set('from', e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          {dirty && (
            <Button variant="ghost" onClick={() => setV(init())}>
              Reset
            </Button>
          )}
          <Button type="submit" variant="primary" disabled={!dirty} loading={save.isPending}>
            Save email settings
          </Button>
        </div>
      </form>
      <div className="mt-4 flex flex-col gap-2 rounded-xl bg-slate-50 p-3 dark:bg-white/[0.025] sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field label="Send a test email to">
            {(id) => <Input id={id} type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@somtel.so" icon={<Mail className="h-4 w-4" />} />}
          </Field>
        </div>
        <Button icon={<Send className="h-4 w-4" />} disabled={!toOk || !smtp?.configured || dirty} title={dirty ? 'Save your changes first' : !smtp?.configured ? 'Configure SMTP first' : undefined} loading={test.isPending} onClick={() => test.mutate()}>
          Send test email
        </Button>
      </div>
    </SettingsCard>
  )
}

export function DriverAppSection({ settings }: { settings: Settings }) {
  const save = useSaveSettings('Driver app setting saved')
  const on = !!settings.driverAppTracking
  return (
    <SettingsCard id="driver-app" icon={<Smartphone />} title="Driver app" badge={<AdminBadge />} description="Drivers sign in to the Android app with the login you create under Drivers → Edit → App login.">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200/80 px-3 py-3 dark:border-white/[0.07]">
          <div>
            <p className="text-[13px] font-medium text-slate-900 dark:text-white">Track drivers with phone GPS</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
              When on, the app sends the phone’s location even if the driver has a vehicle with a tracker. When off, phone GPS is only used for drivers
              without a vehicle. Phones appear as devices with the <Code>driverapp</Code> protocol.
            </p>
          </div>
          <Switch checked={on} disabled={save.isPending} onChange={(x) => save.mutate({ driverAppTracking: x })} label="Track drivers with phone GPS" />
        </div>
        <p className="flex items-start gap-2 text-[12px] text-slate-500 dark:text-slate-400">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Tell drivers when their phone is tracked. Tracking only runs while they are signed in to the app.
        </p>
      </div>
    </SettingsCard>
  )
}

export function GoogleMapsSection({ settings }: { settings: Settings }) {
  const save = useSaveSettings('Google Maps key saved')
  const [key, setKey] = useState(settings.googleMapsKey ?? '')
  const [show, setShow] = useState(false)
  useEffect(() => setKey(settings.googleMapsKey ?? ''), [settings.googleMapsKey])
  const dirty = key.trim() !== (settings.googleMapsKey ?? '')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate({ googleMapsKey: key.trim() })
  }
  return (
    <SettingsCard
      id="google-maps"
      icon={<MapIcon />}
      title="Google Maps"
      badge={<AdminBadge />}
      description="Use Google's maps and street addresses instead of OpenStreetMap. Leave empty to use the free OpenStreetMap maps."
    >
      <form onSubmit={submit} className="space-y-3">
        <Field label="API key" hint={settings.googleMapsKey ? 'Configured — Google Maps and Google Satellite appear in the map style menu' : 'Not configured'}>
          {(id, d) => (
            <div className="flex gap-2">
              <Input id={id} aria-describedby={d} type={show ? 'text' : 'password'} value={key} onChange={(e) => setKey(e.target.value)} placeholder="AIza…" autoComplete="off" spellCheck={false} className="font-mono" />
              <Button type="button" variant="secondary" onClick={() => setShow((x) => !x)} aria-label={show ? 'Hide key' : 'Show key'} icon={show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} />
            </div>
          )}
        </Field>
        <Steps>
          {[
            <>In Google Cloud Console → APIs &amp; Services, enable <b>Maps JavaScript API</b> (maps) and <b>Geocoding API</b> (addresses). A Maps Demo Key already includes the maps.</>,
            <>Restrict the key: <b>API restrictions</b> to those two APIs. If Google refuses addresses, OpenStreetMap addresses are used instead.</>,
            <>Paste the key here, save, and reload the page (Ctrl+F5). <b>Google Maps</b> becomes the default map and appears in the map style menu.</>,
          ]}
        </Steps>
        <div className="flex justify-end gap-2">
          {settings.googleMapsKey && (
            <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => save.mutate({ googleMapsKey: '' })}>
              Remove key
            </Button>
          )}
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
            Save
          </Button>
        </div>
      </form>
    </SettingsCard>
  )
}
