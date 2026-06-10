import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Users, Briefcase, TreePine, Calendar, ChevronRight, Star } from 'lucide-react'
import { FAMILY_TREE, LABEL_TO_KEY, parseAge, formatBirthday, type FamilyNode } from '../data/familyTree'

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
      <StatChip icon="👥" label={isNodeRoot ? 'Core members' : 'Members'} value={String(totalMembers)} color={node.color} />
      {/* Children / grandkids */}
      <StatChip icon="👶" label={isNodeRoot ? 'Grandchildren' : 'Children'} value={String(totalGrandkids)} color={node.color} />
      {/* Age range */}
      {oldest !== null && youngest !== null && oldest !== youngest && (
        <StatChip icon="🎂" label="Age range" value={`${youngest}–${oldest} yrs`} color={node.color} />
      )}
      {/* Next birthday */}
      {next && (
        <StatChip
          icon="🎉"
          label={`${next.name.split(' ')[0]}'s birthday`}
          value={next.days === 0 ? 'Today! 🎊' : next.days === 1 ? 'Tomorrow!' : `In ${next.days}d`}
          color={next.days! <= 7 ? '#f59e0b' : node.color}
        />
      )}
      {/* Recent additions */}
      {recentBirths.length > 0 && (
        <StatChip icon="✨" label="Born 2022+" value={`${recentBirths.length} addition${recentBirths.length > 1 ? 's' : ''}`} color={node.color} />
      )}
      {/* Family branches (root view only) */}
      {familyCount !== null && (
        <StatChip icon="🌳" label="Family branches" value={String(familyCount)} color={node.color} />
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

function LineageTree({ activeKey }: { activeKey: string }) {
  return (
    <div style={{ overflowX: 'hidden' }}>
      <svg viewBox="0 0 360 260" width="100%" style={{ display: 'block', overflow: 'visible' }}>
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

        {/* ── grandkid dots ── */}
        {CHILD_FAMILIES.map((f, i) => {
          const cx = CHILD_X[i]
          const isActive   = f.key === activeKey
          const isRootView = activeKey === 'kikangis'
          if (!isActive && !isRootView) return null
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
                {(isActive || kids.length <= 3) && (
                  <text x={kx} y={GRANDKID_Y + 14} textAnchor="middle"
                    fontSize={7} fill={f.color} fillOpacity={0.8}>{k.name.split(' ')[0]}</text>
                )}
              </g>
            )
          })
        })}

        {/* ── child family nodes ── */}
        {CHILD_FAMILIES.map((f, i) => {
          const cx = CHILD_X[i]
          const isActive   = f.key === activeKey
          const isRootView = activeKey === 'kikangis'
          const r = isActive ? 22 : 18
          const label = f.label.replace('The ', '')
          return (
            <g key={f.key}>
              {isActive && (
                <circle cx={cx} cy={CHILD_Y} style={{ animation: 'pulse 2s ease-in-out infinite' }}
                  fill={f.color} fillOpacity={0} stroke={f.color} strokeWidth={2} r={28} />
              )}
              <circle cx={cx} cy={CHILD_Y} r={r}
                fill={isActive ? f.color : f.color + '22'}
                stroke={f.color}
                strokeWidth={isActive ? 2 : 1}
                strokeOpacity={isRootView || isActive ? 1 : 0.3}
                fillOpacity={isRootView || isActive ? 1 : 0.15}
              />
              <text x={cx} y={CHILD_Y + 4} textAnchor="middle" fontSize={isActive ? 9 : 8}
                fill={isActive ? '#fff' : f.color}
                fillOpacity={isRootView || isActive ? 1 : 0.3}
                fontWeight={isActive ? 700 : 500}
              >{label.slice(0, 6)}</text>
            </g>
          )
        })}

        {/* ── root node (Kikangis / Israel & Merab) ── */}
        {(() => {
          const root = FAMILY_TREE[0]
          const isActive = activeKey === 'kikangis'
          return (
            <g>
              {isActive && (
                <circle cx={ROOT_X} cy={ROOT_Y} r={42}
                  fill={root.color} fillOpacity={0}
                  stroke={root.color} strokeWidth={2}
                  style={{ animation: 'pulse 2s ease-in-out infinite' }} />
              )}
              <circle cx={ROOT_X} cy={ROOT_Y} r={28}
                fill={isActive ? root.color : root.color + '33'}
                stroke={root.color} strokeWidth={2}
              />
              <text x={ROOT_X} y={ROOT_Y - 5} textAnchor="middle" fontSize={8} fill={isActive ? '#fff' : root.color} fontWeight={700}>Israel</text>
              <text x={ROOT_X} y={ROOT_Y + 6} textAnchor="middle" fontSize={7} fill={isActive ? '#ffffffbb' : root.color + 'bb'}>& Merab</text>
              <text x={ROOT_X} y={ROOT_Y + 16} textAnchor="middle" fontSize={6.5} fill={isActive ? '#ffffff88' : root.color + '88'}>Kikangis</text>
              {/* generation labels */}
              <text x={8} y={ROOT_Y + 4} fontSize={7} fill="#475569">Gen 1</text>
              <text x={8} y={CHILD_Y + 4} fontSize={7} fill="#475569">Gen 2</text>
              <text x={8} y={GRANDKID_Y + 4} fontSize={7} fill="#475569">Gen 3</text>
            </g>
          )
        })()}
      </svg>
    </div>
  )
}

// ── members tab ───────────────────────────────────────────────────────────────

function MembersTab({ node }: { node: FamilyNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>
        Family Members
      </div>
      {node.members.map(m => {
        const age = parseAge(m.birthday)
        const bday = formatBirthday(m.birthday)
        const daysToNext = nextBirthdayDays(m.birthday)
        return (
          <div key={m.name} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: '#1e293b', borderRadius: 12, padding: '10px 12px',
            border: m.isHead ? `1px solid ${node.color}55` : '1px solid #1e293b',
          }}>
            <Avatar name={m.name} avatarKey={m.avatarKey} size={44} color={node.color} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>{m.name}</span>
                {m.isHead && <Star size={10} fill={node.color} color={node.color} />}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>{m.role}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Calendar size={10} color="#475569" />
                <span style={{ fontSize: 10, color: '#475569' }}>{bday}</span>
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              {age !== null
                ? <div style={{ fontSize: 20, fontWeight: 800, color: node.color, lineHeight: 1 }}>{age}</div>
                : <div style={{ fontSize: 11, color: '#334155' }}>Age?</div>
              }
              {age !== null && <div style={{ fontSize: 9, color: '#475569' }}>yrs</div>}
              {daysToNext !== null && daysToNext <= 30 && (
                <div style={{ fontSize: 9, color: '#f59e0b', marginTop: 2 }}>
                  {daysToNext === 0 ? '🎂 Today!' : `🎉 ${daysToNext}d`}
                </div>
              )}
            </div>
          </div>
        )
      })}

      {node.children.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginTop: 8, marginBottom: 2 }}>
            Children
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
            {node.children.map(k => {
              const age = parseAge(k.birthday)
              const daysToNext = nextBirthdayDays(k.birthday)
              return (
                <div key={k.name} style={{
                  background: '#0f172a', borderRadius: 10, padding: '8px 10px',
                  border: `1px solid ${node.color}22`,
                }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: node.color + '22', border: `1.5px solid ${node.color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: node.color }}>{k.name.charAt(0)}</span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>{k.name}</div>
                  {age !== null
                    ? <div style={{ fontSize: 10, color: '#64748b' }}>{age} yrs old</div>
                    : k.birthday
                    ? <div style={{ fontSize: 10, color: '#334155' }}>{k.birthday}</div>
                    : <div style={{ fontSize: 10, color: '#334155' }}>Birthday unknown</div>
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
  const { data: interests = [], isLoading } = useQuery<any[]>({
    queryKey: ['interests-all'],
    queryFn: () => fetch('/api/projects/interests', { credentials: 'include' }).then(r => r.json()),
    staleTime: 60_000,
  })
  const { data: projects = [] } = useQuery<any[]>({
    queryKey: ['projects'],
    queryFn: () => fetch('/api/projects', { credentials: 'include' }).then(r => r.json()),
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

  if (isLoading) return <div style={{ color: '#64748b', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading...</div>
  if (familyInterests.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 32 }}>
        <Briefcase size={32} color="#334155" style={{ margin: '0 auto 8px' }} />
        <div style={{ color: '#64748b', fontSize: 13 }}>No project interests recorded yet.</div>
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
              <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>Role: {interest.preferred_role}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── main modal ────────────────────────────────────────────────────────────────

type Tab = 'lineage' | 'members' | 'investments'

export function FamilyProfileModal({ familyLabel, onClose }: { familyLabel: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('lineage')
  const key = LABEL_TO_KEY[familyLabel]
  const node = FAMILY_TREE.find(f => f.key === key)
  if (!node) return null

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'lineage',     label: 'Lineage',    icon: <TreePine size={13} /> },
    { key: 'members',     label: 'Members',    icon: <Users size={13} /> },
    { key: 'investments', label: 'Projects',   icon: <Briefcase size={13} /> },
  ]

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
        maxHeight: '92vh', overflowY: 'auto',
        border: `1px solid ${node.color}33`,
        boxShadow: `0 -8px 40px ${node.color}22`,
      }}>
        {/* handle */}
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, paddingBottom: 4 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: '#334155' }} />
        </div>

        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px 12px' }}>
          <Avatar
            name={node.members[0]?.name || node.label}
            avatarKey={node.members[0]?.avatarKey || node.key}
            size={52}
            color={node.color}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#f8fafc' }}>{node.label}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>
              {node.birthOrder === 0 ? 'Founding Family' : `${node.members.length} members · ${node.children.length} children`}
            </div>
          </div>
          <button onClick={onClose} style={{ background: '#1e293b', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', color: '#64748b' }}>
            <X size={18} />
          </button>
        </div>

        {/* stats strip */}
        <div style={{ padding: '0 16px 12px' }}>
          <FamilyStats node={node} />
        </div>

        {/* tabs */}
        <div style={{ display: 'flex', gap: 1, padding: '0 16px 12px' }}>
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

        {/* tab content */}
        <div style={{ padding: '0 16px 32px' }}>
          {tab === 'lineage' && (
            <div>
              <LineageTree activeKey={node.key} />
              {node.birthOrder > 0 && (
                <div style={{
                  background: '#1e293b', borderRadius: 12, padding: '10px 14px', marginTop: 8,
                  border: `1px solid ${node.color}33`,
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>Born from</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>Israel & Merab Kikangi</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>
                      {node.members.find(m => m.isHead)?.name} is child #{node.birthOrder} of 6
                    </div>
                  </div>
                  <ChevronRight size={16} color={node.color} />
                </div>
              )}
            </div>
          )}
          {tab === 'members' && <MembersTab node={node} />}
          {tab === 'investments' && <InvestmentsTab node={node} />}
        </div>
      </div>
    </div>
  )
}
