import { useQuery } from '@tanstack/react-query'
import { BarChart3 } from 'lucide-react'
import { MiniChart, type Series } from '@/components/projects/MiniChart'
import { ugx } from '@/lib/utils'

/** Live sheep card panel (chicken parity) — KPIs + flock-trend / births-vs-deaths charts,
 *  read live from the sheep_* Postgres tables. Shown under "Show Details" on the sheep card. */

interface SheepDetail {
  summary?: { dorper_line_alive: number; total_deaths: number; mortality_rate_pct: number; expenses_to_date: number; net_position: number; sales_income: number }
  chart?: { months: string[]; flock: number[]; births: number[]; deaths: number[] }
  expense_breakdown?: Record<string, number>
  alerts?: { level: string; kind: string; text: string }[]
}

const fmtMonth = (ym: string) => {
  const [y, m] = ym.split('-')
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]} '${y.slice(2)}`
}

function Kpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-[10px] bg-[var(--background)] p-2.5 text-center">
      <div className="text-sm font-bold tabular-nums" style={{ color: color || 'white' }}>{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--muted-2)]">{label}</div>
    </div>
  )
}

export function SheepLivePanel() {
  const { data } = useQuery<SheepDetail>({
    queryKey: ['detail', 'sheep'],
    queryFn: () => fetch('/api/projects/sheep/detail', { credentials: 'include' }).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() }),
  })
  const s = data?.summary
  const c = data?.chart
  if (!s) return null

  const labels = (c?.months || []).map(fmtMonth)
  const flockSeries: Series[] = [{ name: 'Flock', data: c?.flock || [], kind: 'line', color: '#4ade80' }]
  const bdSeries: Series[] = [
    { name: 'Births', data: c?.births || [], kind: 'bar', color: '#4ade80' },
    { name: 'Deaths', data: c?.deaths || [], kind: 'bar', color: '#f87171' },
  ]
  const expenses = Object.entries(data?.expense_breakdown || {}).sort((a, b) => b[1] - a[1])
  const expMax = Math.max(1, ...expenses.map(([, v]) => v))

  return (
    <div className="mt-3 rounded-[12px] border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="mb-2.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--success)]">
        <BarChart3 size={12} /> Live sheep tracker
      </div>
      {(data?.alerts || []).map((a, i) => (
        <div key={i} className="mb-2 flex items-start gap-1.5 rounded-[8px] p-2 text-[11px]"
          style={a.level === 'warn'
            ? { border: '1px solid rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.08)', color: '#fca5a5' }
            : { border: '1px solid rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.08)', color: '#fcd34d' }}>
          <span className="shrink-0">{a.level === 'warn' ? '⚠' : 'ℹ'}</span><span>{a.text}</span>
        </div>
      ))}
      <div className="grid grid-cols-4 gap-2">
        <Kpi label="Flock" value={String(s.dorper_line_alive)} color="#4ade80" />
        <Kpi label="Deaths" value={String(s.total_deaths)} color="#f87171" />
        <Kpi label="Mortality" value={`${s.mortality_rate_pct}%`} />
        <Kpi label="Net" value={ugx(s.net_position)} color={s.net_position < 0 ? '#f87171' : '#4ade80'} />
      </div>

      {labels.length > 1 && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] text-[var(--muted-2)]">Flock trend</div>
          <MiniChart labels={labels} series={flockSeries} />
        </div>
      )}
      {labels.length > 0 && (c!.births.some(v => v) || c!.deaths.some(v => v)) && (
        <div className="mt-2">
          <div className="mb-1 text-[11px] text-[var(--muted-2)]">Births vs deaths</div>
          <MiniChart labels={labels} series={bdSeries} />
        </div>
      )}

      {expenses.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[11px] text-[var(--muted-2)]">Expenses by category</div>
          <div className="space-y-1.5">
            {expenses.map(([cat, v]) => (
              <div key={cat} className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-[11px] text-[var(--muted)]">{cat.replace('_', ' ')}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--background)]">
                  <div className="h-full rounded-full bg-[#60a5fa]" style={{ width: `${Math.round((v / expMax) * 100)}%` }} />
                </div>
                <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-[#cbd5e1]">{ugx(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mt-2.5 text-[10px] text-[var(--muted-2)]">Data entered in-app by Solomon / admin — live from the database, not a spreadsheet.</div>
    </div>
  )
}
