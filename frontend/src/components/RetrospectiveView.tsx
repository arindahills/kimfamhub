export interface Retrospective {
  efficiency_score?: number
  headline?: string
  overall?: string
  planned_total_min?: number
  actual_total_min?: number
  items?: {
    label: string
    verdict?: 'on_time' | 'over' | 'under'
    what_consumed_time?: string
    produced_output?: boolean
    mission_link?: string
    do_better?: string
  }[]
  time_sinks?: string[]
  decision_density_note?: string
  recommendations?: string[]
}

const VERDICT: Record<string, { label: string; color: string }> = {
  on_time: { label: 'on time', color: '#4ade80' },
  over:    { label: 'over',    color: '#f87171' },
  under:   { label: 'under',   color: '#93c5fd' },
}

export default function RetrospectiveView({ retro }: { retro: Retrospective }) {
  const score = retro.efficiency_score ?? null
  const scoreColor = score == null ? '#64748b' : score >= 75 ? '#4ade80' : score >= 50 ? '#fcd34d' : '#f87171'
  return (
    <div className="space-y-3 text-left">
      {/* Score + headline */}
      <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: '#0d1829', border: '1px solid #1e293b' }}>
        {score != null && (
          <div className="flex-shrink-0 w-14 h-14 rounded-full flex items-center justify-center"
            style={{ border: `2px solid ${scoreColor}` }}>
            <span className="text-lg font-bold" style={{ color: scoreColor }}>{score}</span>
          </div>
        )}
        <div className="flex-1">
          {retro.headline && <p className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>{retro.headline}</p>}
          {(retro.planned_total_min != null && retro.actual_total_min != null) && (
            <p className="text-[11px] mt-0.5" style={{ color: '#64748b' }}>
              Planned {retro.planned_total_min}m · Actual {retro.actual_total_min}m
            </p>
          )}
        </div>
      </div>

      {retro.overall && (
        <p className="text-xs leading-relaxed" style={{ color: '#cbd5e1' }}>{retro.overall}</p>
      )}

      {/* Per-item */}
      {retro.items && retro.items.length > 0 && (
        <div className="space-y-1.5">
          {retro.items.map((it, i) => {
            const v = it.verdict ? VERDICT[it.verdict] : null
            return (
              <div key={i} className="rounded-lg p-2.5" style={{ background: '#0d1829', border: '1px solid #1e293b' }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold truncate" style={{ color: '#e2e8f0' }}>{it.label}</span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {v && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: v.color, background: v.color + '22' }}>{v.label}</span>}
                    {it.produced_output === false && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: '#fca5a5', background: '#7f1d1d33' }}>no output</span>
                    )}
                  </div>
                </div>
                {it.what_consumed_time && <p className="text-[11px] mt-1" style={{ color: '#94a3b8' }}>{it.what_consumed_time}</p>}
                {it.do_better && <p className="text-[11px] mt-1" style={{ color: '#5eead4' }}>→ {it.do_better}</p>}
                {it.mission_link && <p className="text-[10px] mt-1" style={{ color: '#475569' }}>Ties to: {it.mission_link}</p>}
              </div>
            )
          })}
        </div>
      )}

      {retro.decision_density_note && (
        <div className="rounded-lg p-2.5" style={{ background: '#1e1b4b33', border: '1px solid #4c1d9544' }}>
          <p className="text-[10px] uppercase tracking-wider mb-1 font-semibold" style={{ color: '#c4b5fd' }}>Decision density</p>
          <p className="text-[11px]" style={{ color: '#cbd5e1' }}>{retro.decision_density_note}</p>
        </div>
      )}

      {retro.time_sinks && retro.time_sinks.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider mb-1 font-semibold" style={{ color: '#94a3b8' }}>Time sinks</p>
          <div className="flex flex-wrap gap-1.5">
            {retro.time_sinks.map((t, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 rounded-full" style={{ color: '#fca5a5', background: '#7f1d1d33', border: '1px solid #7f1d1d55' }}>{t}</span>
            ))}
          </div>
        </div>
      )}

      {retro.recommendations && retro.recommendations.length > 0 && (
        <div className="rounded-lg p-2.5" style={{ background: '#0d1829', border: '1px solid #1e3a5f' }}>
          <p className="text-[10px] uppercase tracking-wider mb-1.5 font-semibold" style={{ color: '#93c5fd' }}>For next meeting</p>
          <ul className="space-y-1">
            {retro.recommendations.map((rec, i) => (
              <li key={i} className="text-[11px] flex gap-1.5" style={{ color: '#cbd5e1' }}>
                <span style={{ color: '#3b82f6' }}>•</span>{rec}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
