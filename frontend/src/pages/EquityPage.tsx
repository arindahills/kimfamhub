import { useQuery } from '@tanstack/react-query'

interface FamilyRow {
  family: string
  total_contributed: number
  equity_B: number
  equity_B_pct: number
}

interface EquityData {
  family_summary: FamilyRow[]
  total_eq_B: number
}

const FAMILY_COLORS = ['#3b82f6','#22c55e','#a78bfa','#f59e0b','#ec4899','#14b8a6','#f97316']

const ugx = (v: number) => 'UGX ' + Math.abs(v || 0).toLocaleString()

export default function EquityPage() {
  const { data, isLoading } = useQuery<EquityData>({
    queryKey: ['equity'],
    queryFn: () => fetch('/api/club/equity', { credentials: 'include' }).then(r => r.json()),
  })

  if (isLoading) return <p className="text-xs text-center py-10" style={{ color: 'var(--text-muted)' }}>Loading...</p>

  const families = (data?.family_summary || []).sort((a, b) => (b.equity_B_pct || 0) - (a.equity_B_pct || 0))
  const total = data?.total_eq_B || 0

  return (
    <div className="max-w-2xl md:max-w-5xl mx-auto space-y-4">

      {/* Total pot */}
      <div className="rounded-xl p-5 text-center" style={{ background: 'var(--bg-card)' }}>
        <div className="text-xs mb-1" style={{ color: '#94a3b8' }}>Total Club Equity</div>
        <div className="text-2xl font-bold" style={{ color: '#22c55e' }}>{ugx(total)}</div>
      </div>

      {/* Stacked bar */}
      {families.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)' }}>
          <h3 className="text-xs font-semibold mb-3" style={{ color: 'var(--text-muted)' }}>EQUITY SHARE</h3>
          <div className="flex rounded-full h-5 overflow-hidden mb-3">
            {families.map((f, i) => (
              <div key={f.family} title={`${f.family}: ${f.equity_B_pct?.toFixed(1)}%`}
                style={{ width: `${f.equity_B_pct || 0}%`, background: FAMILY_COLORS[i % FAMILY_COLORS.length] }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {families.map((f, i) => (
              <div key={f.family} className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ background: FAMILY_COLORS[i % FAMILY_COLORS.length] }} />
                <span className="text-[10px]" style={{ color: '#94a3b8' }}>
                  {f.family} {f.equity_B_pct?.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-family cards */}
      {families.map((f, i) => (
        <div key={f.family} className="rounded-xl p-4"
          style={{ background: 'var(--bg-card)', borderLeft: `4px solid ${FAMILY_COLORS[i % FAMILY_COLORS.length]}` }}>
          <div className="flex justify-between items-baseline mb-2">
            <span className="font-semibold text-sm" style={{ color: '#f1f5f9' }}>{f.family}</span>
            <span className="text-lg font-bold" style={{ color: FAMILY_COLORS[i % FAMILY_COLORS.length] }}>
              {(f.equity_B_pct || 0).toFixed(1)}%
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px]" style={{ color: '#475569' }}>Total Contributed</div>
              <div className="text-xs font-semibold" style={{ color: '#cbd5e1' }}>{ugx(f.total_contributed)}</div>
            </div>
            <div>
              <div className="text-[10px]" style={{ color: '#475569' }}>Current Equity</div>
              <div className="text-xs font-semibold" style={{ color: '#22c55e' }}>{ugx(f.equity_B)}</div>
            </div>
          </div>
          <div className="mt-2 rounded-full h-1.5 overflow-hidden" style={{ background: '#0f172a' }}>
            <div className="h-full rounded-full" style={{
              width: `${f.equity_B_pct || 0}%`,
              background: FAMILY_COLORS[i % FAMILY_COLORS.length],
            }} />
          </div>
        </div>
      ))}

      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)' }}>
        <p className="text-xs leading-relaxed" style={{ color: '#64748b' }}>
          Equity is calculated proportionally to each family's pool at the date of each expense.
          Post-recoupment profit split: Club 50% / Investor 20% / Management 30%.
        </p>
      </div>
    </div>
  )
}
