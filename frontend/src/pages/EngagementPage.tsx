// EngagementPage — Weekly member engagement leaderboard
// API: GET /api/engagement/scores
// 5 scoring dimensions: Payments (40), Actions (25), Projects (20), App activity (5)
// Bottom performers NOT shown — club culture: celebrate top, don't shame bottom

import { useQuery } from '@tanstack/react-query'

interface BreakdownScore {
  payments: number
  actions: number
  projects: number
  app_activity: number
}

interface FamilyScore {
  family_name: string
  label: string
  total: number
  breakdown: BreakdownScore
  current_balance: number
}

interface EngagementResponse {
  week: number
  year: number
  as_at: string
  scores: FamilyScore[]
  max_score: number
  note: string
}

function ScoreBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return (
    <div style={{ background: '#0f172a', borderRadius: 4, height: 6, overflow: 'hidden' }}>
      <div style={{
        width: `${pct}%`, height: '100%',
        background: color,
        borderRadius: 4,
        transition: 'width 0.8s ease-out',
      }} />
    </div>
  )
}

const DIM_COLORS = {
  payments: '#4ade80',
  actions: '#60a5fa',
  projects: '#a78bfa',
  app_activity: '#fbbf24',
}

const DIM_LABELS = {
  payments: 'Payments',
  actions: 'Actions',
  projects: 'Projects',
  app_activity: 'App',
}

const DIM_MAX = {
  payments: 40,
  actions: 25,
  projects: 20,
  app_activity: 5,
}

const RANK_ICONS = ['🥇', '🥈', '🥉', '🏅', '🎖️']

function ScoreCard({ score, rank }: { score: FamilyScore; rank: number }) {
  const pct = Math.round((score.total / 90) * 100)
  const color = pct >= 80 ? '#4ade80' : pct >= 50 ? '#fbbf24' : '#f87171'

  return (
    <div style={{
      background: '#1e293b',
      border: `1px solid ${color}33`,
      borderRadius: 14,
      padding: '14px 16px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* rank glow */}
      {rank <= 3 && (
        <div style={{
          position: 'absolute', top: 0, right: 0,
          width: 60, height: 60,
          background: `radial-gradient(circle at top right, ${color}22, transparent 70%)`,
        }} />
      )}

      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>{RANK_ICONS[rank - 1] ?? '⭐'}</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>{score.label}</div>
            <div style={{ fontSize: 10, color: '#475569' }}>Rank #{rank}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1 }}>{score.total}</div>
          <div style={{ fontSize: 10, color: '#475569' }}>/ 90 pts</div>
        </div>
      </div>

      {/* overall bar */}
      <div style={{ marginBottom: 12 }}>
        <ScoreBar value={score.total} max={90} color={color} />
      </div>

      {/* dimension breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
        {(Object.keys(DIM_LABELS) as (keyof BreakdownScore)[]).map(dim => {
          const val = score.breakdown[dim]
          const max = DIM_MAX[dim]
          const c = DIM_COLORS[dim]
          return (
            <div key={dim}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 10, color: '#64748b' }}>{DIM_LABELS[dim]}</span>
                <span style={{ fontSize: 10, color: c, fontWeight: 600 }}>{val}/{max}</span>
              </div>
              <ScoreBar value={val} max={max} color={c} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function EngagementPage() {
  const { data, isLoading, error } = useQuery<EngagementResponse>({
    queryKey: ['engagement-scores'],
    queryFn: () => fetch('/api/engagement/scores', { credentials: 'include' }).then(r => r.json()),
    staleTime: 300_000,
    refetchInterval: 600_000,
  })

  const top5 = data?.scores?.slice(0, 5) ?? []

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* header */}
      <div>
        <h2 className="text-lg font-bold" style={{ color: '#f1f5f9' }}>
          Weekly Engagement
        </h2>
        {data && (
          <p className="text-xs mt-0.5" style={{ color: '#475569' }}>
            Week {data.week}, {data.year} · as at {data.as_at}
          </p>
        )}
      </div>

      {/* scoring legend */}
      <div className="rounded-xl p-3" style={{ background: '#1e293b', border: '1px solid #334155' }}>
        <div className="text-xs font-semibold mb-2" style={{ color: '#94a3b8' }}>How scores work</div>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(DIM_LABELS) as (keyof BreakdownScore)[]).map(dim => (
            <div key={dim} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: DIM_COLORS[dim], flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: '#64748b' }}>
                {DIM_LABELS[dim]} <span style={{ color: DIM_COLORS[dim] }}>({DIM_MAX[dim]} pts)</span>
              </span>
            </div>
          ))}
        </div>
        <div className="text-xs mt-2" style={{ color: '#334155' }}>
          Total: 90 pts max · Resets weekly · Top 5 shown
        </div>
      </div>

      {isLoading && (
        <div className="text-center py-10 text-sm" style={{ color: '#64748b' }}>
          Calculating scores...
        </div>
      )}

      {error && (
        <div className="text-center py-6 text-sm" style={{ color: '#f87171' }}>
          Could not load scores. Try again.
        </div>
      )}

      {/* leaderboard */}
      {top5.map((score, i) => (
        <ScoreCard key={score.family_name} score={score} rank={i + 1} />
      ))}

      {data && (
        <p className="text-xs text-center pb-2" style={{ color: '#1e293b' }}>
          {data.note}
        </p>
      )}
    </div>
  )
}
