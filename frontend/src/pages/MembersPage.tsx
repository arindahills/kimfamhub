import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FamilyProfileModal } from '../components/FamilyProfileModal'
import { LABEL_TO_KEY, FAMILY_HEAD_AVATAR, FAMILY_COLORS } from '../data/familyTree'

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

function FamilyAvatar({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  const [err, setErr] = useState(false)
  const key = FAMILY_HEAD_AVATAR[name.toUpperCase()]
  const initial = name.charAt(0).toUpperCase()
  if (err || !key) {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: color + '33', border: `2px solid ${color}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.38, fontWeight: 700, color,
      }}>{initial}</div>
    )
  }
  return (
    <img src={`/static/avatars/${key}.jpg`} onError={() => setErr(true)} alt={name}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${color}`, flexShrink: 0 }} />
  )
}

const CHART_COLORS = ['#3b82f6','#22c55e','#a78bfa','#f59e0b','#ec4899','#14b8a6','#f97316']

function bal(s: string) {
  const n = parseInt((s || '0').replace(/[^0-9-]/g, '')) || 0
  return n
}

function fmtVal(s: string) {
  if (!s) return '—'
  const n = parseInt(s.replace(/[^0-9-]/g, ''))
  if (isNaN(n)) return '—'
  const abs = Math.abs(n).toLocaleString()
  return n < 0 ? `UGX -${abs}` : `UGX ${abs}`
}

function BalBadge({ value }: { value: string }) {
  const { t } = useTranslation()
  const n = bal(value)
  if (n === 0) return <span style={{ color: '#4ade80', fontSize: 11 }}>{t('members.allClear')}</span>
  if (n < 0) return <span style={{ color: '#4ade80', fontSize: 11 }}>UGX {Math.abs(n).toLocaleString()} {t('members.credit')}</span>
  return <span style={{ color: '#f87171', fontSize: 11 }}>UGX {n.toLocaleString()} {t('members.owed')}</span>
}

function SvgPie({ labels: _labels, values, colors, size = 150 }: { labels: string[]; values: number[]; colors: string[]; size?: number }) {
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
  const { t } = useTranslation()
  const [openProfile, setOpenProfile] = useState<string | null>(null)
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
          <p className="text-sm font-semibold mb-1" style={{ color: '#f1f5f9' }}>{t('members.dataUnavailable')}</p>
          <p className="text-xs" style={{ color: '#64748b' }}>{t('members.dataUnavailableSub')}</p>
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
                <FamilyAvatar name={m.name.replace(/^THE\s+/i, '')} color={col} size={32} />
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
                [t('members.totalContributed'), m.total_contributions],
                [t('members.monthlyBalance'), m.balance_current],
                [t('members.initialObligation'), m.initial_obligation],
                [t('members.initialBalance'), m.balance_initial],
              ] as [string, string][]).map(([label, val]) => (
                <div key={label}>
                  <div className="text-[10px]" style={{ color: '#475569' }}>{label}</div>
                  <div className="text-xs font-semibold" style={{ color: '#cbd5e1' }}>
                    {fmtVal(val)}
                  </div>
                </div>
              ))}
            </div>

            {profile?.children && profile.children.length > 0 && (
              <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                <div className="text-[10px] mb-1" style={{ color: '#94a3b8' }}>{t('members.children')}</div>
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

            {(() => {
              const label = 'The ' + m.name.replace(/^THE\s+/i, '').charAt(0) + m.name.replace(/^THE\s+/i, '').slice(1).toLowerCase()
              if (!LABEL_TO_KEY[label]) return null
              return (
                <button
                  onClick={() => setOpenProfile(label)}
                  className="mt-3 w-full text-xs font-semibold rounded-lg py-2"
                  style={{ background: col + '1a', color: col, border: `1px solid ${col}44`, cursor: 'pointer' }}
                >
                  {t('members.viewFamilyProfile')} →
                </button>
              )
            })()}
          </div>
        )
      })}
      </div>

      {/* Pie charts — after family cards */}
      {members.length > 0 && (
        <div className="space-y-3 mt-4">
          <PieChartCard
            title={t('members.chartContributions')}
            labels={names}
            values={chartContrib}
            emptyText={t('members.allClearFamilies')}
          />
          <PieChartCard
            title={t('members.chartOblWith')}
            labels={names}
            values={chartOblWith}
            emptyText={t('members.allClearObl')}
          />
          <PieChartCard
            title={t('members.chartOblWithout')}
            labels={names}
            values={chartOblWithout}
            emptyText={t('members.allClearObl')}
          />
        </div>
      )}

      {openProfile && (
        <FamilyProfileModal familyLabel={openProfile} onClose={() => setOpenProfile(null)} />
      )}
    </div>
  )
}
