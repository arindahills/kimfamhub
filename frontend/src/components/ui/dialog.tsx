import { type ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

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
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-[101] w-[calc(100vw-24px)] max-w-lg -translate-x-1/2 -translate-y-1/2',
          'max-h-[88vh] overflow-y-auto rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-2xl',
          'focus:outline-none',
          className,
        )}
      >
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
        <div className="p-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
