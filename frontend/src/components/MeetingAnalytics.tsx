import { useState } from 'react'

interface TrendPoint { ref: string; date: string; efficiency: number; planned_min: number | null; actual_min: number | null }
interface Analytics {
  trend: TrendPoint[]
  avg_efficiency: number | null
  direction: 'improving' | 'declining' | 'steady'
  recurring_sinks: { topic: string; meetings: number }[]
  time_by_topic: { label: string; total_min: number; avg_min: number; planned_min: number; occurrences: number }[]
  meetings_analysed: number
}

const effColor = (n: number) => n >= 75 ? '#4ade80' : n >= 50 ? '#fcd34d' : '#f87171'
const DIRECTION: Record<string, { label: string; color: string }> = {
  improving: { label: '↑ improving', color: '#4ade80' },
  declining: { label: '↓ declining', color: '#f87171' },
  steady:    { label: '→ steady',    color: '#94a3b8' },
}

export default function MeetingAnalytics({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)

  useState(() => {
    fetch('/api/meetings/analytics', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  })

  const maxTopic = Math.max(1, ...(data?.time_by_topic.map(t => t.total_min) ?? [1]))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg rounded-2xl p-5 space-y-4 max-h-[88vh] overflow-y-auto"
        style={{ background: '#121824', border: '1px solid #1e293b' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>Meeting Analytics</h2>
            <p className="text-[11px]" style={{ color: '#64748b' }}>How our meetings are run over time</p>
          </div>
          <button onClick={onClose} style={{ color: '#475569' }}>✕</button>
        </div>

        {loading ? (
          <p className="text-xs text-center py-8" style={{ color: '#475569' }}>Loading…</p>
        ) : !data || data.meetings_analysed === 0 ? (
          <p className="text-xs text-center py-8" style={{ color: '#64748b' }}>
            No analytics yet. Once a few meetings have been conducted and reviewed, trends will appear here.
          </p>
        ) : (
          <>
            {/* Headline */}
            <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: '#0d1829', border: '1px solid #1e293b' }}>
              {data.avg_efficiency != null && (
                <div className="flex-shrink-0 w-14 h-14 rounded-full flex items-center justify-center"
                  style={{ border: `2px solid ${effColor(data.avg_efficiency)}` }}>
                  <span className="text-lg font-bold" style={{ color: effColor(data.avg_efficiency) }}>{data.avg_efficiency}</span>
                </div>
              )}
              <div>
                <p className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>Average efficiency</p>
                <p className="text-[11px]" style={{ color: DIRECTION[data.direction].color }}>
                  {DIRECTION[data.direction].label} · across {data.meetings_analysed} reviewed meeting{data.meetings_analysed === 1 ? '' : 's'}
                </p>
              </div>
            </div>

            {/* Efficiency trend */}
            {data.trend.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider mb-2 font-semibold" style={{ color: '#94a3b8' }}>Efficiency trend</p>
                <div className="flex items-end gap-1.5" style={{ height: 90 }}>
                  {data.trend.map(t => (
                    <div key={t.ref} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${t.ref}: ${t.efficiency}`}>
                      <div className="w-full rounded-t" style={{ height: `${Math.max(4, t.efficiency)}%`, background: effColor(t.efficiency), minHeight: 4 }} />
                      <span className="text-[8px]" style={{ color: '#475569' }}>{t.ref.replace(/KIM\s*0*/i, '').split('/')[0]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recurring time sinks */}
            {data.recurring_sinks.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider mb-1.5 font-semibold" style={{ color: '#94a3b8' }}>Recurring time sinks</p>
                <div className="space-y-1">
                  {data.recurring_sinks.map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-xs rounded-lg px-2.5 py-1.5"
                      style={{ background: '#7f1d1d22', border: '1px solid #7f1d1d44' }}>
                      <span className="capitalize" style={{ color: '#fca5a5' }}>{s.topic}</span>
                      <span className="text-[10px]" style={{ color: '#94a3b8' }}>{s.meetings} meetings</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] mt-1" style={{ color: '#475569' }}>Topics that have run long more than once — candidates for pre-circulated materials or tighter timeboxing.</p>
              </div>
            )}

            {/* Time by topic */}
            {data.time_by_topic.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider mb-2 font-semibold" style={{ color: '#94a3b8' }}>Where meeting time goes</p>
                <div className="space-y-1.5">
                  {data.time_by_topic.map((t, i) => (
                    <div key={i}>
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span className="truncate" style={{ color: '#cbd5e1' }}>{t.label}</span>
                        <span style={{ color: '#64748b' }}>{t.total_min}m total · {t.avg_min}m avg</span>
                      </div>
                      <div className="rounded-full h-1.5 overflow-hidden" style={{ background: '#1e293b' }}>
                        <div className="h-full rounded-full" style={{ width: `${(t.total_min / maxTopic) * 100}%`, background: '#3b82f6' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
