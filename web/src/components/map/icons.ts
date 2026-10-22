import type { Map as MlMap } from 'maplibre-gl'
import type { DeviceStatus } from '@/api/types'
import { STATUS_META, STATUSES } from '@/lib/status'

const PR = 2 // pixel ratio of generated images

function canvas(size: number) {
  const c = document.createElement('canvas')
  c.width = c.height = size * PR
  const ctx = c.getContext('2d')!
  ctx.scale(PR, PR)
  return { c, ctx }
}

/** Vehicle marker: status-coloured disc, white ring, and a heading arrow (moving/idle) or dot. */
function vehicleImage(status: DeviceStatus, arrow: boolean, selected: boolean) {
  const size = 40
  const { c, ctx } = canvas(size)
  const cx = size / 2
  const r = selected ? 13 : 11
  const color = STATUS_META[status].color

  if (selected) {
    ctx.beginPath()
    ctx.arc(cx, cx, r + 6, 0, Math.PI * 2)
    ctx.fillStyle = hexA(color, 0.25)
    ctx.fill()
  }
  // shadow
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 4
  ctx.shadowOffsetY = 1
  ctx.beginPath()
  ctx.arc(cx, cx, r, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.restore()
  // disc
  ctx.beginPath()
  ctx.arc(cx, cx, r - 2, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()

  ctx.fillStyle = '#ffffff'
  if (arrow) {
    const s = r * 0.62
    ctx.beginPath()
    ctx.moveTo(cx, cx - s)
    ctx.lineTo(cx + s * 0.72, cx + s * 0.78)
    ctx.lineTo(cx, cx + s * 0.38)
    ctx.lineTo(cx - s * 0.72, cx + s * 0.78)
    ctx.closePath()
    ctx.fill()
  } else {
    ctx.beginPath()
    ctx.arc(cx, cx, r * 0.3, 0, Math.PI * 2)
    ctx.fill()
  }
  const img = ctx.getImageData(0, 0, c.width, c.height)
  return { width: c.width, height: c.height, data: new Uint8Array(img.data.buffer) }
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

function pinImage(color: string, letter: 'start' | 'end' | 'stop') {
  const size = 32
  const { c, ctx } = canvas(size)
  const cx = size / 2
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 4
  ctx.beginPath()
  ctx.arc(cx, cx, letter === 'stop' ? 8 : 11, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'
  ctx.fill()
  ctx.restore()
  ctx.beginPath()
  ctx.arc(cx, cx, letter === 'stop' ? 6 : 9, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.fillStyle = '#fff'
  if (letter === 'start') {
    // play triangle
    ctx.beginPath()
    ctx.moveTo(cx - 3, cx - 4.5)
    ctx.lineTo(cx + 4.5, cx)
    ctx.lineTo(cx - 3, cx + 4.5)
    ctx.closePath()
    ctx.fill()
  } else if (letter === 'end') {
    ctx.fillRect(cx - 3.5, cx - 3.5, 7, 7)
  } else {
    ctx.fillRect(cx - 2.5, cx - 1, 5, 2)
  }
  const img = ctx.getImageData(0, 0, c.width, c.height)
  return { width: c.width, height: c.height, data: new Uint8Array(img.data.buffer) }
}

export function vehicleIconName(status: DeviceStatus, selected = false) {
  return `veh-${status}${selected ? '-sel' : ''}`
}

/** Register all marker images on the current style (call after each style load). */
export function ensureIcons(map: MlMap) {
  for (const s of STATUSES) {
    const arrow = s === 'moving' || s === 'idle'
    for (const sel of [false, true]) {
      const name = vehicleIconName(s, sel)
      if (!map.hasImage(name)) map.addImage(name, vehicleImage(s, arrow, sel), { pixelRatio: PR })
    }
  }
  if (!map.hasImage('pin-start')) map.addImage('pin-start', pinImage('#10b981', 'start'), { pixelRatio: PR })
  if (!map.hasImage('pin-end')) map.addImage('pin-end', pinImage('#f43f5e', 'end'), { pixelRatio: PR })
  if (!map.hasImage('pin-stop')) map.addImage('pin-stop', pinImage('#0ea5e9', 'stop'), { pixelRatio: PR })
}
