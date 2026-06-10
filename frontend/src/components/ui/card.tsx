import { type HTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-[12px] border border-[var(--border)] bg-[var(--card)]', className)}
      {...props}
    />
  ),
)
Card.displayName = 'Card'

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 pb-2', className)} {...props} />
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold text-[var(--foreground)]', className)} {...props} />
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 pt-2', className)} {...props} />
}

/** Inset panel — the darker sub-card used for stats and rows in the original app. */
export function Inset({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-[8px] bg-[var(--card-inset)] border border-[var(--border-soft)]', className)}
      {...props}
    />
  )
}
