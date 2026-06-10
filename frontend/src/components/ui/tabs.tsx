import * as TabsPrimitive from '@radix-ui/react-tabs'
import { type ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export const Tabs = TabsPrimitive.Root

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('flex gap-1 overflow-x-auto rounded-[10px] bg-[var(--card-inset)] p-1', className)}
      {...props}
    />
  )
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'whitespace-nowrap rounded-[8px] px-3 py-1.5 text-xs font-semibold text-[var(--muted)] transition-colors',
        'data-[state=active]:bg-[var(--primary)] data-[state=active]:text-white',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('mt-3 focus:outline-none', className)} {...props} />
}
