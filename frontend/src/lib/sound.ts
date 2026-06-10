/**
 * Tiny synthesised "pop" via Web Audio — no audio asset to ship. iOS Safari
 * blocks audio until a user gesture, so we resume the context on the first
 * touch/click anywhere in the app.
 */
let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  return ctx
}

if (typeof window !== 'undefined') {
  const unlock = () => { getCtx()?.resume?.() }
  window.addEventListener('touchstart', unlock, { once: true, passive: true })
  window.addEventListener('click', unlock, { once: true })
}

/** Soft rising blip used when the "why join" bubble appears. */
export function playPop() {
  const c = getCtx()
  if (!c) return
  try {
    if (c.state === 'suspended') c.resume()
    const t = c.currentTime
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(440, t)
    o.frequency.exponentialRampToValueAtTime(880, t + 0.12)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26)
    o.connect(g).connect(c.destination)
    o.start(t)
    o.stop(t + 0.28)
  } catch {
    /* ignore — audio is a nice-to-have, never block the UI */
  }
}
