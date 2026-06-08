import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'

const ADMIN_USERS = ['Hillary', 'Hellen']

type Status = 'pending' | 'overdue' | 'done' | 'all'

interface ActionItem {
  id: number
  description: string
  responsible: string
  deadline: string | null
  status: 'pending' | 'done' | 'overdue'
  meeting_id: number | null
  meeting_date: string | null
  meeting_number: string | null
  updated_at: string | null
}

const STATUS_STYLE: Record<ActionItem['status'], { label: string; color: string; bg: string }> = {
  pending: { label: 'Pending', color: '#fbbf24', bg: '#78350f33' },
  overdue: { label: 'Overdue', color: '#f87171', bg: '#7f1d1d33' },
  done:    { label: 'Done',    color: '#4ade80', bg: '#14532d33' },
}

function daysLeft(deadline: string | null): number | null {
  if (!deadline) return null
  return Math.round((new Date(deadline).getTime() - Date.now()) / 86_400_000)
}

function DeadlineChip({ deadline, status }: { deadline: string | null; status: ActionItem['status'] }) {
  if (!deadline || status === 'done') return null
  const d = daysLeft(deadline)
  if (d === null) return null
  const color = d < 0 ? '#f87171' : d <= 3 ? '#fbbf24' : '#94a3b8'
  const label = d < 0 ? `${Math.abs(d)}d overdue` : d === 0 ? 'Due today' : `${d}d left`
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ color, background: color + '22' }}>{label}</span>
}

function ActionCard({ item, isAdmin, onUpdate }: {
  item: ActionItem
  isAdmin: boolean
  onUpdate: (id: number, status: ActionItem['status']) => void
}) {
  const s = STATUS_STYLE[item.status]

  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--bg-card)', border: `1px solid ${s.color}33` }}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-sm leading-snug flex-1" style={{ color: '#e2e8f0' }}>{item.description}</p>
        <span className="text-[10px] shrink-0 px-1.5 py-0.5 rounded-full font-semibold"
          style={{ color: s.color, background: s.bg }}>
          {s.label}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-1.5">
        <span className="text-[11px]" style={{ color: '#64748b' }}>
          {item.responsible}
        </span>
        {item.meeting_number && (
          <span className="text-[10px]" style={{ color: '#475569' }}>
            KIM {item.meeting_number}
          </span>
        )}
        {item.deadline && (
          <span className="text-[10px]" style={{ color: '#475569' }}>
            {item.deadline}
          </span>
        )}
        <DeadlineChip deadline={item.deadline} status={item.status} />
      </div>
      {isAdmin && item.status !== 'done' && (
        <button
          onClick={() => onUpdate(item.id, 'done')}
          className="mt-2 text-[11px] px-2.5 py-1 rounded-lg"
          style={{ background: '#14532d', color: '#4ade80', border: '1px solid #166834' }}>
          Mark done
        </button>
      )}
    </div>
  )
}

export default function ActionsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const qc = useQueryClient()
  const isAdmin = ADMIN_USERS.includes(user?.name || '')
  const [filter, setFilter] = useState<Status>('pending')
  const [search, setSearch] = useState('')

  const { data: items = [], isLoading } = useQuery<ActionItem[]>({
    queryKey: ['actions'],
    queryFn: () => fetch('/api/actions', { credentials: 'include' }).then(r => r.json()),
  })

  const update = async (id: number, status: ActionItem['status']) => {
    await fetch(`/api/actions/${id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    qc.invalidateQueries({ queryKey: ['actions'] })
  }

  const visible = items.filter(a => {
    if (filter !== 'all' && a.status !== filter) return false
    if (search && !a.description.toLowerCase().includes(search.toLowerCase()) &&
        !a.responsible.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const counts = {
    all: items.length,
    pending: items.filter(a => a.status === 'pending').length,
    overdue: items.filter(a => a.status === 'overdue').length,
    done: items.filter(a => a.status === 'done').length,
  }

  const FILTERS: { key: Status; label: string; color: string }[] = [
    { key: 'pending', label: `Pending (${counts.pending})`, color: '#fbbf24' },
    { key: 'overdue', label: `Overdue (${counts.overdue})`, color: '#f87171' },
    { key: 'done',    label: `Done (${counts.done})`,    color: '#4ade80' },
    { key: 'all',     label: `All (${counts.all})`,      color: '#94a3b8' },
  ]

  // Group by responsible person
  const byPerson: Record<string, ActionItem[]> = {}
  for (const a of visible) {
    if (!byPerson[a.responsible]) byPerson[a.responsible] = []
    byPerson[a.responsible].push(a)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">

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
        type="text" placeholder={t('common.search') + '...'}
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

      {/* Group by person */}
      {Object.entries(byPerson).map(([person, personItems]) => (
        <div key={person}>
          <h3 className="text-[11px] font-semibold mb-2 uppercase tracking-wider"
            style={{ color: '#475569' }}>
            {person} ({personItems.length})
          </h3>
          <div className="space-y-2">
            {personItems.map(a => (
              <ActionCard key={a.id} item={a} isAdmin={isAdmin} onUpdate={update} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
