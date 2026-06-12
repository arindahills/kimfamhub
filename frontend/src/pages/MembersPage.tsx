import { useQuery } from '@tanstack/react-query'

interface MemberRow {
  name: string
  initial_obligation: string
  paid_initial: string
  balance_initial: string
  total_contributions: string
  paid_current: string
  balance_current: string
  combined_balance: string
}

interface MembersData {
  as_of: string
  members: MemberRow[]
}

interface FamilyProfile {
  family_id: string
  family_name: string
  parents: string[]
  members: string[]
  children: Array<{ name: string; birthday: string }>
  composition: string
}

interface FamilyProfilesData {
  families: FamilyProfile[]
}

const FAMILY_COLORS: Record<string, string> = {
  Alex: '#3b82f6', Israel: '#22c55e', Max: '#a78bfa',
  Solomon: '#f59e0b', Viola: '#ec4899', Hellen: '#14b8a6', Priscilla: '#f97316',
}

const CHART_COLORS = ['#3b82f6','#22c55e','#a78bfa','#f59e0b','#ec4899','#14b8a6','#f97316']

function bal(s: string) {
  const n = parseInt((s || '0').replace(/[^0-9-]/g, '')) || 0
  return n
}

function BalBadge({ value }: { value: string }) {
  const n = bal(value)
  if (n === 0) return <span style={{ color: '#4ade80', fontSize: 11 }}>All clear</span>
  if (n < 0) return <span style={{ color: '#4ade80', fontSize: 11 }}>UGX {Math.abs(n).toLocaleString()} credit</span>
  return <span style={{ color: '#f87171', fontSize: 11 }}>UGX {n.toLocaleString()} owed</span>
}

function SvgPie({ labels, values, colors, size = 150 }: { labels: string[]; values: number[]; colors: string[]; size?: number }) {
  const total = values.reduce((a, b) => a + b, 0)
  if (total <= 0) return null
  const r = size / 2 - 4
  const cx = size / 2
  const cy = size / 2
  let angle = -Math.PI / 2
  const slices = values.map((v, i) => {
    const sweep = (v / total) * 2 * Math.PI
    const x1 = cx + r * Math.cos(angle)
    const y1 = cy + r * Math.sin(angle)
    angle += sweep
    const x2 = cx + r * Math.cos(angle)
    const y2 = cy + r * Math.sin(angle)
    const large = sweep > Math.PI ? 1 : 0
    return { path: `M${cx} ${cy}L${x1} ${y1}A${r} ${r} 0 ${large} 1 ${x2} ${y2}Z`, color: colors[i % colors.length] }
  })
  return (
    <svg width={size} height={size} style={{ display: 'block', margin: '0 auto' }}>
      {slices.map((s, i) => <path key={i} d={s.path} fill={s.color} stroke="#0f172a" strokeWidth={1.5} />)}
    </svg>
  )
}

function PieChartCard({ title, labels, values, emptyText }: { title: string; labels: string[]; values: number[]; emptyText: string }) {
  const hasValues = values.some(v => v > 0)
  const total = values.reduce((a, b) => a + b, 0)

  if (!hasValues) {
    return (
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)' }}>
        <h3 className="text-xs font-semibold mb-1" style={{ color: '#22c55e', textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</h3>
        <p style={{ color: '#22c55e', fontSize: 13, padding: '10px 0' }}>✓ {emptyText}</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)' }}>
      <h3 className="text-xs font-semibold mb-3" style={{ color: '#22c55e', textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</h3>
      <SvgPie labels={labels} values={values} colors={CHART_COLORS} size={150} />
      <div style={{ marginTop: 12 }}>
        {labels.map((l, i) => {
          const pct = total > 0 ? ((values[i] / total) * 100).toFixed(1) : '0'
          return (
            <div key={l} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #334155' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0, display: 'inline-block' }} />
                <span style={{ fontSize: 13, color: '#cbd5e1' }}>{l}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: CHART_COLORS[i % CHART_COLORS.length] }}>
                  UGX {values[i].toLocaleString()}
                </span>
                <span style={{ fontSize: 11, color: '#64748b', marginLeft: 6 }}>{pct}%</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function MembersPage() {
  const { data: membersData, isLoading: mLoading } = useQuery<MembersData>({
    queryKey: ['members'],
    queryFn: () => fetch('/api/members', { credentials: 'include' }).then(r => r.json()),
  })

  const { data: profilesData } = useQuery<FamilyProfilesData>({
    queryKey: ['family-profiles'],
    queryFn: () => fetch('/api/family-profiles', { credentials: 'include' }).then(r => r.json()),
  })

  const profiles = profilesData?.families || []

  if (mLoading) return <p className="text-xs text-center py-10" style={{ color: 'var(--text-muted)' }}>Loading...</p>

  const members = membersData?.members || []

  // Chart data from vanilla app: contributions pie, obligations with initial pie, obligations without initial pie
  const names = members.map(m => m.name.replace(/^THE\s+/i, ''))
  const chartContrib = members.map(m => Math.max(0, bal(m.total_contributions)))
  const chartOblWith = members.map(m => Math.max(0, bal(m.combined_balance)))
  const chartOblWithout = members.map(m => Math.max(0, bal(m.balance_current)))

  return (
    <div className="max-w-2xl md:max-w-5xl mx-auto">
      {membersData?.as_of && (
        <p className="text-xs mb-3" style={{ color: '#475569' }}>As of {membersData.as_of}</p>
      )}

      {members.length === 0 && (
        <div className="rounded-xl p-6 text-center" style={{ background: 'var(--bg-card)' }}>
          <div className="text-3xl mb-3">👥</div>
          <p className="text-sm font-semibold mb-1" style={{ color: '#f1f5f9' }}>Members data unavailable</p>
          <p className="text-xs" style={{ color: '#64748b' }}>Member data is temporarily unavailable. The finance team has been notified.</p>
        </div>
      )}

      {/* Pie charts — matching vanilla app layout */}
      {members.length > 0 && (
        <div className="space-y-3 mb-4">
          <PieChartCard
            title="Current Contributions vs. Member"
            labels={names}
            values={chartContrib}
            emptyText="All families are up to date."
          />
          <PieChartCard
            title="Obligations (with Initial) vs. Member"
            labels={names}
            values={chartOblWith}
            emptyText="All families are clear."
          />
          <PieChartCard
            title="Obligations (without Initial) vs. Member"
            labels={names}
            values={chartOblWithout}
            emptyText="All families are clear."
          />
        </div>
      )}

      {/* Family member cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {members.map(m => {
        const col = FAMILY_COLORS[m.name] || '#94a3b8'
        const profile = profiles.find(p => p.family_name === m.name || p.family_name.startsWith(m.name))

        return (
          <div key={m.name} className="rounded-xl p-4"
            style={{ background: 'var(--bg-card)', borderLeft: `4px solid ${col}` }}>
            <div className="flex justify-between items-start mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                  style={{ background: col + '33', color: col }}>
                  {(m.name.replace(/^THE\s+/i, '')[0] || m.name[0] || '?').toUpperCase()}
                </div>
                <div>
                  <div className="font-semibold text-sm" style={{ color: '#f1f5f9' }}>{m.name}</div>
                  {profile && (
                    <div className="text-[10px]" style={{ color: '#64748b' }}>{profile.composition}</div>
                  )}
                </div>
              </div>
              <BalBadge value={m.combined_balance} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {([
                ['Total Contributed', m.total_contributions],
                ['Monthly Balance', m.balance_current],
                ['Initial Obligation', m.initial_obligation],
                ['Initial Balance', m.balance_initial],
              ] as [string, string][]).map(([label, val]) => (
                <div key={label}>
                  <div className="text-[10px]" style={{ color: '#475569' }}>{label}</div>
                  <div className="text-xs font-semibold" style={{ color: '#cbd5e1' }}>
                    {val ? `UGX ${val}` : '—'}
                  </div>
                </div>
              ))}
            </div>

            {profile?.children && profile.children.length > 0 && (
              <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                <div className="text-[10px] mb-1" style={{ color: '#475569' }}>Children</div>
                <div className="flex flex-wrap gap-1">
                  {profile.children.map(c => (
                    <span key={c.name} className="text-[10px] px-2 py-0.5 rounded-full"
                      style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }}>
                      {c.name}{c.birthday ? ` · ${c.birthday}` : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}
      </div>
    </div>
  )
}
