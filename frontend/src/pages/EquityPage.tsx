import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface FamilyRow {
  family: string
  family_id: number
  members: number
  opening_credit: number
  total_contributed: number
  allocated_A: number
  allocated_B: number
  allocated_C: number
  equity_A: number
  equity_B: number
  equity_C: number
  equity_A_pct: number
  equity_B_pct: number
  equity_C_pct: number
  weight_C_pct: number
  obligation_C: number
  equity_A_pp: number
  equity_B_pp: number
  equity_C_pp: number
}

interface ExpenseDetail {
  date: string
  desc: string
  amount: number
  cat: string
  proj: string
  eq: number
  fams: Record<string, { pool: number; pool_pct: number; aA: number; aB: number; aC: number }>
}

interface ProjectSummary {
  key: string
  label: string
  total: number
  families: Record<string, { aA: number; aB: number; aC: number; pctA: number; pctB: number; pctC: number }>
}

interface EquityData {
  opening_balance: number
  opening_per_family: number
  total_expenses: number
  total_eq_A: number
  total_eq_B: number
  total_eq_C: number
  family_summary: FamilyRow[]
  expense_detail: ExpenseDetail[]
  project_summaries: ProjectSummary[]
  model_a_desc: string
  model_b_desc: string
  model_c_desc: string
  decision_status: string
  decision_note: string
}

const FAMILY_COLORS = ['#3b82f6','#22c55e','#a78bfa','#f59e0b','#ec4899','#14b8a6','#f97316']

const MODEL_A_COLOR = '#60a5fa'
const MODEL_B_COLOR = '#f59e0b'
const MODEL_C_COLOR = '#a78bfa'

const PROJ_COLORS: Record<string, string> = {
  chicken: '#22c55e', sheep: '#f59e0b', trees: '#a78bfa',
  staff: '#60a5fa', event: '#f87171', loan: '#fb923c', other: '#64748b',
}

const ugx = (v: number | null | undefined) => 'UGX ' + Math.abs(v || 0).toLocaleString()

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl p-5 text-center" style={{ background: 'var(--bg-card)' }}>
      <div className="text-xs mb-1" style={{ color: '#94a3b8' }}>{label}</div>
      <div className="text-2xl font-bold" style={{ color }}>{ugx(value)}</div>
    </div>
  )
}

function ModelDescCard({ title, color, desc, pros }: { title: string; color: string; desc: string; pros: string[] }) {
  return (
    <div style={{ background: '#0f172a', border: `2px solid ${color}`, borderRadius: 10, padding: 10, flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 9, color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>{title}</div>
      <div style={{ fontSize: 10, color: '#f1f5f9', fontWeight: 600, marginBottom: 5 }}>{pros[0]}</div>
      <div style={{ fontSize: 9, color: '#94a3b8', lineHeight: 1.5, marginBottom: 6 }}>{desc}</div>
      <div style={{ background: '#1e293b', borderRadius: 6, padding: 6, fontSize: 9, color: '#64748b' }}>
        {pros.map((p, i) => <div key={i}>&#x2714; {p}</div>)}
      </div>
    </div>
  )
}

type ModelKey = 'A' | 'B' | 'C'

interface VoteState {
  tally: Record<ModelKey, number>
  total_families: number
  families_voted: number
  my_family_id: string | null
  my_vote: ModelKey | null
}

const MODEL_META: { key: ModelKey; name: string; color: string }[] = [
  { key: 'A', name: 'Equal Share', color: MODEL_A_COLOR },
  { key: 'B', name: 'Proportional', color: MODEL_B_COLOR },
  { key: 'C', name: "Solomon's", color: MODEL_C_COLOR },
]

function EquityVoteWidget() {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data: vote, isLoading } = useQuery<VoteState>({
    queryKey: ['equity-vote'],
    queryFn: () => fetch('/api/club/equity/vote', { credentials: 'include' }).then(r => r.json()),
  })

  const mutation = useMutation({
    mutationFn: (model: ModelKey) =>
      fetch('/api/club/equity/vote', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      }).then(r => { if (!r.ok) throw new Error('vote failed'); return r.json() }),
    onSuccess: (fresh: VoteState) => qc.setQueryData(['equity-vote'], fresh),
  })

  const askAi = () => {
    sessionStorage.setItem('ask:prefill', 'Explain the three equity models (A, B and C) and show how my family stands under each. Stay neutral — do not tell me how to vote.')
    navigate('/ask')
  }

  if (isLoading || !vote) {
    return (
      <div style={{ background: '#451a03', border: '2px solid #f59e0b', borderRadius: 10, padding: 12 }}>
        <div style={{ fontSize: 12, color: '#fbbf24', fontWeight: 700 }}>Family Vote — KIM 008/2026</div>
        <div style={{ fontSize: 11, color: '#a16207', marginTop: 2 }}>Loading vote…</div>
      </div>
    )
  }

  const totalVotes = vote.tally.A + vote.tally.B + vote.tally.C
  const leader = (['A', 'B', 'C'] as ModelKey[]).reduce((a, b) => vote.tally[b] > vote.tally[a] ? b : a, 'A')

  return (
    <div style={{ background: '#1e1408', border: '2px solid #f59e0b', borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🗳️</span>
          <span style={{ fontSize: 13, color: '#fbbf24', fontWeight: 700 }}>Family Vote — KIM 008/2026</span>
        </div>
        <span style={{ fontSize: 10, color: '#a16207' }}>{vote.families_voted}/{vote.total_families} families voted</span>
      </div>
      <div style={{ fontSize: 11, color: '#a16207', marginBottom: 12 }}>
        Each family casts ONE vote for the allocation model. You can change your vote until KIM 009/2026.
      </div>

      {/* Model buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {MODEL_META.map(m => {
          const mine = vote.my_vote === m.key
          const count = vote.tally[m.key]
          const pct = totalVotes ? Math.round((count / totalVotes) * 100) : 0
          return (
            <button
              key={m.key}
              onClick={() => mutation.mutate(m.key)}
              disabled={mutation.isPending}
              style={{
                flex: 1,
                background: mine ? m.color + '26' : '#0f172a',
                border: mine ? `2px solid ${m.color}` : '1px solid #334155',
                borderRadius: 10,
                padding: '10px 6px',
                cursor: mutation.isPending ? 'wait' : 'pointer',
                textAlign: 'center',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: m.color }}>Model {m.key}</div>
              <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 6 }}>{m.name}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: mine ? m.color : '#cbd5e1' }}>{count}</div>
              {/* mini bar */}
              <div style={{ height: 4, borderRadius: 2, background: '#1e293b', marginTop: 6, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: m.color, transition: 'width 0.3s' }} />
              </div>
              {mine && <div style={{ fontSize: 8, color: m.color, fontWeight: 700, marginTop: 4 }}>✓ YOUR VOTE</div>}
            </button>
          )
        })}
      </div>

      {/* Status line */}
      <div style={{ fontSize: 11, color: '#cbd5e1', marginBottom: 10 }}>
        {vote.my_family_id
          ? (vote.my_vote
              ? <>Your family voted <b style={{ color: MODEL_META.find(m => m.key === vote.my_vote)!.color }}>Model {vote.my_vote}</b>. Tap another to change.</>
              : <>Your family ({vote.my_family_id}) hasn't voted yet — tap a model above.</>)
          : <span style={{ color: '#a16207' }}>Your account isn't linked to a family, so you can view but not vote.</span>}
        {totalVotes > 0 && <span style={{ color: '#64748b' }}>{'  '}Leading: Model {leader}.</span>}
      </div>

      {/* Ask AI — neutral guidance */}
      <button
        onClick={askAi}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '9px 12px',
          color: '#93c5fd', fontSize: 11, fontWeight: 600, cursor: 'pointer',
        }}
      >
        🤖 Ask KimFam to explain the models for my family
      </button>
    </div>
  )
}

export default function EquityPage() {
  const [activeModel, setActiveModel] = useState<ModelKey>('B')
  const [showAll, setShowAll] = useState(true)

  const { data, isLoading } = useQuery<EquityData>({
    queryKey: ['equity'],
    queryFn: () => fetch('/api/club/equity', { credentials: 'include' }).then(r => r.json()),
  })

  if (isLoading) return <p className="text-xs text-center py-10" style={{ color: 'var(--text-muted)' }}>Loading...</p>
  if (!data) return <p className="text-xs text-center py-10" style={{ color: '#f87171' }}>Failed to load equity data.</p>

  const families = data.family_summary || []
  const sorted = (key: (f: FamilyRow) => number) => [...families].sort((a, b) => key(b) - key(a))
  const modelColor = (m: ModelKey) => m === 'A' ? MODEL_A_COLOR : m === 'B' ? MODEL_B_COLOR : MODEL_C_COLOR
  const equityKey = (m: ModelKey) => `equity_${m}` as 'equity_A' | 'equity_B' | 'equity_C'
  const pctKey = (m: ModelKey) => `equity_${m}_pct` as 'equity_A_pct' | 'equity_B_pct' | 'equity_C_pct'
  const totalKey = (m: ModelKey) => `total_eq_${m}` as 'total_eq_A' | 'total_eq_B' | 'total_eq_C'

  const tabs: { key: ModelKey | 'all'; label: string; color?: string }[] = [
    { key: 'all', label: 'All Models', color: '#94a3b8' },
    { key: 'A', label: 'Model A', color: MODEL_A_COLOR },
    { key: 'B', label: 'Model B', color: MODEL_B_COLOR },
    { key: 'C', label: 'Model C', color: MODEL_C_COLOR },
  ]

  const renderStackedBar = (m: ModelKey) => {
    const list = families.sort((a, b) => (b[pctKey(m)] || 0) - (a[pctKey(m)] || 0))
    return (
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)' }}>
        <div className="flex rounded-full h-5 overflow-hidden mb-3">
          {list.map((f, i) => (
            <div key={f.family} title={`${f.family}: ${f[pctKey(m)]?.toFixed(1)}%`}
              style={{ width: `${f[pctKey(m)] || 0}%`, background: FAMILY_COLORS[i % FAMILY_COLORS.length] }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {list.map((f, i) => (
            <div key={f.family} className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: FAMILY_COLORS[i % FAMILY_COLORS.length] }} />
              <span className="text-[10px]" style={{ color: '#94a3b8' }}>
                {f.family} {f[pctKey(m)]?.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const renderFamilyCards = (m: ModelKey) => {
    const list = sorted(f => f[equityKey(m)])
    const total = data[totalKey(m)] || 0
    const color = modelColor(m)
    return (
      <>
        <SummaryCard label={`Total Club Equity (Model ${m})`} value={total} color={color} />
        {renderStackedBar(m)}
        {list.map((f, i) => (
          <div key={f.family} className="rounded-xl p-4"
            style={{ background: 'var(--bg-card)', borderLeft: `4px solid ${FAMILY_COLORS[i % FAMILY_COLORS.length]}` }}>
            <div className="flex justify-between items-baseline mb-2">
              <span className="font-semibold text-sm" style={{ color: '#f1f5f9' }}>{f.family}</span>
              <span className="text-lg font-bold" style={{ color: FAMILY_COLORS[i % FAMILY_COLORS.length] }}>
                {(f[pctKey(m)] || 0).toFixed(1)}%
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px]" style={{ color: '#475569' }}>Total Contributed</div>
                <div className="text-xs font-semibold" style={{ color: '#cbd5e1' }}>{ugx(f.total_contributed)}</div>
              </div>
              <div>
                <div className="text-[10px]" style={{ color: '#475569' }}>Current Equity</div>
                <div className="text-xs font-semibold" style={{ color: FAMILY_COLORS[i % FAMILY_COLORS.length] }}>{ugx(f[equityKey(m)])}</div>
              </div>
            </div>
            <div className="mt-2 rounded-full h-1.5 overflow-hidden" style={{ background: '#0f172a' }}>
              <div className="h-full rounded-full" style={{
                width: `${f[pctKey(m)] || 0}%`,
                background: FAMILY_COLORS[i % FAMILY_COLORS.length],
              }} />
            </div>
          </div>
        ))}
      </>
    )
  }

  const renderAllModelsView = () => (
    <>
      {/* Total pots */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4">
        <SummaryCard label="Total Equity — Model A" value={data.total_eq_A} color={MODEL_A_COLOR} />
        <SummaryCard label="Total Equity — Model B" value={data.total_eq_B} color={MODEL_B_COLOR} />
        <SummaryCard label="Total Equity — Model C" value={data.total_eq_C} color={MODEL_C_COLOR} />
      </div>

      {/* Model description cards */}
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, minWidth: 420 }}>
          <ModelDescCard title="Model A — Equal Share" color={MODEL_A_COLOR}
            desc={data.model_a_desc} pros={['Simple', 'Protects low-balance families']} />
          <ModelDescCard title="Model B — Proportional" color={MODEL_B_COLOR}
            desc={data.model_b_desc} pros={['Rigorous', 'Rewards consistent contributors']} />
          <ModelDescCard title="Model C — Solomon" color={MODEL_C_COLOR}
            desc={data.model_c_desc} pros={['Predictable fixed %', 'Reflects family size']} />
        </div>
      </div>

      {/* Side-by-side equity table */}
      <div className="rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid #1e3a5f', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', background: '#0f172a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#f1f5f9', fontWeight: 700 }}>Current Family Equity in Account</span>
          <span style={{ fontSize: 9, color: '#475569' }}>After all {data.expense_detail.length} expenses deducted</span>
        </div>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ minWidth: 480, width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: '#475569', background: '#0f172a', borderBottom: '1px solid #1e3a5f' }}>Family</th>
                <th style={{ padding: '6px 10px', textAlign: 'center', fontSize: 10, color: '#475569', background: '#0f172a', borderBottom: '1px solid #1e3a5f' }}>Members</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 10, color: MODEL_A_COLOR, background: '#0f172a', borderBottom: '1px solid #1e3a5f' }}>Model A</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 10, color: MODEL_B_COLOR, background: '#0f172a', borderBottom: '1px solid #1e3a5f' }}>Model B</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 10, color: MODEL_C_COLOR, background: '#0f172a', borderBottom: '1px solid #1e3a5f' }}>Model C</th>
              </tr>
            </thead>
            <tbody>
              {families.map(f => (
                <tr key={f.family}>
                  <td style={{ padding: '8px 10px', fontSize: 12, color: '#f1f5f9', fontWeight: 600, borderBottom: '1px solid #0f172a' }}>{f.family}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', fontSize: 10, color: '#64748b', borderBottom: '1px solid #0f172a' }}>{f.members}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 12, color: MODEL_A_COLOR, fontWeight: 600, borderBottom: '1px solid #0f172a' }}>
                    {ugx(f.equity_A)}<div style={{ fontSize: 9, color: '#475569' }}>{f.equity_A_pct}% stake</div>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 12, color: MODEL_B_COLOR, fontWeight: 600, borderBottom: '1px solid #0f172a' }}>
                    {ugx(f.equity_B)}<div style={{ fontSize: 9, color: '#475569' }}>{f.equity_B_pct}% stake</div>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 12, color: MODEL_C_COLOR, fontWeight: 600, borderBottom: '1px solid #0f172a' }}>
                    {ugx(f.equity_C)}<div style={{ fontSize: 9, color: '#475569' }}>{f.equity_C_pct}% stake</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '8px 14px', background: '#0f172a', borderTop: '1px solid #1e3a5f', fontSize: 10, color: '#64748b' }}>
          Equity = Opening credit ({ugx(data.opening_per_family)}) + contributions paid − allocated expense share
        </div>
      </div>

      {/* Per-project breakdown */}
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid #1e3a5f' }}>
        <div style={{ fontSize: 11, color: '#60a5fa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
          Per-Project Profit Entitlement
        </div>
        <div style={{ fontSize: 10, color: '#64748b', marginBottom: 10 }}>
          Each family's share of what was invested per project — and the % they receive back when that project returns money.
        </div>
        {data.project_summaries.map(ps => {
          const hc = PROJ_COLORS[ps.key] || '#64748b'
          const fams = Object.keys(ps.families)
          return (
            <div key={ps.key} style={{ background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 8, padding: 12, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: hc, fontWeight: 700 }}>{ps.label}</span>
                <span style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 700 }}>{ugx(ps.total)}</span>
              </div>
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <div style={{ minWidth: 460 }}>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                    <span style={{ fontSize: 9, color: '#334155', minWidth: 72 }}>Family</span>
                    <span style={{ fontSize: 9, color: MODEL_A_COLOR, flex: 1, textAlign: 'right' }}>Model A</span>
                    <span style={{ fontSize: 9, color: '#334155', width: 28 }} />
                    <span style={{ fontSize: 9, color: MODEL_B_COLOR, flex: 1, textAlign: 'right' }}>Model B</span>
                    <span style={{ fontSize: 9, color: '#334155', width: 28 }} />
                    <span style={{ fontSize: 9, color: MODEL_C_COLOR, flex: 1, textAlign: 'right' }}>Model C</span>
                    <span style={{ fontSize: 9, color: '#334155', width: 28 }} />
                  </div>
                  {fams.map(fn => {
                    const ff = ps.families[fn]
                    return (
                      <div key={fn} style={{ display: 'flex', gap: 4, padding: '4px 0', borderBottom: '1px solid #0f172a', fontSize: 10 }}>
                        <span style={{ color: '#94a3b8', minWidth: 72 }}>{fn}</span>
                        <span style={{ color: MODEL_A_COLOR, flex: 1, textAlign: 'right' }}>{ugx(ff.aA)}</span>
                        <span style={{ color: '#475569', width: 28, textAlign: 'right' }}>{ff.pctA}%</span>
                        <span style={{ color: MODEL_B_COLOR, flex: 1, textAlign: 'right' }}>{ugx(ff.aB)}</span>
                        <span style={{ color: '#475569', width: 28, textAlign: 'right' }}>{ff.pctB}%</span>
                        <span style={{ color: MODEL_C_COLOR, flex: 1, textAlign: 'right' }}>{ugx(ff.aC || 0)}</span>
                        <span style={{ color: '#475569', width: 28, textAlign: 'right' }}>{ff.pctC || 0}%</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Expense log */}
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid #1e3a5f' }}>
        <div style={{ fontSize: 11, color: '#60a5fa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
          Full Expense Log ({data.expense_detail.length} records)
        </div>
        <div style={{ fontSize: 10, color: '#64748b', marginBottom: 10 }}>
          Total: {ugx(data.total_expenses)}. Expand any row for per-family split.
        </div>
        {data.expense_detail.map((e, i) => {
          const projTag = e.proj ? <span style={{ background: '#1e3a5f', color: '#93c5fd', fontSize: 8, padding: '1px 5px', borderRadius: 8, marginLeft: 4 }}>{e.proj}</span> : null
          const fams = Object.keys(e.fams)
          const detailsId = `exp-detail-${i}`
          return (
            <details key={detailsId} style={{ marginBottom: 4 }}>
              <summary style={{ cursor: 'pointer', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 6, padding: '7px 10px', listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 11, color: '#f1f5f9' }}>{e.date} — {e.desc.substring(0, 40)}{e.desc.length > 40 ? '...' : ''}</div>
                  <div style={{ fontSize: 9, color: '#64748b', marginTop: 1 }}>{e.cat}{projTag}</div>
                </div>
                <span style={{ fontSize: 11, color: '#f87171', fontWeight: 600, flexShrink: 0, marginLeft: 8 }}>-{ugx(e.amount)}</span>
              </summary>
              <div style={{ border: '1px solid #1e3a5f', borderTop: 'none', borderRadius: '0 0 6px 6px', padding: '8px 10px', background: '#0a0f1a' }}>
                <div style={{ display: 'flex', gap: 4, marginBottom: 3 }}>
                  <span style={{ fontSize: 8, color: '#334155', minWidth: 72 }}>Family</span>
                  <span style={{ fontSize: 8, color: '#334155', flex: '0 0 32px', textAlign: 'right' }}>Pool%</span>
                  <span style={{ fontSize: 8, color: MODEL_A_COLOR, flex: 1, textAlign: 'right' }}>Model A</span>
                  <span style={{ fontSize: 8, color: MODEL_B_COLOR, flex: 1, textAlign: 'right' }}>Model B</span>
                  <span style={{ fontSize: 8, color: MODEL_C_COLOR, flex: 1, textAlign: 'right' }}>Model C</span>
                </div>
                {fams.map(fn => {
                  const ff = e.fams[fn]
                  return (
                    <div key={fn} style={{ display: 'flex', gap: 4, fontSize: 9, padding: '2px 0', borderBottom: '1px solid #0f172a' }}>
                      <span style={{ color: '#64748b', minWidth: 72 }}>{fn}</span>
                      <span style={{ color: '#475569', flex: '0 0 32px', textAlign: 'right' }}>{ff.pool_pct}%</span>
                      <span style={{ color: MODEL_A_COLOR, flex: 1, textAlign: 'right' }}>{Number(ff.aA).toLocaleString()}</span>
                      <span style={{ color: MODEL_B_COLOR, flex: 1, textAlign: 'right' }}>{Number(ff.aB).toLocaleString()}</span>
                      <span style={{ color: MODEL_C_COLOR, flex: 1, textAlign: 'right' }}>{Number(ff.aC || 0).toLocaleString()}</span>
                    </div>
                  )
                })}
                <div style={{ marginTop: 4, fontSize: 9, color: '#334155' }}>Equal share: {ugx(e.eq)}/family</div>
              </div>
            </details>
          )
        })}
      </div>

      {/* Footer */}
      <div style={{ background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 10, padding: 14 }}>
        <div style={{ fontSize: 11, color: '#60a5fa', fontWeight: 700, marginBottom: 10 }}>What This Means for Returns</div>
        <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.8 }}>
          Each family's equity stake determines their share of any future profits from ALL club investments. On a project: management (Solomon) takes 30%, the remaining 70% is split by family equity %. Within each family the share is split equally among all members (adults and children).
        </div>
      </div>
    </>
  )

  return (
    <div className="max-w-2xl md:max-w-5xl mx-auto space-y-4">
      {/* Live family vote widget (replaces the old static banner) */}
      <EquityVoteWidget />

      {/* Explainer download */}
      <div style={{ textAlign: 'right' }}>
        <a href="/docs/governance/KIMFAM_Equity_Models_Explainer.docx" download
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '7px 14px', color: '#60a5fa', fontSize: 11, fontWeight: 600, textDecoration: 'none' }}>
          📄 Download Equity Models Explainer
        </a>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl p-1" style={{ background: 'var(--bg-card)' }}>
        {tabs.map(tab => {
          const isActive = tab.key === 'all' ? showAll : !showAll && activeModel === tab.key
          const col = tab.color || '#94a3b8'
          return (
            <button key={tab.key} onClick={() => {
              if (tab.key === 'all') { setShowAll(true); setActiveModel('B') }
              else { setShowAll(false); setActiveModel(tab.key as ModelKey) }
            }}
              className="flex-1 text-xs font-semibold py-2 px-1 rounded-lg transition-all"
              style={{
                background: isActive ? col + '33' : 'transparent',
                color: isActive ? col : '#64748b',
                border: isActive ? `1px solid ${col}44` : '1px solid transparent',
              }}>
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Content based on tab */}
      {showAll ? renderAllModelsView() : renderFamilyCards(activeModel)}

      {/* Attribution note */}
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)' }}>
        <p className="text-xs leading-relaxed" style={{ color: '#64748b' }}>
          Equity is calculated proportionally to each family's pool at the date of each expense.
          Post-recoupment profit split: Club 50% / Investor 20% / Management 30%.
        </p>
      </div>
    </div>
  )
}
