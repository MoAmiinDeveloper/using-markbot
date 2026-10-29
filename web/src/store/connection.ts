import { api, qk, wsUrl } from '@/api/client'
import { queryClient } from '@/api/queryClient'
import type { Command, Device, FleetEvent, Job, NotificationPrefs, Position, WsMessage } from '@/api/types'
import { playEventSound } from '@/lib/sound'
import { useAlerts } from './alerts'
import { useLive } from './live'
import { toast } from './toast'

/** Whether the user wants in-app notifications for this event type (default yes). */
function wantsInApp(e: FleetEvent): boolean {
  const prefs = queryClient.getQueryData<NotificationPrefs>(qk.notificationPrefs)
  const p = prefs?.events?.[e.type as keyof NotificationPrefs['events']]
  return p ? p.inApp : true
}

/**
 * Live connection manager: opens the WebSocket, (re)fetches /devices on every
 * (re)connect, buffers frames and flushes them into the store a few times per
 * second, and reconnects with exponential backoff + jitter.
 */
class LiveConnection {
  private ws: WebSocket | null = null
  private token: string | null = null
  private attempt = 0
  private retryTimer: number | undefined
  private flushTimer: number | undefined
  private stopped = true
  private pendingDevices: Device[] = []
  private pendingPositions: Position[] = []
  private pendingDeleted: number[] = []
  private synced = false
  private eventsInvalidateTimer: number | undefined
  private jobsInvalidateTimer: number | undefined

  start(token: string) {
    if (!this.stopped && this.token === token) return
    this.stop()
    this.stopped = false
    this.token = token
    this.attempt = 0
    this.connect()
    // load the device list immediately; don't wait for the socket
    void this.sync()
  }

  stop() {
    this.stopped = true
    window.clearTimeout(this.retryTimer)
    window.clearTimeout(this.flushTimer)
    this.flushTimer = undefined
    if (this.ws) {
      this.ws.onclose = null
      this.ws.onmessage = null
      this.ws.onerror = null
      this.ws.onopen = null
      this.ws.close()
      this.ws = null
    }
    this.token = null
    this.synced = false
    window.clearTimeout(this.eventsInvalidateTimer)
    this.eventsInvalidateTimer = undefined
    useLive.getState().reset()
    useAlerts.getState().reset()
  }

  /** Force a resync (e.g. user clicked "retry"). */
  reconnectNow() {
    if (this.stopped || !this.token) return
    window.clearTimeout(this.retryTimer)
    this.attempt = 0
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
    this.connect()
    void this.sync()
  }

  private connect() {
    if (this.stopped || !this.token) return
    const live = useLive.getState()
    live.setWs(this.attempt === 0 && !live.loaded ? 'connecting' : 'reconnecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(wsUrl(this.token))
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws
    ws.onopen = () => {
      const wasRetry = this.attempt > 0
      this.attempt = 0
      useLive.getState().setWs('open')
      if (wasRetry || !this.synced) void this.sync()
    }
    ws.onmessage = (ev) => this.onFrame(ev.data)
    ws.onerror = () => {
      /* onclose follows */
    }
    ws.onclose = () => {
      this.ws = null
      if (!this.stopped) this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    useLive.getState().setWs('reconnecting')
    const base = Math.min(30_000, 1000 * 2 ** this.attempt)
    const delay = base / 2 + Math.random() * (base / 2)
    this.attempt++
    window.clearTimeout(this.retryTimer)
    this.retryTimer = window.setTimeout(() => this.connect(), delay)
  }

  private async sync() {
    void this.syncEvents()
    try {
      const devices = await api.devices()
      if (this.stopped) return
      useLive.getState().setAll(devices)
      this.synced = true
    } catch (e) {
      if (this.stopped) return
      useLive.getState().setError(e instanceof Error ? e.message : 'Failed to load devices')
    }
  }

  /** Seed the notification centre with the latest events (endpoint may not exist on old servers). */
  private async syncEvents() {
    try {
      const events = await api.events({ limit: 50 })
      if (this.stopped) return
      useAlerts.getState().setRecent(Array.isArray(events) ? events.filter(wantsInApp) : [])
    } catch {
      /* non-fatal: bell simply stays empty */
    }
  }

  private onEvent(e: FleetEvent) {
    // refresh any open event lists (throttled; events can arrive in bursts)
    if (this.eventsInvalidateTimer === undefined) {
      this.eventsInvalidateTimer = window.setTimeout(() => {
        this.eventsInvalidateTimer = undefined
        void queryClient.invalidateQueries({ queryKey: qk.events() })
      }, 1500)
    }
    if (!wantsInApp(e)) return
    const alerts = useAlerts.getState()
    if (alerts.recent.some((x) => x.id === e.id)) return
    alerts.add(e)
    toast.event(e, useLive.getState().byId[e.deviceId]?.name)
    if (!alerts.muted) playEventSound(e.type)
  }

  private onCommand(c: Command) {
    queryClient.setQueryData<Command[]>(qk.commands(c.deviceId), (list) => {
      if (!list) return list
      const i = list.findIndex((x) => x.id === c.id)
      if (i === -1) return [c, ...list]
      const next = list.slice()
      next[i] = c
      return next
    })
  }

  /** Live job updates: patch every cached job list and the job itself; unknown jobs refresh the lists. */
  private onJob(j: Job) {
    let found = false
    queryClient.setQueriesData<Job[]>({ queryKey: qk.jobs() }, (list) => {
      if (!Array.isArray(list)) return list
      const i = list.findIndex((x) => x.id === j.id)
      if (i === -1) return list
      found = true
      const next = list.slice()
      next[i] = j
      return next
    })
    queryClient.setQueryData(qk.job(j.id), j)
    void queryClient.invalidateQueries({ queryKey: qk.jobTimeline(j.id) })
    if (!found && this.jobsInvalidateTimer === undefined) {
      this.jobsInvalidateTimer = window.setTimeout(() => {
        this.jobsInvalidateTimer = undefined
        void queryClient.invalidateQueries({ queryKey: qk.jobs() })
      }, 800)
    }
  }

  private onFrame(raw: unknown) {
    if (typeof raw !== 'string') return
    let msg: WsMessage
    try {
      msg = JSON.parse(raw) as WsMessage
    } catch {
      return
    }
    switch (msg.type) {
      case 'position':
        this.pendingPositions.push(msg.data)
        break
      case 'device':
        this.pendingDevices.push(msg.data)
        break
      case 'deleted':
        this.pendingDeleted.push(msg.data.id)
        break
      case 'event':
        if (msg.data) this.onEvent(msg.data)
        return
      case 'command':
        if (msg.data) this.onCommand(msg.data)
        return
      case 'geofences':
        void queryClient.invalidateQueries({ queryKey: qk.geofences })
        return
      case 'params':
        void queryClient.invalidateQueries({ queryKey: qk.params })
        return
      case 'notifications':
        void queryClient.invalidateQueries({ queryKey: qk.notificationPrefs })
        return
      case 'job':
        if (msg.data) this.onJob(msg.data)
        return
      case 'jobDeleted':
        if (msg.data) {
          const id = msg.data.id
          queryClient.setQueriesData<Job[]>({ queryKey: qk.jobs() }, (l) => (Array.isArray(l) ? l.filter((x) => x.id !== id) : l))
          queryClient.removeQueries({ queryKey: qk.job(id) })
        }
        return
      case 'routes':
        void queryClient.invalidateQueries({ queryKey: qk.routes })
        return
      default:
        return
    }
    if (this.flushTimer === undefined) this.flushTimer = window.setTimeout(() => this.flush(), 200)
  }

  private flush() {
    this.flushTimer = undefined
    const d = this.pendingDevices
    const p = this.pendingPositions
    const x = this.pendingDeleted
    this.pendingDevices = []
    this.pendingPositions = []
    this.pendingDeleted = []
    useLive.getState().applyBatch(d, p, x)
  }
}

export const liveConnection = new LiveConnection()
