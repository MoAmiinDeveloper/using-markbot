import { api, wsUrl } from '@/api/client'
import type { Device, Position, WsMessage } from '@/api/types'
import { useLive } from './live'

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
    useLive.getState().reset()
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
