import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/Toast'

const ADMIN_USERS = ['Hillary', 'Hellen']

type DbStatus  = 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled' | 'carried_over'
type Health    = 'overdue' | 'at_risk' | 'on_track' | null
type Priority  = 'high' | 'medium' | 'low' | null
type FilterTab = 'active' | 'this_meeting' | 'overdue' | 'due_soon' | 'done' | 'all'
type GroupBy   = 'assignee' | 'project' | 'meeting'
type ItemType  = 'epic' | 'feature' | 'task' | 'bug'

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
  project_name: string | null
  item_type: ItemType
  parent_ref: string | null
  meeting_number: string | null
  meeting_ref: string | null
  updated_at: string | null
}

const TYPE_STYLE: Record<ItemType, { label: string; color: string; bg: string }> = {
  epic:    { label: 'Epic',    color: '#c084fc', bg: '#4c1d9533' },
  feature: { label: 'Feature', color: '#38bdf8', bg: '#0c4a6e44' },
  task:    { label: 'Task',    color: '#94a3b8', bg: '#1e293b66' },
  bug:     { label: 'Bug',     color: '#f87171', bg: '#7f1d1d33' },
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

function ActionCard({ item, carriedIntoRef, isAdmin, userName, onMarkDone, onAddUpdate, onSetStatus, onJumpTo, projects, meetings, onSetMeta }: {
  item: ActionItem
  carriedIntoRef: string | null
  isAdmin: boolean
  userName: string
  onMarkDone: (id: string, comment: string) => Promise<void>
  onAddUpdate: (id: string, text: string) => Promise<void>
  onSetStatus: (id: string, status: DbStatus) => Promise<void>
  onJumpTo: (ref: string) => void
  projects: { id: string; name: string }[]
  meetings: { ref: string; number: string }[]
  onSetMeta: (id: string, patch: { item_type?: ItemType; project_id?: string | null; meeting_ref?: string }) => Promise<void>
}) {
  const s = STATUS_STYLE[item.status] ?? STATUS_STYLE.open
  const ty = TYPE_STYLE[item.item_type] ?? TYPE_STYLE.task
  const [mode, setMode] = useState<null | 'update' | 'done'>(null)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [showStatus, setShowStatus] = useState(false)
  const [showTag, setShowTag] = useState(false)

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

      {/* Row 1: description + type + status pill */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-sm leading-snug flex-1" style={{ color: '#e2e8f0' }}>{item.description}</p>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
            style={{ color: ty.color, background: ty.bg }} title="Work item type">
            {ty.label}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
            style={{ color: s.color, background: s.bg }}>
            {s.label}
          </span>
        </div>
      </div>

      {/* Row 2: person, meeting, deadline, effort, health, priority */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[11px]" style={{ color: '#64748b' }}>{item.responsible}</span>
        {item.meeting_number && (
          <Link to="/meetings" className="text-[10px] hover:underline" style={{ color: '#93c5fd', textDecoration: 'none' }}
            title="Go to Meetings">KIM {item.meeting_number}</Link>
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
            style={{ color: '#a78bfa', background: '#4c1d9522', border: '1px solid #4c1d9544' }}
            title={`Carried over from ${item.parent_ref}`}>
            ↑ {item.parent_ref}
          </button>
        )}
        {carriedIntoRef && (
          <button
            onClick={() => onJumpTo(carriedIntoRef)}
            className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80 transition-opacity"
            style={{ color: '#5eead4', background: '#0f766e22', border: '1px solid #0f766e55' }}
            title={`Carried over into ${carriedIntoRef}`}>
            → carried into {carriedIntoRef}
          </button>
        )}
        {item.project_id && (
          <Link to="/projects" className="text-[10px] px-1.5 py-0.5 rounded hover:brightness-125"
            style={{ color: '#38bdf8', background: '#0c4a6e33', border: '1px solid #0369a144', textDecoration: 'none' }}
            title="Go to Projects">
            {item.project_name || item.project_id}
          </Link>
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
          {isAdmin && (
            <button onClick={() => setShowStatus(s => !s)}
              className="text-[11px] px-2.5 py-1 rounded-lg"
              style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }}>
              Status ▾
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setShowTag(s => !s)}
              className="text-[11px] px-2.5 py-1 rounded-lg"
              style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }}>
              Tag ▾
            </button>
          )}
        </div>
      )}

      {/* Terminal items can still be tagged (classify historical work) */}
      {isAdmin && isTerminal && !mode && (
        <div className="flex gap-2 mt-2 flex-wrap">
          <button onClick={() => setShowTag(s => !s)}
            className="text-[11px] px-2.5 py-1 rounded-lg"
            style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }}>
            Tag ▾
          </button>
        </div>
      )}

      {/* Tag editor: work-item type + project (epic) */}
      {isAdmin && showTag && !mode && (
        <div className="flex gap-2 mt-2 flex-wrap items-center">
          <select value={item.item_type}
            onChange={e => onSetMeta(item.id, { item_type: e.target.value as ItemType })}
            className="text-[11px] px-2 py-1 rounded-lg outline-none"
            style={{ background: '#0d1829', color: '#e2e8f0', border: '1px solid #334155' }}>
            <option value="epic">Epic</option>
            <option value="feature">Feature</option>
            <option value="task">Task</option>
            <option value="bug">Bug</option>
          </select>
          <select value={item.project_id || ''}
            onChange={e => onSetMeta(item.id, { project_id: e.target.value || null })}
            className="text-[11px] px-2 py-1 rounded-lg outline-none"
            style={{ background: '#0d1829', color: '#e2e8f0', border: '1px solid #334155' }}>
            <option value="">No project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={item.meeting_ref || ''}
            onChange={e => e.target.value && onSetMeta(item.id, { meeting_ref: e.target.value })}
            title="Move to meeting (sprint)"
            className="text-[11px] px-2 py-1 rounded-lg outline-none"
            style={{ background: '#0d1829', color: '#e2e8f0', border: '1px solid #334155' }}>
            <option value="">No meeting</option>
            {meetings.map(m => <option key={m.ref} value={m.ref}>{m.ref}</option>)}
          </select>
        </div>
      )}

      {/* Status menu */}
      {isAdmin && showStatus && !mode && (
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {([
            ['in_progress', 'In Progress', '#1e3a5f', '#93c5fd'],
            ['blocked',     'Blocked',     '#7c2d12', '#fdba74'],
            ['carried_over','Carried Over','#4c1d95', '#c4b5fd'],
            ['cancelled',   'Cancelled',   '#3f1d1d', '#fca5a5'],
            ['open',        'Reopen',      '#1e293b', '#94a3b8'],
          ] as [DbStatus, string, string, string][]).filter(([s]) => s !== item.status).map(([s, label, bg, color]) => (
            <button key={s}
              onClick={async () => { setShowStatus(false); await onSetStatus(item.id, s) }}
              className="text-[11px] px-2.5 py-1 rounded-lg"
              style={{ background: bg + '55', color, border: `1px solid ${color}44` }}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Kanban board ──────────────────────────────────────────────────────────────
const BOARD_COLUMNS: { key: DbStatus; label: string; color: string }[] = [
  { key: 'open',        label: 'Open',        color: '#fbbf24' },
  { key: 'in_progress', label: 'In Progress', color: '#60a5fa' },
  { key: 'blocked',     label: 'Blocked',     color: '#f97316' },
  { key: 'done',        label: 'Done',        color: '#4ade80' },
]
// 'done' column holds all closed states.
const inColumn = (a: ActionItem, col: DbStatus) =>
  col === 'done' ? (a.status === 'done' || a.status === 'cancelled' || a.status === 'carried_over')
                 : a.status === col

function BoardCard({ item, isAdmin, onSetStatus }: {
  item: ActionItem; isAdmin: boolean; onSetStatus: (id: string, status: DbStatus) => Promise<void>
}) {
  const ty = TYPE_STYLE[item.item_type] ?? TYPE_STYLE.task
  const st = STATUS_STYLE[item.status] ?? STATUS_STYLE.open
  // The select only offers the board-selectable statuses; for any other true status
  // (e.g. carried_over) it's hidden so the status badge above is the source of truth.
  const selectable = (['open', 'in_progress', 'blocked', 'done', 'cancelled'] as DbStatus[]).includes(item.status)
  return (
    <div
      draggable={isAdmin}
      onDragStart={e => { e.dataTransfer.setData('text/plain', item.id); e.dataTransfer.effectAllowed = 'move' }}
      className="rounded-lg p-2.5"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', cursor: isAdmin ? 'grab' : 'default' }}>
      <p className="text-[12px] leading-snug mb-1.5" style={{ color: '#e2e8f0' }}>{item.description}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[9px] px-1 py-0.5 rounded-full font-semibold" style={{ color: ty.color, background: ty.bg }}>{ty.label}</span>
        <span className="text-[9px] px-1 py-0.5 rounded-full font-semibold" style={{ color: st.color, background: st.bg }}>{st.label}</span>
        <span className="text-[10px]" style={{ color: '#64748b' }}>{item.responsible}</span>
        <HealthBadge health={item.health} status={item.status} />
        {item.project_name && (
          <span className="text-[9px] px-1 py-0.5 rounded" style={{ color: '#38bdf8', background: '#0c4a6e33' }}>{item.project_name}</span>
        )}
      </div>
      <div className="text-[9px] font-mono mt-1" style={{ color: '#475569' }}>{item.id}</div>
      {isAdmin && selectable && (
        <select value={item.status}
          onMouseDown={e => e.stopPropagation()}
          onChange={e => onSetStatus(item.id, e.target.value as DbStatus)}
          className="mt-1.5 w-full text-[10px] px-1.5 py-1 rounded outline-none"
          style={{ background: '#0d1829', color: '#94a3b8', border: '1px solid #334155' }}>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="blocked">Blocked</option>
          <option value="done">Done</option>
          <option value="cancelled">Cancelled</option>
        </select>
      )}
    </div>
  )
}

export default function ActionsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const isAdmin = ADMIN_USERS.includes(user?.name || '')
  const [filter, setFilter] = useState<FilterTab>('active')
  const [groupBy, setGroupBy] = useState<GroupBy>('assignee')
  const [view, setView] = useState<'list' | 'board'>('list')
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
            project_name: a.project_name || null,
            item_type: (a.item_type || 'task') as ItemType,
            parent_ref: a.parent_ref || null,
            meeting_number: a.meeting ? String(a.meeting).replace(/^KIM\s*/i, '') || null : null,
            meeting_ref: a.meeting || null,
            updated_at: a.note || null,
          })
        }
      }
      return flat
    },
  })

  const { data: projects = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['projects-list'],
    queryFn: () => fetch('/api/projects/list', { credentials: 'include' }).then(r => r.json()).then(d => d.projects || []),
  })

  const { data: meetingsList = [] } = useQuery<{ ref: string; number: string }[]>({
    queryKey: ['meetings-list'],
    queryFn: () => fetch('/api/meetings', { credentials: 'include' }).then(r => r.json())
      .then(d => (Array.isArray(d) ? d : []).map((m: any) => ({ ref: m.meeting_ref, number: m.meeting_number }))
        .filter((m: any) => m.ref)),
  })

  const setMeta = async (id: string, patch: { item_type?: ItemType; project_id?: string | null; meeting_ref?: string }) => {
    try {
      const r = await fetch('/api/actions/meta', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_id: id, ...patch }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Failed')
      toast.success(`${id} updated`)
      qc.invalidateQueries({ queryKey: ['actions'] })
      if (patch.meeting_ref) qc.invalidateQueries({ queryKey: ['meetings-list'] })
    } catch (e: any) { toast.error(`Could not update: ${e.message}`) }
  }

  const markDone = async (id: string, comment: string) => {
    try {
      const r = await fetch('/api/actions/done', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_id: id, comment }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Failed')
      toast.success(`${id} marked done`)
      qc.invalidateQueries({ queryKey: ['actions'] })
    } catch (e: any) { toast.error(`Could not mark done: ${e.message}`) }
  }

  const addUpdate = async (id: string, updateText: string) => {
    try {
      const r = await fetch('/api/actions/update', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_id: id, update_text: updateText }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Failed')
      toast.success(`Update added to ${id}`)
      qc.invalidateQueries({ queryKey: ['actions'] })
    } catch (e: any) { toast.error(`Could not add update: ${e.message}`) }
  }

  const setStatus = async (id: string, status: DbStatus) => {
    // Carry-over is special: it creates a continuation action in the next meeting.
    if (status === 'carried_over') return carryOver(id)
    try {
      const r = await fetch('/api/actions/status', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_id: id, status }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Failed')
      toast.success(`${id} → ${status.replace('_', ' ')}`)
      qc.invalidateQueries({ queryKey: ['actions'] })
    } catch (e: any) { toast.error(`Could not change status: ${e.message}`) }
  }

  const carryOver = async (id: string) => {
    try {
      const r = await fetch('/api/actions/carry-over', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_id: id }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.detail || 'Failed')
      toast.success(`${id} carried over to ${d.carried_to_meeting} as ${d.new_ref}`)
      qc.invalidateQueries({ queryKey: ['actions'] })
      qc.invalidateQueries({ queryKey: ['meetings'] })
    } catch (e: any) { toast.error(`Could not carry over: ${e.message}`) }
  }

  const jumpTo = (ref: string) => {
    setSearch(ref)
    setFilter('all')
  }

  const isActive = (a: ActionItem) =>
    a.status === 'open' || a.status === 'in_progress' || a.status === 'blocked'

  // Meeting (= sprint) number parsed from "010/2026" -> 10. Latest = most recent meeting
  // that has actions, so "This meeting" surfaces the last sprint's items for review.
  const meetingNum = (m: string | null) => {
    if (!m) return -1
    const n = parseInt(m.split('/')[0], 10)
    return isNaN(n) ? -1 : n
  }
  const latestMeeting = items.reduce((mx, a) => Math.max(mx, meetingNum(a.meeting_number)), -1)
  const isThisMeeting = (a: ActionItem) => latestMeeting > 0 && meetingNum(a.meeting_number) === latestMeeting

  const visible = items.filter(a => {
    const matchFilter =
      filter === 'all'          ? true :
      filter === 'active'       ? isActive(a) :
      filter === 'this_meeting' ? isThisMeeting(a) :
      filter === 'overdue'      ? a.health === 'overdue' :
      filter === 'due_soon'     ? a.health === 'at_risk' :
      filter === 'done'         ? (a.status === 'done' || a.status === 'cancelled' || a.status === 'carried_over') :
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
    active:       items.filter(isActive).length,
    this_meeting: items.filter(isThisMeeting).length,
    overdue:      items.filter(a => a.health === 'overdue').length,
    due_soon:     items.filter(a => a.health === 'at_risk').length,
    done:         items.filter(a => a.status === 'done' || a.status === 'cancelled' || a.status === 'carried_over').length,
    all:          items.length,
  }

  const FILTERS: { key: FilterTab; label: string; color: string }[] = [
    { key: 'active',       label: `Active (${counts.active})`,            color: '#60a5fa' },
    { key: 'this_meeting', label: `This meeting (${counts.this_meeting})`, color: '#a78bfa' },
    { key: 'overdue',      label: `Overdue (${counts.overdue})`,          color: '#f87171' },
    { key: 'due_soon',     label: `Due soon (${counts.due_soon})`,        color: '#fbbf24' },
    { key: 'done',         label: `Done (${counts.done})`,                color: '#4ade80' },
    { key: 'all',          label: `All (${counts.all})`,                  color: '#94a3b8' },
  ]

  const GROUPS: { key: GroupBy; label: string }[] = [
    { key: 'assignee', label: 'By person' },
    { key: 'project',  label: 'By project' },
    { key: 'meeting',  label: 'By meeting' },
  ]
  const titleCase = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const groupKeyOf = (a: ActionItem) =>
    groupBy === 'assignee' ? a.responsible :
    groupBy === 'project'  ? (a.project_name || (a.project_id ? titleCase(a.project_id) : 'No project')) :
                             (a.meeting_number ? `KIM ${a.meeting_number}` : 'No meeting')

  // Reverse the parent_ref links so a carried-over action can point DOWN to the
  // action it was carried/restated into (child.parent_ref === parent.id).
  const carriedIntoByRef: Record<string, string> = {}
  const statusById: Record<string, DbStatus> = {}
  for (const a of items) {
    if (a.parent_ref) carriedIntoByRef[a.parent_ref] = a.id
    statusById[a.id] = a.status
  }

  const groups: Record<string, ActionItem[]> = {}
  for (const a of visible) {
    const k = groupKeyOf(a)
    if (!groups[k]) groups[k] = []
    groups[k].push(a)
  }
  // Newest meeting first when grouping by meeting; otherwise alphabetical.
  const groupEntries = Object.entries(groups).sort((x, y) =>
    groupBy === 'meeting'
      ? meetingNum(y[0].replace(/^KIM\s*/, '')) - meetingNum(x[0].replace(/^KIM\s*/, ''))
      : x[0].localeCompare(y[0]))

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

      {/* View toggle + (list only) Group-by */}
      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: '#475569' }}>View</span>
        {(['list', 'board'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-all"
            style={{
              background: view === v ? '#334155' : 'transparent',
              color: view === v ? '#e2e8f0' : '#475569',
              border: '1px solid #334155',
            }}>
            {v === 'list' ? 'List' : 'Board'}
          </button>
        ))}
        <span className="ml-2 text-[10px] uppercase tracking-wider" style={{ color: '#475569' }}>{view === 'board' ? 'Swimlanes' : 'Group'}</span>
        {GROUPS.map(g => (
          <button key={g.key} onClick={() => setGroupBy(g.key)}
            className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-all"
            style={{
              background: groupBy === g.key ? '#334155' : 'transparent',
              color: groupBy === g.key ? '#e2e8f0' : '#475569',
              border: '1px solid #334155',
            }}>
            {g.label}
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

      {/* Board view: swimlanes (by Group-by) × status columns. Drag (desktop) / status select (admin). */}
      {view === 'board' && !isLoading && groupEntries.map(([laneName, laneItems]) => (
        <div key={laneName} className="mb-4">
          <h3 className="text-[11px] font-semibold mb-2 uppercase tracking-wider" style={{ color: '#475569' }}>
            {laneName} ({laneItems.length})
          </h3>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {BOARD_COLUMNS.map(col => {
              const colItems = laneItems.filter(a => inColumn(a, col.key))
              return (
                <div key={col.key}
                  onDragOver={e => { if (isAdmin) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } }}
                  onDrop={e => {
                    if (!isAdmin) return
                    e.preventDefault()
                    const id = e.dataTransfer.getData('text/plain')
                    if (!id || !(id in statusById) || inColumn({ status: statusById[id] } as ActionItem, col.key)) return  // skip unknown/same-column
                    setStatus(id, col.key)
                  }}
                  className="shrink-0 rounded-xl p-2" style={{ width: 240, background: '#0d182955', border: '1px solid var(--border)' }}>
                  <div className="flex items-center justify-between mb-2 px-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: col.color }}>{col.label}</span>
                    <span className="text-[10px]" style={{ color: '#475569' }}>{colItems.length}</span>
                  </div>
                  <div className="space-y-2">
                    {colItems.map(a => <BoardCard key={a.id} item={a} isAdmin={isAdmin} onSetStatus={setStatus} />)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* List view */}
      {view === 'list' && groupEntries.map(([groupName, groupItems]) => (
        <div key={groupName}>
          <h3 className="text-[11px] font-semibold mb-2 uppercase tracking-wider"
            style={{ color: '#475569' }}>
            {groupName} ({groupItems.length})
          </h3>
          <div className="space-y-2">
            {groupItems.map(a => (
              <ActionCard
                key={a.id}
                item={a}
                carriedIntoRef={carriedIntoByRef[a.id] || null}
                isAdmin={isAdmin}
                userName={user?.name || ''}
                onMarkDone={markDone}
                onAddUpdate={addUpdate}
                onSetStatus={setStatus}
                onJumpTo={jumpTo}
                projects={projects}
                meetings={meetingsList}
                onSetMeta={setMeta}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
