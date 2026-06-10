import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SseStep } from '@/lib/sseJob'

/**
 * Live "AI is thinking" panel — shows each streamed stage filling in (spinner on
 * the active line, green check on completed ones), a progress bar, and a running
 * timer, so the user watches the reasoning chain build instead of staring at a
 * single spinner.
 */
export function AiThinking({
  title, steps, step, total, running, startedAt,
}: {
  title: string
  steps: SseStep[]
  step: number
  total: number
  running: boolean
  startedAt: number
}) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 100)
    return () => clearInterval(t)
  }, [running, startedAt])

  const pct = total ? Math.min(100, Math.round((step / total) * 100)) : (running ? 8 : 0)

  return (
    <div className="py-2">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--foreground)]">
          <span className="text-base">🧠</span> {title}
        </div>
        <span className="text-[11px] tabular-nums text-[var(--muted-2)]">{elapsed.toFixed(1)}s</span>
      </div>

      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-[var(--background)]">
        <div className="h-full rounded-full transition-all duration-500 ease-out" style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#6366f1,#a78bfa)' }} />
      </div>

      <div className="space-y-2.5">
        {steps.map((s, i) => {
          const isLast = i === steps.length - 1
          const active = running && isLast
          return (
            <div key={i} className="bubble-pop flex items-start gap-2.5">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                {active ? (
                  <span className="block h-4 w-4 rounded-full border-2 border-[var(--border)] border-t-[#a78bfa]" style={{ animation: 'spin 0.8s linear infinite' }} />
                ) : (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full" style={{ background: 'rgba(34,197,94,.16)' }}>
                    <Check size={11} className="text-[#4ade80]" strokeWidth={3} />
                  </span>
                )}
              </span>
              <span className={cn('text-[12px] leading-snug', active ? 'font-medium text-[var(--foreground)]' : 'text-[var(--muted)]')}>
                {s.msg}
              </span>
            </div>
          )
        })}
        {steps.length === 0 && running && (
          <div className="flex items-center gap-2.5 text-[12px] text-[var(--muted)]">
            <span className="block h-4 w-4 rounded-full border-2 border-[var(--border)] border-t-[#a78bfa]" style={{ animation: 'spin 0.8s linear infinite' }} />
            Connecting to the AI…
          </div>
        )}
      </div>
    </div>
  )
}
