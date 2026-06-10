import { useEffect, useRef, useState, type CSSProperties } from 'react'

/**
 * Cycles through a list of phrases with a type-on / pause / delete rhythm,
 * leaving a blinking caret. Used in the top bar to surface the club's mission
 * lines under the "KimFam Hub" brand. The first phrase is the club's name so
 * the bar reads correctly on first paint.
 */
export function Typewriter({
  phrases,
  typeMs = 55,
  deleteMs = 28,
  holdMs = 1900,
  className,
  style,
}: {
  phrases: string[]
  typeMs?: number
  deleteMs?: number
  holdMs?: number
  className?: string
  style?: CSSProperties
}) {
  const [idx, setIdx] = useState(0)
  const [len, setLen] = useState(phrases[0]?.length ?? 0) // start fully typed
  const [deleting, setDeleting] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const phrase = phrases[idx] ?? ''
    let delay: number

    if (!deleting && len < phrase.length) {
      delay = typeMs
      timer.current = setTimeout(() => setLen(l => l + 1), delay)
    } else if (!deleting && len === phrase.length) {
      delay = holdMs
      timer.current = setTimeout(() => setDeleting(true), delay)
    } else if (deleting && len > 0) {
      delay = deleteMs
      timer.current = setTimeout(() => setLen(l => l - 1), delay)
    } else {
      // finished deleting → next phrase
      timer.current = setTimeout(() => {
        setDeleting(false)
        setIdx(i => (i + 1) % phrases.length)
      }, 350)
    }
    return () => clearTimeout(timer.current)
  }, [len, deleting, idx, phrases, typeMs, deleteMs, holdMs])

  const text = (phrases[idx] ?? '').slice(0, len)

  return (
    <span className={className} style={style} aria-label={phrases[0]}>
      {text}
      <span className="tw-caret" aria-hidden style={{ opacity: 0.7 }}>|</span>
    </span>
  )
}
