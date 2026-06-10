import { type HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-[6px] px-2 py-0.5 text-[11px] font-semibold leading-tight',
  {
    variants: {
      tone: {
        neutral: 'bg-[var(--card-inset)] text-[var(--muted)] border border-[var(--border)]',
        success: 'bg-[var(--success-soft)] text-[#6ee7b7] border border-[var(--success-border)]',
        warning: 'bg-[#3b1f00] text-[#fbbf24] border border-[#7c5300]',
        danger: 'bg-[var(--danger-soft)] text-[#fca5a5] border border-[#991b1b]',
        info: 'bg-[var(--info-soft)] text-[var(--info)] border border-[#1d4ed8]',
        purple: 'bg-[#2d1b69] text-[#c4b5fd] border border-[#5b21b6]',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}
