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

  return (
    <div className="max-w-2xl md:max-w-5xl mx-auto">
      {membersData?.as_of && (
        <p className="text-xs mb-3" style={{ color: '#475569' }}>As of {membersData.as_of}</p>
      )}

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
                  {m.name[0]}
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
