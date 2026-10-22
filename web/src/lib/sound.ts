import type { EventType } from '@/api/types'

/**
 * Tiny synthesized notification sounds (WebAudio, no audio files).
 * Browsers only allow audio after a user gesture, so the context is created lazily and
 * resumed on the first pointer/key interaction.
 */
let ctx: AudioContext | null = null
let lastPlay = 0

function audio(): AudioContext | null {
  if (ctx) return ctx
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  try {
    ctx = new AC()
  } catch {
    return null
  }
  return ctx
}

let unlockInstalled = false
/** Install one-shot listeners that unlock audio on the first user gesture. */
export function installAudioUnlock() {
  if (unlockInstalled) return
  unlockInstalled = true
  const unlock = () => {
    const c = audio()
    if (c && c.state === 'suspended') void c.resume()
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}

function tone(c: AudioContext, freq: number, start: number, dur: number, gain: number, type: OscillatorType = 'sine') {
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, start)
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(gain, start + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  o.connect(g).connect(c.destination)
  o.start(start)
  o.stop(start + dur + 0.02)
}

export function playEventSound(type: EventType) {
  const c = audio()
  if (!c || c.state !== 'running') return
  const now = performance.now()
  // collapse bursts into one chime (alarms always play)
  if (type !== 'alarm' && now - lastPlay < 900) return
  lastPlay = now
  const t = c.currentTime + 0.01
  if (type === 'alarm') {
    // urgent two-tone, repeated twice
    for (let i = 0; i < 2; i++) {
      tone(c, 880, t + i * 0.32, 0.14, 0.16, 'triangle')
      tone(c, 660, t + i * 0.32 + 0.15, 0.14, 0.16, 'triangle')
    }
  } else if (type === 'overspeed') {
    tone(c, 740, t, 0.12, 0.09, 'triangle')
    tone(c, 740, t + 0.16, 0.12, 0.09, 'triangle')
  } else {
    // soft rising "ding"
    tone(c, 880, t, 0.22, 0.07)
    tone(c, 1318.5, t + 0.08, 0.3, 0.05)
  }
}
