// ExpenditurePage
// APIs: GET /api/contributions/expenditure
//       GET /api/projects/all  — single source of truth for project list
//       POST /api/contributions/expenditure  { txn_date, description, amount_ugx, category, project }
//       POST /api/contributions/expenditure/{id}/receipt  (multipart)
// Only Hillary and Hellen can record expenses (enforced in backend + frontend)

import { useState, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'

const CATEGORIES = [
  { value: 'project_investment', label: 'Project Investment', color: '#4ade80' },
  { value: 'staff',              label: 'Staff / Stipend',    color: '#93c5fd' },
  { value: 'event',              label: 'Event',              color: '#fbbf24' },
  { value: 'loan',               label: 'Loan',               color: '#c4b5fd' },
  { value: 'other',              label: 'Other',              color: '#94a3b8' },
]

interface KimProject { id: string; name: string }
interface Expense {
  id: number; txn_date: string; description: string; amount_ugx: number
  category: string; project: string | null; recorded_by: string | null
  is_historical: boolean; receipt_url: string | null
}

function catLabel(v: string) { return CATEGORIES.find(c => c.value === v)?.label ?? v }
function catColor(v: string) { return CATEGORIES.find(c => c.value === v)?.color ?? '#94a3b8' }

function Chip({ label, active, onClick, color }: { label: string; active: boolean; onClick: () => void; color?: string }) {
  return (
    <button onClick={onClick} style={{
      background: active ? (color ? color + '33' : '#166534') : '#1e293b',
      color: active ? (color || '#4ade80') : '#94a3b8',
      border: `1px solid ${active ? (color || '#22c55e') : '#334155'}`,
      borderRadius: 999, padding: '4px 11px', fontSize: 11,
      fontWeight: active ? 600 : 400, cursor: 'pointer', flexShrink: 0,
    }}>{label}</button>
  )
}

// ── Add Expense Modal ─────────────────────────────────────────────────────────

function AddExpenseModal({ onClose, onSaved, projects }: {
  onClose: () => void; onSaved: () => void; projects: KimProject[]
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate]     = useState('')       // blank — user must select
  const [desc, setDesc]     = useState('')
  const [amtRaw, setAmtRaw] = useState('')
  const [cat, setCat]       = useState('project_investment')
  const [proj, setProj]     = useState('')
  const [file, setFile]     = useState<File | null>(null)
  const [err, setErr]       = useState('')
  const [busy, setBusy]     = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Project is required when category is staff/stipend
  const projectRequired = cat === 'staff'

  const submit = async () => {
    setErr('')
    const amount_ugx = parseInt(amtRaw.replace(/[^0-9]/g, '')) || 0
    if (!date)                     return setErr('Date is required.')
    if (date > today)              return setErr('Date cannot be in the future.')
    if (!desc.trim())              return setErr('Description is required.')
    if (!amount_ugx)               return setErr('Enter a valid amount.')
    if (projectRequired && !proj)  return setErr('Project is required for Staff / Stipend expenses.')
    setBusy(true)
    try {
      const r = await fetch('/api/contributions/expenditure', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txn_date: date, description: desc.trim(), amount_ugx, category: cat, project: proj || null }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        setErr(j.detail || 'Failed to save expense.')
        setBusy(false); return
      }
      const { expenditure_id } = await r.json()
      if (file) {
        const fd = new FormData(); fd.append('file', file)
        const up = await fetch(`/api/contributions/expenditure/${expenditure_id}/receipt`, {
          method: 'POST', credentials: 'include', body: fd,
        })
        if (!up.ok) { setErr('Expense saved but receipt upload failed.'); setBusy(false); return }
      }
      onSaved(); onClose()
    } catch { setErr('Network error. Try again.') }
    setBusy(false)
  }

  const field = {
    className: 'w-full rounded-lg px-3 py-2.5 text-sm outline-none',
    style: { background: '#0f172a', color: '#f1f5f9', border: '1px solid #334155' } as React.CSSProperties,
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <div className="w-full max-w-md rounded-t-2xl" style={{ background: '#0d1829', border: '1px solid #334155', maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3" style={{ borderBottom: '1px solid #1e293b' }}>
          <div>
            <div className="font-bold text-base" style={{ color: '#f1f5f9' }}>💸 Add Expense</div>
            <div className="text-xs" style={{ color: '#64748b' }}>Records a club expenditure. Admin only.</div>
          </div>
          <button onClick={onClose} style={{ background: '#1e293b', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', color: '#64748b' }}>✕</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {/* Date — blank, calendar picker */}
          <div>
            <label className="block text-xs mb-1" style={{ color: '#94a3b8' }}>Date (required)</label>
            <input type="date" value={date} max={today}
              onChange={e => setDate(e.target.value)}
              {...field} style={{ ...field.style, colorScheme: 'dark' }}
            />
          </div>

          {/* Description */}
          <input type="text" placeholder="Description (required)" value={desc}
            onChange={e => setDesc(e.target.value)} {...field} />

          {/* Amount */}
          <input type="text" inputMode="numeric" placeholder="Amount (UGX)" value={amtRaw}
            onChange={e => { const d = e.target.value.replace(/[^0-9]/g, ''); setAmtRaw(d ? parseInt(d).toLocaleString() : '') }}
            {...field} />

          {/* Category */}
          <div>
            <label className="block text-xs mb-1" style={{ color: '#94a3b8' }}>Category</label>
            <select value={cat} onChange={e => { setCat(e.target.value); setProj('') }} {...field}>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          {/* Project — from /api/projects/all, required for staff */}
          <div>
            <label className="block text-xs mb-1"
              style={{ color: projectRequired ? '#fbbf24' : '#94a3b8' }}>
              Project {projectRequired ? '(required for stipend)' : '(optional)'}
            </label>
            <select value={proj} onChange={e => setProj(e.target.value)}
              {...field}
              style={{ ...field.style, border: projectRequired && !proj ? '1px solid #f59e0b' : '1px solid #334155' }}>
              <option value="">— None —</option>
              <option value="all">All projects / General</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {/* Receipt */}
          <div>
            <label className="block text-xs mb-1.5" style={{ color: '#64748b' }}>Receipt — PDF or image (optional)</label>
            <label className="flex items-center gap-2 rounded-lg px-3 py-2.5 cursor-pointer text-sm"
              style={{ background: '#1e293b', border: `1px solid ${file ? '#22c55e' : '#334155'}`, color: file ? '#22c55e' : '#64748b' }}>
              📎 {file ? file.name : 'Attach receipt'}
              <input ref={fileRef} type="file" accept="image/*,.pdf" className="sr-only"
                onChange={e => setFile(e.target.files?.[0] || null)} />
            </label>
          </div>

          {err && <p className="text-xs rounded-lg px-3 py-2" style={{ background: '#450a0a', color: '#fca5a5' }}>{err}</p>}
        </div>
        <div className="px-5 py-4 flex gap-2" style={{ borderTop: '1px solid #1e293b' }}>
          <button onClick={onClose} className="flex-1 rounded-xl py-3 text-sm"
            style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }}>Cancel</button>
          <button onClick={submit} disabled={busy}
            className="rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
            style={{ flex: 2, background: '#166534', color: '#fff' }}>
            {busy ? 'Saving...' : 'Save Expense'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ExpenditurePage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const canAddExpense = user?.role === 'admin'

  const [yearFilter,    setYearFilter]    = useState('all')
  const [catFilter,     setCatFilter]     = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')
  const [showAdd,       setShowAdd]       = useState(false)

  const { data: expenses = [], isLoading } = useQuery<Expense[]>({
    queryKey: ['expenditure'],
    queryFn: () => fetch('/api/contributions/expenditure', { credentials: 'include' }).then(r => r.json()),
    staleTime: 30_000,
  })

  // Single source of truth for project list
  const { data: allProjects = [] } = useQuery<KimProject[]>({
    queryKey: ['projects-all'],
    queryFn: () => fetch('/api/projects/all', { credentials: 'include' }).then(r => r.json()),
    staleTime: 300_000,
  })

  const years = useMemo(() =>
    [...new Set(expenses.map(e => e.txn_date?.slice(0, 4)).filter(Boolean))].sort().reverse()
  , [expenses])

  // When category filter changes away from project_investment, reset project filter
  const onCatFilter = (cat: string) => {
    setCatFilter(cat)
    if (cat !== 'project_investment') setProjectFilter('all')
  }

  const filtered = useMemo(() => expenses.filter(e => {
    if (yearFilter !== 'all' && e.txn_date?.slice(0, 4) !== yearFilter)  return false
    if (catFilter  !== 'all' && e.category !== catFilter)                 return false
    if (catFilter === 'project_investment' && projectFilter !== 'all') {
      if (projectFilter === 'none') return !e.project
      if ((e.project || '') !== projectFilter)                            return false
    }
    return true
  }), [expenses, yearFilter, catFilter, projectFilter])

  const totalShown = filtered.reduce((s, e) => s + (e.amount_ugx || 0), 0)
  const grandTotal = expenses.reduce((s, e) => s + (e.amount_ugx || 0), 0)

  // Projects that actually have expenses (for the filter chips)
  const projectsWithExpenses = useMemo(() => {
    const used = new Set(expenses.filter(e => e.category === 'project_investment').map(e => e.project || ''))
    return allProjects.filter(p => used.has(p.id))
  }, [expenses, allProjects])

  if (isLoading) return <div className="text-center py-10 text-sm" style={{ color: '#64748b' }}>Loading...</div>

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      {/* header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold" style={{ color: '#f1f5f9' }}>Expenditure</h2>
          <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>
            {expenses.length} records · Total: UGX {grandTotal.toLocaleString()}
          </div>
        </div>
        {canAddExpense && (
          <button onClick={() => setShowAdd(true)}
            className="rounded-lg px-4 py-2 text-sm font-semibold"
            style={{ background: '#166534', color: '#fff' }}>
            + Add Expense
          </button>
        )}
      </div>

      {/* year filter */}
      <div className="flex gap-2 flex-wrap">
        <Chip label="All years" active={yearFilter === 'all'} onClick={() => setYearFilter('all')} />
        {years.map(y => (
          <Chip key={y} label={y} active={yearFilter === y} onClick={() => setYearFilter(y)} />
        ))}
      </div>

      {/* category filter */}
      <div className="flex gap-2 flex-wrap">
        <Chip label="All" active={catFilter === 'all'} onClick={() => onCatFilter('all')} />
        {CATEGORIES.map(c => (
          <Chip key={c.value} label={c.label} active={catFilter === c.value}
            onClick={() => onCatFilter(c.value)} color={c.color} />
        ))}
      </div>

      {/* project sub-filter — only when Project Investment is selected */}
      {catFilter === 'project_investment' && projectsWithExpenses.length > 0 && (
        <div className="flex gap-2 flex-wrap pl-2" style={{ borderLeft: '2px solid #4ade8055' }}>
          <Chip label="All projects" active={projectFilter === 'all'}
            onClick={() => setProjectFilter('all')} color="#4ade80" />
          {projectsWithExpenses.map(p => (
            <Chip key={p.id} label={p.name} active={projectFilter === p.id}
              onClick={() => setProjectFilter(p.id)} color="#4ade80" />
          ))}
        </div>
      )}

      {/* count + total */}
      <div className="text-xs" style={{ color: '#94a3b8' }}>
        {filtered.length} record{filtered.length !== 1 ? 's' : ''} ·
        Total: <span style={{ color: '#f87171', fontWeight: 600 }}>UGX {totalShown.toLocaleString()}</span>
      </div>

      {/* list */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#1e293b', border: '1px solid #334155' }}>
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: '#64748b' }}>No expenses match the filters.</div>
        ) : filtered.map((e, i) => (
          <div key={e.id} style={{ borderBottom: i < filtered.length - 1 ? '1px solid #0f172a' : 'none', padding: '12px 14px' }}>
            <div className="flex justify-between items-baseline gap-3 mb-1">
              <span className="text-sm flex-1" style={{ color: '#f1f5f9' }}>{e.description}</span>
              <span className="text-sm font-semibold whitespace-nowrap" style={{ color: '#f87171' }}>
                - UGX {(e.amount_ugx || 0).toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs" style={{ color: '#94a3b8' }}>{e.txn_date || ''}</span>
                <span className="text-xs px-2 py-0.5 rounded"
                  style={{ background: catColor(e.category) + '22', color: catColor(e.category) }}>
                  {catLabel(e.category)}
                </span>
                {e.project && (
                  <span className="text-xs px-2 py-0.5 rounded"
                    style={{ background: '#0f172a', color: '#cbd5e1', border: '1px solid #334155' }}>
                    {allProjects.find(p => p.id === e.project)?.name ?? e.project.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {e.receipt_url && (
                  <a href={e.receipt_url} target="_blank" rel="noreferrer"
                    className="text-xs" style={{ color: '#22c55e' }}>📎 receipt ↗</a>
                )}
                {e.recorded_by && (
                  <span className="text-xs" style={{ color: '#64748b' }}>
                    by {e.recorded_by}{e.is_historical ? ' (historical)' : ''}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {showAdd && (
        <AddExpenseModal
          onClose={() => setShowAdd(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: ['expenditure'] })}
          projects={allProjects}
        />
      )}
    </div>
  )
}
