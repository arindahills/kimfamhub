import { type ReactNode, useState, useEffect } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

function useIsDesktop() {
  const [d, setD] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 640)
  useEffect(() => {
    const h = () => setD(window.innerWidth >= 640)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return d
}

export function DialogContent({
  className,
  children,
  title,
  subtitle,
}: {
  className?: string
  children: ReactNode
  title?: ReactNode
  subtitle?: ReactNode
}) {
  const desktop = useIsDesktop()
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-[2px]"
        style={{ animation: 'overlay-in .2s ease' }}
      />
      <DialogPrimitive.Content
        className={cn(
          'fixed z-[101] overflow-y-auto bg-[var(--surface)] shadow-2xl focus:outline-none',
          desktop
            ? 'left-1/2 top-1/2 w-[calc(100vw-24px)] max-w-lg max-h-[88vh] -translate-x-1/2 -translate-y-1/2 rounded-[16px] border border-[var(--border)]'
            : 'inset-x-0 bottom-0 max-h-[92vh] rounded-t-[22px] border-t border-[var(--border)]',
          className,
        )}
        style={{ animation: desktop ? 'pop-in .18s ease' : 'sheet-up .28s cubic-bezier(.32,.72,0,1)' }}
      >
        {!desktop && <div className="mx-auto mt-2.5 mb-0.5 h-1.5 w-10 shrink-0 rounded-full bg-[var(--border)]" />}
        {(title || subtitle) && (
          <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4">
            <div>
              {title && <DialogPrimitive.Title className="text-base font-semibold text-[var(--foreground)]">{title}</DialogPrimitive.Title>}
              {subtitle && <p className="mt-0.5 text-[11px] text-[var(--muted-2)]">{subtitle}</p>}
            </div>
            <DialogPrimitive.Close className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--card)] hover:text-[var(--foreground)]">
              <X size={18} />
            </DialogPrimitive.Close>
          </div>
        )}
        <div className="p-5" style={!desktop ? { paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' } : undefined}>{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
