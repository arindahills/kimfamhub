import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X, Users, Briefcase, TreePine, Calendar, ChevronRight, Star } from 'lucide-react'
import { FAMILY_TREE, LABEL_TO_KEY, parseAge, formatBirthday, type FamilyNode, type FamilyMember, type Milestone } from '../data/familyTree'

// ── helpers ──────────────────────────────────────────────────────────────────

function Avatar({ name, avatarKey, size = 36, color }: { name: string; avatarKey: string; size?: number; color: string }) {
  const [err, setErr] = useState(false)
  const initial = name.charAt(0).toUpperCase()
  if (err) {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: color + '22', border: `2px solid ${color}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.38, fontWeight: 700, color,
      }}>{initial}</div>
    )
  }
  return (
    <img
      src={`/static/avatars/${avatarKey}.jpg`}
      onError={() => setErr(true)}
      alt={name}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${color}`, flexShrink: 0 }}
    />
  )
}

// ── family stats ─────────────────────────────────────────────────────────────

function nextBirthdayDays(bday: string | null): number | null {
  if (!bday) return null
  const parts = bday.match(/(\d{1,2})\s+(\w+)/)
  if (!parts) return null
  const MON: Record<string, number> = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 }
  const mon = MON[parts[2].toLowerCase().slice(0,3)]
  if (mon === undefined) return null
  const today = new Date()
  let next = new Date(today.getFullYear(), mon, parseInt(parts[1]))
  if (next < today) next = new Date(today.getFullYear() + 1, mon, parseInt(parts[1]))
  return Math.ceil((next.getTime() - today.getTime()) / 86400000)
}

function FamilyStats({ node }: { node: FamilyNode }) {
  const { t } = useTranslation()
  const allFamilies = FAMILY_TREE.filter(f => f.birthOrder > 0)
  const allMembers = FAMILY_TREE.flatMap(f => f.members)
  const allGrandkids = FAMILY_TREE.flatMap(f => f.children)

  // Compute stats
  const isNodeRoot = node.birthOrder === 0
  const totalMembers = isNodeRoot ? allMembers.length : node.members.length
  const totalGrandkids = isNodeRoot ? allGrandkids.length : node.children.length

  // Next birthday across this family's members + kids
  const candidates = [...node.members, ...node.children]
  const upcomingBirthdays = candidates
    .map(p => ({ name: p.name, days: nextBirthdayDays(p.birthday) }))
    .filter(x => x.days !== null)
    .sort((a, b) => (a.days ?? 999) - (b.days ?? 999))
  const next = upcomingBirthdays[0]

  // Youngest / oldest (full year birthday only)
  const ages = node.members.map(m => parseAge(m.birthday)).filter((a): a is number => a !== null)
  const youngest = ages.length ? Math.min(...ages) : null
  const oldest   = ages.length ? Math.max(...ages) : null

  // New additions (born 2022+)
  const recentBirths = [...node.members, ...node.children]
    .filter(p => p.birthday && /202[2-9]|20[3-9]\d/.test(p.birthday))

  // For root: cross-family stats
  const familyCount = isNodeRoot ? allFamilies.length : null

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
      {/* Members */}
      <StatChip icon="👥" label={isNodeRoot ? t('family.coreMembers') : t('family.members', { count: totalMembers })} value={String(totalMembers)} color={node.color} />
      {/* Children / grandkids */}
      <StatChip icon="👶" label={isNodeRoot ? t('family.grandchildren', { count: totalGrandkids }) : t('family.children', { count: totalGrandkids })} value={String(totalGrandkids)} color={node.color} />
      {/* Age range */}
      {oldest !== null && youngest !== null && oldest !== youngest && (
        <StatChip icon="🎂" label={t('family.ageRange')} value={`${youngest}–${oldest} ${t('family.yrs')}`} color={node.color} />
      )}
      {/* Next birthday */}
      {next && (
        <StatChip
          icon="🎉"
          label={`${next.name.split(' ')[0]}'s ${t('family.birthday').toLowerCase()}`}
          value={next.days === 0 ? t('family.today') : next.days === 1 ? t('family.tomorrow') : t('family.inDays', { days: next.days })}
          color={next.days! <= 7 ? '#f59e0b' : node.color}
        />
      )}
      {/* Recent additions */}
      {recentBirths.length > 0 && (
        <StatChip icon="✨" label="Born 2022+" value={`${recentBirths.length} ${recentBirths.length > 1 ? t('family.additionsSincePlural') : t('family.additionsSince')}`} color={node.color} />
      )}
      {/* Family branches (root view only) */}
      {familyCount !== null && (
        <StatChip icon="🌳" label={t('family.familyBranches')} value={String(familyCount)} color={node.color} />
      )}
    </div>
  )
}

function StatChip({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <div style={{
      background: color + '14', border: `1px solid ${color}33`,
      borderRadius: 10, padding: '8px 10px',
    }}>
      <div style={{ fontSize: 18, marginBottom: 2 }}>{icon}</div>
      <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

// ── animated lineage tree ─────────────────────────────────────────────────────

const CHILD_FAMILIES = FAMILY_TREE.filter(f => f.birthOrder > 0)
// x positions for 6 children across 360px (pad 28px each side)
const CHILD_X = [28, 88, 148, 208, 268, 332]
const ROOT_X = 180
const ROOT_Y = 44
const CHILD_Y = 148
const GRANDKID_Y = 222

function LineageTree({ activeKey, onNodeClick }: { activeKey: string; onNodeClick?: (key: string) => void }) {
  const isRootView = activeKey === 'kikangis'
  return (
    <div style={{ overflowX: 'hidden' }}>
      <svg viewBox="0 0 360 270" width="100%" style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          {FAMILY_TREE.map(f => (
            <filter key={f.key} id={`glow-${f.key}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          ))}
          <style>{`
            @keyframes flowDash {
              from { stroke-dashoffset: 80; }
              to   { stroke-dashoffset: 0; }
            }
            @keyframes pulse {
              0%, 100% { r: 28; opacity: .15; }
              50%       { r: 36; opacity: .30; }
            }
            @keyframes grandkidPop {
              from { r: 0; opacity: 0; }
              to   { r: 5; opacity: 1; }
            }
          `}</style>
        </defs>

        {/* ── connection lines ── */}
        {CHILD_FAMILIES.map((f, i) => {
          const cx = CHILD_X[i]
          const isActive   = f.key === activeKey
          const isRootView = activeKey === 'kikangis'
          const show  = isRootView || isActive
          const d = `M ${ROOT_X},${ROOT_Y + 28} C ${ROOT_X},${(ROOT_Y + CHILD_Y) / 2} ${cx},${(ROOT_Y + CHILD_Y) / 2} ${cx},${CHILD_Y - 20}`

          return (
            <g key={f.key}>
              {/* dim background line */}
              <path d={d} fill="none"
                stroke={f.color} strokeWidth={show ? 2 : 1}
                strokeOpacity={show ? 0.5 : 0.12}
                strokeDasharray="none"
              />
              {/* animated flow line for active */}
              {show && (
                <path d={d} fill="none"
                  stroke={f.color} strokeWidth={isActive ? 3 : 1.5}
                  strokeOpacity={isActive ? 1 : 0.4}
                  strokeDasharray="12 8"
                  style={{ animation: `flowDash ${isActive ? '0.8s' : '1.4s'} linear infinite` }}
                  filter={isActive ? `url(#glow-${f.key})` : undefined}
                />
              )}
            </g>
          )
        })}

        {/* ── grandkid dots — individual family view only ── */}
        {!isRootView && CHILD_FAMILIES.map((f, i) => {
          const cx = CHILD_X[i]
          const isActive = f.key === activeKey
          if (!isActive) return null
          const kids = f.children
          const spread = Math.min(kids.length * 14, 56)
          return kids.map((k, ki) => {
            const kx = cx - spread / 2 + ki * (kids.length > 1 ? spread / (kids.length - 1) : 0)
            return (
              <g key={k.name}>
                <line x1={cx} y1={CHILD_Y + 20} x2={kx} y2={GRANDKID_Y - 6}
                  stroke={f.color} strokeWidth={0.8} strokeOpacity={0.3} />
                <circle cx={kx} cy={GRANDKID_Y} r={5} fill={f.color} fillOpacity={0.7}
                  style={{ animation: `grandkidPop 0.4s ease-out ${ki * 0.05}s both` }} />
                <text x={kx} y={GRANDKID_Y + 14} textAnchor="middle"
                  fontSize={7} fill={f.color} fillOpacity={0.8}>{k.name.split(' ')[0]}</text>
              </g>
            )
          })
        })}

        {/* ── child family nodes ── */}
        {CHILD_FAMILIES.map((f, i) => {
          const cx = CHILD_X[i]
          const isActive = f.key === activeKey
          const r = isActive ? 24 : 20
          const familyName = f.label.replace('The ', '')
          const head = f.members[0]?.name.split(' ')[0] ?? ''
          const spouse = f.members[1]?.name.split(' ')[0] ?? ''
          const coupleLabel = spouse ? `${head} & ${spouse}` : head
          return (
            <g key={f.key}
              style={{ cursor: onNodeClick ? 'pointer' : 'default' }}
              onClick={() => onNodeClick?.(f.key)}>
              {isActive && (
                <circle cx={cx} cy={CHILD_Y} style={{ animation: 'pulse 2s ease-in-out infinite' }}
                  fill={f.color} fillOpacity={0} stroke={f.color} strokeWidth={2} r={30} />
              )}
              <circle cx={cx} cy={CHILD_Y} r={r}
                fill={isActive ? f.color : f.color + '55'}
                stroke={f.color} strokeWidth={2} strokeOpacity={1} fillOpacity={1}
              />
              {/* family name */}
              <text x={cx} y={CHILD_Y - 4} textAnchor="middle"
                fontSize={isActive ? 8 : 7} fill="#fff"
                fillOpacity={isActive ? 1 : 0.9} fontWeight={700}
              >{familyName}</text>
              {/* couple */}
              <text x={cx} y={CHILD_Y + 6} textAnchor="middle"
                fontSize={isActive ? 5.5 : 5} fill="#fff"
                fillOpacity={isActive ? 0.9 : 0.75} fontWeight={400}
              >{coupleLabel}</text>
              {/* count badge — root view only */}
              {isRootView && f.children.length > 0 && (
                <g>
                  <circle cx={cx + r - 2} cy={CHILD_Y - r + 2} r={7}
                    fill="#0d1829" stroke={f.color} strokeWidth={1.2} />
                  <text x={cx + r - 2} y={CHILD_Y - r + 6} textAnchor="middle"
                    fontSize={6} fill={f.color} fontWeight={700}>{f.children.length}</text>
                </g>
              )}
            </g>
          )
        })}

        {/* ── root node (Kikangis / Israel & Merab) ── */}
        {(() => {
          const root = FAMILY_TREE[0]
          const isActive = activeKey === 'kikangis'
          return (
            <g style={{ cursor: onNodeClick ? 'pointer' : 'default' }}
              onClick={() => onNodeClick?.('kikangis')}>
              {isActive && (
                <circle cx={ROOT_X} cy={ROOT_Y} r={42}
                  fill={root.color} fillOpacity={0}
                  stroke={root.color} strokeWidth={2}
                  style={{ animation: 'pulse 2s ease-in-out infinite' }} />
              )}
              <circle cx={ROOT_X} cy={ROOT_Y} r={28}
                fill={isActive ? root.color : root.color + '66'}
                stroke={root.color} strokeWidth={2}
              />
              <text x={ROOT_X} y={ROOT_Y - 6} textAnchor="middle" fontSize={9} fill={isActive ? '#fff' : root.color} fontWeight={700}>Kikangis</text>
              <text x={ROOT_X} y={ROOT_Y + 5} textAnchor="middle" fontSize={7} fill={isActive ? '#ffffffcc' : root.color + 'cc'}>Israel</text>
              <text x={ROOT_X} y={ROOT_Y + 15} textAnchor="middle" fontSize={6.5} fill={isActive ? '#ffffff99' : root.color + '99'}>& Merab</text>
              {/* generation labels — positioned ABOVE each row so circles don't cover them */}
              <text x={8} y={ROOT_Y - 34} fontSize={7} fill="#94a3b8">Gen 1</text>
              <text x={8} y={CHILD_Y - 26} fontSize={7} fill="#94a3b8">Gen 2</text>
              {!isRootView && <text x={8} y={GRANDKID_Y - 10} fontSize={7} fill="#94a3b8">Gen 3</text>}
            </g>
          )
        })()}
      </svg>
    </div>
  )
}

// ── members tab ───────────────────────────────────────────────────────────────

function MembersTab({ node, onMemberClick, onChildClick }: {
  node: FamilyNode
  onMemberClick: (index: number) => void
  onChildClick: (index: number) => void
}) {
  const { t } = useTranslation()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>
        {t('family.members')}
      </div>
      {node.members.map((m, mi) => {
        const age = parseAge(m.birthday)
        const bday = formatBirthday(m.birthday)
        const daysToNext = nextBirthdayDays(m.birthday)
        return (
          <div key={m.name}
            onClick={() => onMemberClick(mi)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: '#1e293b', borderRadius: 12, padding: '10px 12px',
              border: m.isHead ? `1px solid ${node.color}55` : '1px solid #1e293b',
              cursor: 'pointer',
            }}>
            <Avatar name={m.name} avatarKey={m.avatarKey} size={44} color={node.color} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>{m.name}</span>
                {m.isHead && <Star size={10} fill={node.color} color={node.color} />}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>
                {m.profession ?? m.role}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Calendar size={10} color="#475569" />
                <span style={{ fontSize: 10, color: '#475569' }}>{bday}</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <div style={{ textAlign: 'right' }}>
                {age !== null
                  ? <div style={{ fontSize: 20, fontWeight: 800, color: node.color, lineHeight: 1 }}>{age}</div>
                  : <div style={{ fontSize: 11, color: '#334155' }}>{t('family.ageUnknown')}</div>
                }
                {age !== null && <div style={{ fontSize: 9, color: '#475569' }}>{t('family.yrs')}</div>}
                {daysToNext !== null && daysToNext <= 30 && (
                  <div style={{ fontSize: 9, color: '#f59e0b', marginTop: 2 }}>
                    {daysToNext === 0 ? '🎂 Today!' : `🎉 ${daysToNext}d`}
                  </div>
                )}
              </div>
              <ChevronRight size={14} color="#475569" />
            </div>
          </div>
        )
      })}

      {node.children.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginTop: 8, marginBottom: 2 }}>
            {t('family.children', { count: node.children.length })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
            {node.children.map((k, ki) => {
              const age = parseAge(k.birthday)
              const daysToNext = nextBirthdayDays(k.birthday)
              return (
                <div key={k.name}
                  onClick={() => onChildClick(ki)}
                  style={{
                    background: '#0f172a', borderRadius: 10, padding: '8px 10px',
                    border: `1px solid ${node.color}33`, cursor: 'pointer',
                    display: 'flex', flexDirection: 'column',
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: node.color + '22', border: `1.5px solid ${node.color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: node.color }}>{k.name.charAt(0)}</span>
                    </div>
                    <ChevronRight size={12} color="#475569" />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>{k.name}</div>
                  {age !== null
                    ? <div style={{ fontSize: 10, color: '#64748b' }}>{age} {t('family.yearsOld')}</div>
                    : k.birthday
                    ? <div style={{ fontSize: 10, color: '#475569' }}>{k.birthday}</div>
                    : <div style={{ fontSize: 10, color: '#334155' }}>{t('family.birthdayUnknown')}</div>
                  }
                  {daysToNext !== null && daysToNext <= 14 && (
                    <div style={{ fontSize: 9, color: '#f59e0b' }}>🎉 {daysToNext === 0 ? 'Today!' : `${daysToNext}d`}</div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── investments tab ───────────────────────────────────────────────────────────

function InvestmentsTab({ node }: { node: FamilyNode }) {
  const { t } = useTranslation()
  const { data: interests = [], isLoading } = useQuery<any[]>({
    queryKey: ['interests-all'],
    queryFn: () => fetch('/api/projects/interests', { credentials: 'include' })
      .then(r => r.json())
      .then(d => Array.isArray(d) ? d : (d?.interests ?? d?.data ?? [])),
    staleTime: 60_000,
  })
  const { data: projects = [] } = useQuery<any[]>({
    queryKey: ['projects'],
    queryFn: () => fetch('/api/projects', { credentials: 'include' })
      .then(r => r.json())
      .then(d => Array.isArray(d) ? d : (d?.projects ?? d?.data ?? [])),
    staleTime: 60_000,
  })

  const familyInterests = useMemo(() => {
    const label = node.label.toUpperCase()
    return interests.filter((i: any) =>
      (i.family_name || '').toUpperCase() === label ||
      node.members.some(m => (i.member_name || '').toLowerCase().includes(m.name.split(' ')[0].toLowerCase()))
    )
  }, [interests, node])

  const projectMap = useMemo(() => {
    const m: Record<string, any> = {}
    projects.forEach((p: any) => { m[p.id] = p })
    return m
  }, [projects])

  if (isLoading) return <div style={{ color: '#64748b', fontSize: 13, textAlign: 'center', padding: 24 }}>{t('common.loading')}</div>
  if (familyInterests.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 32 }}>
        <Briefcase size={32} color="#334155" style={{ margin: '0 auto 8px' }} />
        <div style={{ color: '#64748b', fontSize: 13 }}>{t('family.noProjectInterests')}</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>
        {familyInterests.length} project interest{familyInterests.length > 1 ? 's' : ''}
      </div>
      {familyInterests.map((interest: any) => {
        const proj = projectMap[interest.project_id]
        return (
          <div key={interest.id} style={{
            background: '#1e293b', borderRadius: 12, padding: '10px 12px',
            border: `1px solid ${node.color}33`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9', marginBottom: 2 }}>
                  {proj?.name || interest.project_id}
                </div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{interest.member_name}</div>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                background: interest.status === 'confirmed' ? '#14532d33' : '#1e3a5f33',
                color: interest.status === 'confirmed' ? '#4ade80' : '#60a5fa',
                flexShrink: 0,
              }}>{interest.status}</span>
            </div>
            {interest.preferred_role && (
              <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>{t('family.role')} {interest.preferred_role}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── member profile view ───────────────────────────────────────────────────────

function MemberView({ member, family }: { member: FamilyMember; family: FamilyNode }) {
  const { t } = useTranslation()
  const age = parseAge(member.birthday)
  const bday = formatBirthday(member.birthday)
  const daysToNext = nextBirthdayDays(member.birthday)
  const col = family.color

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* hero */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Avatar name={member.name} avatarKey={member.avatarKey} size={64} color={col} />
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#f8fafc' }}>{member.name}</div>
          <div style={{ fontSize: 12, color: col, fontWeight: 600, marginTop: 2 }}>{member.profession ?? member.role}</div>
          {member.location && (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>📍 {member.location}</div>
          )}
        </div>
      </div>

      {/* quick stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {age !== null && (
          <div style={{ background: col + '14', border: `1px solid ${col}33`, borderRadius: 10, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>{t('family.age')}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: col }}>{age}</div>
            <div style={{ fontSize: 9, color: '#64748b' }}>{bday}</div>
            {daysToNext !== null && daysToNext <= 30 && (
              <div style={{ fontSize: 9, color: '#f59e0b', marginTop: 2 }}>🎉 {daysToNext === 0 ? t('family.today') : t('family.inDays', { days: daysToNext })}</div>
            )}
          </div>
        )}
        {member.workplace && (
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>{t('family.worksAt')}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#f1f5f9' }}>{member.workplace}</div>
          </div>
        )}
        {member.study && (
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>{t('family.studiesAt')}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#f1f5f9' }}>{member.study}</div>
          </div>
        )}
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: '8px 12px' }}>
          <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>{t('family.familyLabel')}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: col }}>{family.label}</div>
          <div style={{ fontSize: 9, color: '#64748b' }}>{member.isHead ? t('family.familyHead') : t('family.member')}</div>
        </div>
      </div>

      {/* bio */}
      {member.bio && (
        <div style={{ background: '#1e293b', borderRadius: 12, padding: '10px 14px', border: '1px solid #334155' }}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{t('family.about')}</div>
          <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>{member.bio}</div>
        </div>
      )}

      {/* interests */}
      {member.interests && member.interests.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>{t('family.interests')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {member.interests.map((i: string) => (
              <span key={i} style={{
                background: col + '1a', color: col, border: `1px solid ${col}44`,
                borderRadius: 20, padding: '4px 10px', fontSize: 11, fontWeight: 500,
              }}>{i}</span>
            ))}
          </div>
        </div>
      )}

      {/* milestones */}
      {member.milestones && member.milestones.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>{t('family.keyMilestones')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {member.milestones.map((ms: Milestone, i: number) => (
              <div key={i} style={{ display: 'flex', gap: 12, paddingBottom: 12, position: 'relative' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: col, marginTop: 3 }} />
                  {i < (member.milestones?.length ?? 0) - 1 && (
                    <div style={{ width: 1, flex: 1, background: col + '33', marginTop: 4 }} />
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 10, color: col, fontWeight: 700 }}>{ms.year}</div>
                  <div style={{ fontSize: 12, color: '#cbd5e1' }}>{ms.event}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* empty state for unfilled profiles */}
      {!member.bio && !member.interests?.length && !member.milestones?.length && !member.workplace && (
        <div style={{ textAlign: 'center', padding: '24px 16px', background: '#1e293b', borderRadius: 12, border: '1px dashed #334155' }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>✏️</div>
          <div style={{ fontSize: 13, color: '#64748b' }}>{t('family.profileComingSoon')}</div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>{t('family.profileComingSoonSub')}</div>
        </div>
      )}
    </div>
  )
}

// ── child profile view ────────────────────────────────────────────────────────

function ChildView({ child, family }: { child: { name: string; birthday: string | null; avatarKey?: string; bio?: string }; family: FamilyNode }) {
  const { t } = useTranslation()
  const age = parseAge(child.birthday)
  const bday = formatBirthday(child.birthday)
  const daysToNext = nextBirthdayDays(child.birthday)
  const col = family.color
  const initial = child.name.charAt(0).toUpperCase()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* hero */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {child.avatarKey
          ? <Avatar name={child.name} avatarKey={child.avatarKey} size={64} color={col} />
          : (
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: col + '22', border: `2px solid ${col}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 800, color: col, flexShrink: 0 }}>
              {initial}
            </div>
          )
        }
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#f8fafc' }}>{child.name}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{t('family.childOf')} {family.label}</div>
          {age !== null && <div style={{ fontSize: 12, color: col, fontWeight: 600, marginTop: 2 }}>{age} years old</div>}
        </div>
      </div>

      {/* birthday card */}
      <div style={{ background: col + '14', border: `1px solid ${col}33`, borderRadius: 12, padding: '12px 14px' }}>
        <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4 }}>🎂 {t('family.birthday')}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>{bday}</div>
        {daysToNext !== null && (
          <div style={{ fontSize: 11, color: daysToNext <= 7 ? '#f59e0b' : '#64748b', marginTop: 4 }}>
            {daysToNext === 0 ? `🎉 ${t('family.today')}` : daysToNext === 1 ? t('family.tomorrow') : t('family.inDays', { days: daysToNext })}
          </div>
        )}
      </div>

      {/* family context */}
      <div style={{ background: '#1e293b', borderRadius: 12, padding: '10px 14px', border: `1px solid ${col}22` }}>
        <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6 }}>{t('family.partOf')}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: col }}>{family.label}</div>
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
          {family.members.map(m => m.name.split(' ')[0]).join(' & ')}'s family
        </div>
      </div>

      {/* bio or coming soon */}
      {child.bio
        ? <div style={{ background: '#1e293b', borderRadius: 12, padding: '10px 14px', border: '1px solid #334155' }}>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{t('family.about')}</div>
            <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>{child.bio}</div>
          </div>
        : <div style={{ textAlign: 'center', padding: '20px', background: '#1e293b', borderRadius: 12, border: '1px dashed #334155' }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>🌱</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{t('family.growingUp')}</div>
          </div>
      }
    </div>
  )
}

// ── main modal ────────────────────────────────────────────────────────────────

type NavEntry =
  | { type: 'family'; key: string }
  | { type: 'member'; familyKey: string; memberIndex: number }
  | { type: 'child';  familyKey: string; childIndex: number }

type Tab = 'lineage' | 'members' | 'investments'

export function FamilyProfileModal({ familyLabel, onClose }: { familyLabel: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('lineage')
  const initialKey = LABEL_TO_KEY[familyLabel]
  const [navStack, setNavStack] = useState<NavEntry[]>([{ type: 'family', key: initialKey }])

  const current = navStack[navStack.length - 1]
  const canGoBack = navStack.length > 1

  const navigateTo = (entry: NavEntry) => {
    setNavStack(s => [...s, entry])
    setTab('lineage')
  }
  const goBack = () => setNavStack(s => s.slice(0, -1))

  // Resolve the node / member / child for the current view
  const familyKey = current.type === 'family' ? current.key
    : (current as { familyKey: string }).familyKey
  const node = FAMILY_TREE.find(f => f.key === familyKey)
  if (!node) return null

  // Resolve what to display based on nav stack top
  const member = current.type === 'member' ? node.members[current.memberIndex] : undefined
  const child  = current.type === 'child'  ? node.children[current.childIndex]  : undefined

  const { t } = useTranslation()
  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'lineage',     label: t('family.lineage'),  icon: <TreePine size={13} /> },
    { key: 'members',     label: t('family.members'),  icon: <Users size={13} /> },
    { key: 'investments', label: t('family.projects'), icon: <Briefcase size={13} /> },
  ]

  // Header content depends on view type
  const headerName = member ? member.name : child ? child.name : node.label
  const headerSub  = member
    ? (member.profession ?? member.role)
    : child
    ? `${t('family.childOf')} ${node.label}`
    : node.birthOrder === 0 ? t('family.foundingFamily') : `${node.members.length} ${t('family.members', { count: node.members.length }).toLowerCase()} · ${node.children.length} ${t('family.children', { count: node.children.length }).toLowerCase()}`
  const headerAvatar = member
    ? <Avatar name={member.name} avatarKey={member.avatarKey} size={52} color={node.color} />
    : child
    ? <div style={{ width: 52, height: 52, borderRadius: '50%', background: node.color + '22', border: `2px solid ${node.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800, color: node.color }}>{child.name.charAt(0)}</div>
    : <Avatar name={node.members[0]?.name || node.label} avatarKey={node.members[0]?.avatarKey || node.key} size={52} color={node.color} />

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: '#0d1829',
        borderRadius: '20px 20px 0 0',
        maxHeight: '90dvh', overflowY: 'auto',
        paddingBottom: 'env(safe-area-inset-bottom, 16px)',
        border: `1px solid ${node.color}33`,
        boxShadow: `0 -8px 40px ${node.color}22`,
      }}>
        {/* handle */}
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, paddingBottom: 4 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: '#334155' }} />
        </div>

        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px 12px' }}>
          {canGoBack
            ? <button onClick={goBack} style={{ background: '#1e293b', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', color: node.color, flexShrink: 0 }}>
                <ChevronRight size={18} style={{ transform: 'rotate(180deg)' }} />
              </button>
            : headerAvatar
          }
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{headerName}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>{headerSub}</div>
          </div>
          <button onClick={onClose} style={{ background: '#1e293b', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', color: '#64748b' }}>
            <X size={18} />
          </button>
        </div>

        {/* body */}
        <div style={{ padding: '0 16px 32px' }}>
          {current.type === 'member' && member && (
            <MemberView member={member} family={node} />
          )}
          {current.type === 'child' && child && (
            <ChildView child={child} family={node} />
          )}
          {current.type === 'family' && (
            <>
              <div style={{ padding: '0 0 12px' }}>
                <FamilyStats node={node} />
              </div>

              {/* tabs */}
              <div style={{ display: 'flex', gap: 1, marginBottom: 12 }}>
                {tabs.map(t => (
                  <button key={t.key} onClick={() => setTab(t.key)} style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                    padding: '7px 4px', borderRadius: 10, border: 'none', cursor: 'pointer',
                    fontSize: 11, fontWeight: tab === t.key ? 700 : 500,
                    background: tab === t.key ? node.color + '22' : '#1e293b',
                    color: tab === t.key ? node.color : '#475569',
                    outline: tab === t.key ? `1px solid ${node.color}44` : 'none',
                  }}>
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>

              {tab === 'lineage' && (
                <div>
                  <LineageTree activeKey={node.key} onNodeClick={key => navigateTo({ type: 'family', key })} />
                  {node.birthOrder > 0 && (
                    <div style={{
                      background: '#1e293b', borderRadius: 12, padding: '10px 14px', marginTop: 8,
                      border: `1px solid ${node.color}33`,
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>{t('family.bornFrom')}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>Israel & Merab Kikangi</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>
                          {node.members.find(m => m.isHead)?.name} {t('family.childNumber', { n: node.birthOrder })}
                        </div>
                      </div>
                      <ChevronRight size={16} color={node.color} />
                    </div>
                  )}
                </div>
              )}
              {tab === 'members' && (
                <MembersTab
                  node={node}
                  onMemberClick={i => navigateTo({ type: 'member', familyKey: node.key, memberIndex: i })}
                  onChildClick={i => navigateTo({ type: 'child', familyKey: node.key, childIndex: i })}
                />
              )}
              {tab === 'investments' && <InvestmentsTab node={node} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
