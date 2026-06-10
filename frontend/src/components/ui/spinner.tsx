import { cn } from '@/lib/utils'

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-block rounded-full border-2 border-[var(--border)] border-t-[var(--success)]', className)}
      style={{ width: 22, height: 22, animation: 'spin 0.7s linear infinite' }}
    />
  )
}

export function LoadingRow({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-[var(--muted)]">
      <Spinner />
      <span className="text-xs">{label}</span>
    </div>
  )
}
