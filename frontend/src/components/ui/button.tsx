import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-semibold ' +
    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ' +
    'disabled:opacity-50 disabled:pointer-events-none select-none',
  {
    variants: {
      variant: {
        primary: 'bg-[var(--primary)] text-[var(--primary-fg)] hover:brightness-110',
        success: 'bg-[var(--success)] text-white hover:brightness-110',
        danger: 'bg-[var(--danger)] text-white hover:brightness-110',
        outline:
          'border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--surface)]',
        ghost: 'bg-transparent text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]',
        subtle: 'bg-[var(--card-inset)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
)
Button.displayName = 'Button'

export { buttonVariants }
