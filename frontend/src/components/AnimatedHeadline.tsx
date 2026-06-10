import { useEffect, useState } from 'react'

/**
 * Renders a hero headline like "60% PRODUCTION RATE" or "580K MONTHLY REVENUE"
 * with the FIRST numeric token counting up from 0 → target when `run` is true.
 * Everything around the number (suffix %/K/M, label text) is preserved.
 */
const NUM_RE = /(\d[\d,]*(?:\.\d+)?)([%KMB]?)/

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

export function AnimatedHeadline({ text, run, duration = 1100 }: { text: string; run: boolean; duration?: number }) {
  const m = text.match(NUM_RE)

  // No number to count — give the words a reveal instead so every highlight
  // animates on view. `key` flips with `run` so the CSS animation replays each
  // time the card re-enters the viewport.
  if (!m) {
    return run
      ? <span key="in" className="metric-reveal inline-block">{text}</span>
      : <span key="out">{text}</span>
  }

  const raw = m[1]
  const suffix = m[2]
  const target = Number(raw.replace(/,/g, ''))
  const hadCommas = raw.includes(',')
  const decimals = raw.includes('.') ? raw.split('.')[1].length : 0
  const before = text.slice(0, m.index)
  const after = text.slice((m.index ?? 0) + m[0].length)

  const [val, setVal] = useState(run ? 0 : target)

  useEffect(() => {
    if (!run) return
    if (Number.isNaN(target)) return setVal(target)
    setVal(0) // reset so the count-up replays from zero on every re-entry
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      setVal(target * easeOutCubic(t))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [run, target, duration])

  const shown = decimals > 0 ? val.toFixed(decimals) : Math.round(val).toString()
  const formatted = hadCommas ? Number(shown).toLocaleString('en-US') : shown

  return (
    <>
      {before}
      <span className="tabular-nums">{formatted}{suffix}</span>
      {after}
    </>
  )
}
