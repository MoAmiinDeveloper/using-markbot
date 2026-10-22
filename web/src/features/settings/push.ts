import { api } from '@/api/client'

export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window &&
  window.isSecureContext

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** This browser's push subscription, if any (does not register the worker). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration('/')
  return reg ? reg.pushManager.getSubscription() : null
}

/** Ask permission, register /sw.js, subscribe with the server's VAPID key and register it. */
export async function enablePush(): Promise<PushSubscription> {
  if (!pushSupported()) throw new Error('Push notifications are not supported in this browser (HTTPS is required).')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted')
    throw new Error(perm === 'denied' ? 'Notifications are blocked for this site. Allow them in the browser’s site settings.' : 'Permission was not granted.')
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  await navigator.serviceWorker.ready
  const { publicKey } = await api.vapidKey()
  const key = b64ToBytes(publicKey)
  let sub = await reg.pushManager.getSubscription()
  if (sub) {
    // re-subscribe if the server's key changed
    const cur = sub.options.applicationServerKey
    const same = cur && new Uint8Array(cur).every((b, i) => b === key[i])
    if (!same) {
      await sub.unsubscribe()
      sub = null
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  await api.pushSubscribe(sub.toJSON())
  return sub
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  await api.pushUnsubscribe(endpoint)
}
