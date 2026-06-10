import { useEffect, useRef, useState } from 'react'

/**
 * Tracks whether the element is currently in view. Unlike a fire-once hook,
 * `inView` flips back to false when the card scrolls away and true again when
 * it returns — so count-up / reveal animations replay on every re-entry.
 */
export function useInView<T extends HTMLElement = HTMLDivElement>(rootMargin = '0px 0px -12% 0px') {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => setInView(e.isIntersecting),
      { threshold: 0.35, rootMargin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [rootMargin])

  return { ref, seen: inView }
}
