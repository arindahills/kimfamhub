import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Play, X, ChevronLeft, ChevronRight } from 'lucide-react'

type Item = { src: string; type: 'image' | 'video' }

function deriveCaption(src: string): string {
  const file = src.split('/').pop() || src
  const name = file.replace(/\.[^.]+$/, '')
  // Date-stamped files (WhatsApp, estimate docs, etc.) → "19 May 2026"
  const dateMatch = name.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (dateMatch) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return `${parseInt(dateMatch[3])} ${months[parseInt(dateMatch[2]) - 1]} ${dateMatch[1]}`
  }
  // Clean underscores/hyphens, strip _img_ / _vid_ noise, title-case
  return name
    .replace(/_(img|vid)_?/gi, ' ')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase())
}

/**
 * In-card horizontal media slider. Tapping any tile opens a full-screen in-app
 * lightbox carousel (swipeable, videos play inline, closing returns to the app).
 * The lightbox is portaled to <body> because the project card carries a CSS
 * transform (scroll-focus), which would otherwise trap a position:fixed overlay.
 */
export function MediaCarousel({ images, videos }: { images: string[]; videos: string[] }) {
  const items: Item[] = [
    ...images.map(src => ({ src, type: 'image' as const })),
    ...videos.map(src => ({ src, type: 'video' as const })),
  ]
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  if (!items.length) return null

  const photoCount = images.length
  const videoCount = videos.length
  const countLabel = [
    photoCount > 0 && `${photoCount} photo${photoCount > 1 ? 's' : ''}`,
    videoCount > 0 && `${videoCount} video${videoCount > 1 ? 's' : ''}`,
  ].filter(Boolean).join(' · ')

  return (
    <>
      <div className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((m, i) => (
          <button
            key={i}
            onClick={() => { setIndex(i); setOpen(true) }}
            className="relative flex-shrink-0 snap-start overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--background)]"
            style={{ width: 96 }}
          >
            <div className="aspect-square w-full overflow-hidden">
              {m.type === 'image'
                ? <img src={m.src} className="h-full w-full object-cover" alt="" loading="lazy" />
                : (
                  <>
                    <video src={m.src} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/35"><Play size={16} className="text-white" fill="white" /></span>
                  </>
                )}
            </div>
            <div className="px-1 py-1 text-center" style={{ fontSize: 9, color: '#64748b', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {deriveCaption(m.src)}
            </div>
          </button>
        ))}
      </div>
      {countLabel && (
        <p className="mt-1 text-[10px]" style={{ color: '#475569' }}>{countLabel}</p>
      )}
      {open && <Lightbox items={items} index={index} setIndex={setIndex} onClose={() => setOpen(false)} />}
    </>
  )
}

function Lightbox({
  items, index, setIndex, onClose,
}: {
  items: Item[]; index: number; setIndex: (i: number) => void; onClose: () => void
}) {
  const track = useRef<HTMLDivElement>(null)

  // Centre the tapped item on open, lock body scroll, wire Escape to close.
  useEffect(() => {
    ;(track.current?.children[index] as HTMLElement | undefined)?.scrollIntoView({ inline: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [onClose])

  const go = (d: number) => {
    const next = Math.max(0, Math.min(items.length - 1, index + d))
    setIndex(next)
    ;(track.current?.children[next] as HTMLElement | undefined)?.scrollIntoView({ behavior: 'smooth', inline: 'center' })
  }
  const onScroll = () => {
    const el = track.current
    if (!el) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    if (i !== index) setIndex(i)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/95"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[13px] font-medium text-white/80">{index + 1} / {items.length}</span>
        <button onClick={onClose} aria-label="Close" className="rounded-full bg-white/10 p-2 text-white active:scale-95"><X size={20} /></button>
      </div>

      <div
        ref={track}
        onScroll={onScroll}
        className="flex flex-1 snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((m, i) => (
          <div key={i} className="flex h-full w-screen shrink-0 snap-center items-center justify-center p-3">
            {m.type === 'image'
              ? <img src={m.src} className="max-h-full max-w-full object-contain" alt="" />
              : <video src={m.src} className="max-h-full max-w-full" controls playsInline preload="metadata" />}
          </div>
        ))}
      </div>

      {items.length > 1 && (
        <>
          <button onClick={() => go(-1)} disabled={index === 0} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white disabled:opacity-25"><ChevronLeft size={24} /></button>
          <button onClick={() => go(1)} disabled={index === items.length - 1} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white disabled:opacity-25"><ChevronRight size={24} /></button>
        </>
      )}

      <div className="px-4 py-1 text-center">
        <p className="text-[12px] font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>{deriveCaption(items[index].src)}</p>
      </div>

      <div className="flex justify-center gap-1.5 py-2">
        {items.map((_, i) => (
          <span key={i} className="h-1.5 rounded-full transition-all" style={{ width: i === index ? 18 : 6, background: i === index ? '#fff' : 'rgba(255,255,255,.4)' }} />
        ))}
      </div>
    </div>,
    document.body,
  )
}
