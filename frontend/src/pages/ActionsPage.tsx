import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'

const ADMIN_USERS = ['Hillary', 'Hellen']

type DbStatus  = 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled' | 'carried_over'
type Health    = 'overdue' | 'at_risk' | 'on_track' | null
type Priority  = 'high' | 'medium' | 'low' | null
type FilterTab = 'active' | 'overdue' | 'done' | 'all'

interface ActionItem {
  id: string            // action ref e.g. "KIM/08/26-1"
  description: string
  responsible: string
  deadline: string | null
  status: DbStatus
  health: Health
  priority: Priority
  effort_hours: number | null
  project_id: string | null
  parent_ref: string | null
  meeting_number: string | null
  updated_at: string | null
}

const STATUS_STYLE: Record<DbStatus, { label: string; color: string; bg: string }> = {
  open:         { label: 'Open',         color: '#fbbf24', bg: '#78350f33' },
  in_progress:  { label: 'In Progress',  color: '#60a5fa', bg: '#1e3a5f55' },
  blocked:      { label: 'Blocked',      color: '#f97316', bg: '#7c2d1233' },
  done:         { label: 'Done',         color: '#4ade80', bg: '#14532d33' },
  cancelled:    { label: 'Cancelled',    color: '#64748b', bg: '#1e293b55' },
  carried_over: { label: 'Carried Over', color: '#a78bfa', bg: '#4c1d9533' },
}

const HEALTH_STYLE: Record<NonNullable<Health>, { label: string; color: string }> = {
  overdue:  { label: 'Overdue',  color: '#f87171' },
  at_risk:  { label: 'At Risk',  color: '#fbbf24' },
  on_track: { label: 'On Track', color: '#4ade80' },
}

const PRIORITY_STYLE: Record<NonNullable<Priority>, { label: string; color: string }> = {
  high:   { label: 'H', color: '#f87171' },
  medium: { label: 'M', color: '#fbbf24' },
  low:    { label: 'L', color: '#64748b' },
}

function HealthBadge({ health, status }: { health: Health; status: DbStatus }) {
  if (!health || status === 'done' || status === 'cancelled' || status === 'carried_over') return null
  const h = HEALTH_STYLE[health]
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full"
      style={{ color: h.color, background: h.color + '22' }}>
      {h.label}
    </span>
  )
}

function effortLabel(hours: number | null): string | null {
  if (!hours) return null
  if (hours < 8) return `${hours}h`
  return `${Math.round(hours / 8)}d`
}

function ActionCard({ item, isAdmin, userName, onMarkDone, onAddUpdate, onJumpTo }: {
  item: ActionItem
  isAdmin: boolean
  userName: string
  onMarkDone: (id: string, comment: string) => Promise<void>
  onAddUpdate: (id: string, text: string) => Promise<void>
  onJumpTo: (ref: string) => void
}) {
  const s = STATUS_STYLE[item.status] ?? STATUS_STYLE.open
  const [mode, setMode] = useState<null | 'update' | 'done'>(null)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  const isTerminal = item.status === 'done' || item.status === 'cancelled'

  const isResponsible =
    isAdmin ||
    item.responsible === 'All Members' ||
    item.responsible.toLowerCase() === userName.toLowerCase()

  const submit = async () => {
    const val = text.trim()
    setSaving(true)
    try {
      if (mode === 'done') await onMarkDone(item.id, val)
      else if (mode === 'update' && val) await onAddUpdate(item.id, val)
    } finally {
      setSaving(false)
      setText('')
      setMode(null)
    }
  }

  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--bg-card)', border: `1px solid ${s.color}33` }}>

      {/* Row 1: description + status pill */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-sm leading-snug flex-1" style={{ color: '#e2e8f0' }}>{item.description}</p>
        <span className="text-[10px] shrink-0 px-1.5 py-0.5 rounded-full font-semibold"
          style={{ color: s.color, background: s.bg }}>
          {s.label}
        </span>
      </div>

      {/* Row 2: person, meeting, deadline, effort, health, priority */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[11px]" style={{ color: '#64748b' }}>{item.responsible}</span>
        {item.meeting_number && (
          <span className="text-[10px]" style={{ color: '#94a3b8' }}>KIM {item.meeting_number}</span>
        )}
        {item.deadline && (
          <span className="text-[10px]" style={{ color: '#94a3b8' }}>{item.deadline}</span>
        )}
        {effortLabel(item.effort_hours) && (
          <span className="text-[10px]" style={{ color: '#475569' }}>{effortLabel(item.effort_hours)}</span>
        )}
        <HealthBadge health={item.health} status={item.status} />
        {item.priority && PRIORITY_STYLE[item.priority] && (
          <span className="text-[10px] font-bold w-4 h-4 flex items-center justify-center rounded"
            title={`Priority: ${item.priority}`}
            style={{ color: PRIORITY_STYLE[item.priority].color, background: PRIORITY_STYLE[item.priority].color + '22' }}>
            {PRIORITY_STYLE[item.priority].label}
          </span>
        )}
      </div>

      {/* Row 3: ref chip + parent chain + project tag */}
      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
          style={{ color: '#475569', background: '#0f172a' }}>
          {item.id}
        </span>
        {item.parent_ref && (
          <button
            onClick={() => onJumpTo(item.parent_ref!)}
            className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80 transition-opacity"
            style={{ color: '#a78bfa', background: '#4c1d9522', border: '1px solid #4c1d9544' }}>
            ↑ {item.parent_ref}
          </button>
        )}
        {item.project_id && (
          <span className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ color: '#38bdf8', background: '#0c4a6e33', border: '1px solid #0369a144' }}>
            {item.project_id}
          </span>
        )}
      </div>

      {/* Latest update */}
      {item.updated_at && (
        <div className="mt-2 flex items-start gap-1.5">
          <span style={{ fontSize: 10, color: '#475569', flexShrink: 0, paddingTop: 1 }}>Update:</span>
          <span style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>{item.updated_at}</span>
        </div>
      )}

      {/* Inline form */}
      {mode && (
        <div className="mt-2">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={mode === 'done' ? 'Optional closing comment…' : 'What progress have you made?'}
            rows={2}
            autoFocus
            className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
            style={{ background: '#0d1829', color: '#e2e8f0', border: '1px solid #334155' }}
          />
          <div className="flex gap-2 mt-1.5">
            <button onClick={submit} disabled={saving || (mode === 'update' && !text.trim())}
              className="text-[11px] px-3 py-1 rounded-lg font-semibold disabled:opacity-40"
              style={{ background: mode === 'done' ? '#14532d' : '#1e3a5f', color: mode === 'done' ? '#4ade80' : '#93c5fd' }}>
              {saving ? 'Saving…' : mode === 'done' ? 'Confirm done' : 'Save update'}
            </button>
            <button onClick={() => { setMode(null); setText('') }}
              className="text-[11px] px-3 py-1 rounded-lg"
              style={{ background: '#1e293b', color: '#64748b', border: '1px solid #334155' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!isTerminal && !mode && (
        <div className="flex gap-2 mt-2 flex-wrap">
          {isResponsible && (
            <button onClick={() => setMode('update')}
              className="text-[11px] px-2.5 py-1 rounded-lg"
              style={{ background: '#1e293b', color: '#93c5fd', border: '1px solid #1e3a5f' }}>
              Add update
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setMode('done')}
              className="text-[11px] px-2.5 py-1 rounded-lg"
              style={{ background: '#14532d', color: '#4ade80', border: '1px solid #166834' }}>
              Mark done
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function ActionsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const qc = useQueryClient()
  const isAdmin = ADMIN_USERS.includes(user?.name || '')
  const [filter, setFilter] = useState<FilterTab>('active')
  const [search, setSearch] = useState('')

  const { data: items = [], isLoading } = useQuery<ActionItem[]>({
    queryKey: ['actions'],
    queryFn: async () => {
      const raw = await fetch('/api/actions?status=all', { credentials: 'include' }).then(r => r.json())
      if (!raw || typeof raw !== 'object') return []
      const flat: ActionItem[] = []
      const src = Array.isArray(raw) ? { Unknown: raw } : raw as Record<string, any[]>
      for (const [person, list] of Object.entries(src)) {
        for (const a of (list as any[])) {
          flat.push({
            id: String(a.id || ''),
            description: a.action || a.description || '',
            responsible: person,
            deadline: a.deadline || null,
            status: ((a.status || 'open').toLowerCase()) as DbStatus,
            health: (a.health || null) as Health,
            priority: (a.priority || null) as Priority,
            effort_hours: a.effort_hours ?? null,
            project_id: a.project_id || null,
            parent_ref: a.parent_ref || null,
            meeting_number: a.meeting ? String(a.meeting).replace(/^KIM\s*/i, '') || null : null,
            updated_at: a.note || null,
          })
        }
      }
      return flat
    },
  })

  const markDone = async (id: string, comment: string) => {
    await fetch('/api/actions/done', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action_id: id, comment }),
    })
    qc.invalidateQueries({ queryKey: ['actions'] })
  }

  const addUpdate = async (id: string, updateText: string) => {
    await fetch('/api/actions/update', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action_id: id, update_text: updateText }),
    })
    qc.invalidateQueries({ queryKey: ['actions'] })
  }

  const jumpTo = (ref: string) => {
    setSearch(ref)
    setFilter('all')
  }

  const isActive = (a: ActionItem) =>
    a.status === 'open' || a.status === 'in_progress' || a.status === 'blocked'

  const visible = items.filter(a => {
    const matchFilter =
      filter === 'all'     ? true :
      filter === 'active'  ? isActive(a) :
      filter === 'overdue' ? a.health === 'overdue' :
      filter === 'done'    ? (a.status === 'done' || a.status === 'cancelled' || a.status === 'carried_over') :
      true
    if (!matchFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        a.description.toLowerCase().includes(q) ||
        a.responsible.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        (a.parent_ref || '').toLowerCase().includes(q)
      )
    }
    return true
  })

  const counts = {
    active:  items.filter(isActive).length,
    overdue: items.filter(a => a.health === 'overdue').length,
    done:    items.filter(a => a.status === 'done' || a.status === 'cancelled' || a.status === 'carried_over').length,
    all:     items.length,
  }

  const FILTERS: { key: FilterTab; label: string; color: string }[] = [
    { key: 'active',  label: `Active (${counts.active})`,   color: '#60a5fa' },
    { key: 'overdue', label: `Overdue (${counts.overdue})`, color: '#f87171' },
    { key: 'done',    label: `Done (${counts.done})`,       color: '#4ade80' },
    { key: 'all',     label: `All (${counts.all})`,         color: '#94a3b8' },
  ]

  const byPerson: Record<string, ActionItem[]> = {}
  for (const a of visible) {
    if (!byPerson[a.responsible]) byPerson[a.responsible] = []
    byPerson[a.responsible].push(a)
  }

  return (
    <div className="max-w-2xl md:max-w-5xl mx-auto space-y-4">

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
            style={{
              background: filter === f.key ? f.color + '22' : '#1e293b',
              color: filter === f.key ? f.color : '#475569',
              border: filter === f.key ? `1px solid ${f.color}55` : '1px solid #334155',
            }}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        type="text" placeholder={t('common.search') + '… (name, ref, description)'}
        value={search} onChange={e => setSearch(e.target.value)}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none"
        style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
      />

      {isLoading && (
        <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</p>
      )}

      {!isLoading && visible.length === 0 && (
        <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>
          {filter === 'done' ? 'No completed actions yet.' : 'No action items match this filter.'}
        </p>
      )}

      {Object.entries(byPerson).map(([person, personItems]) => (
        <div key={person}>
          <h3 className="text-[11px] font-semibold mb-2 uppercase tracking-wider"
            style={{ color: '#475569' }}>
            {person} ({personItems.length})
          </h3>
          <div className="space-y-2">
            {personItems.map(a => (
              <ActionCard
                key={a.id}
                item={a}
                isAdmin={isAdmin}
                userName={user?.name || ''}
                onMarkDone={markDone}
                onAddUpdate={addUpdate}
                onJumpTo={jumpTo}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
