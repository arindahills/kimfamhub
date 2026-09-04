import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PlusCircle, Skull, Syringe, Check, Trash2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { ugx } from '@/lib/utils'

/** Solomon/admin-only in-app entry for the sheep tracker (Epic #16). Records go straight to
 *  Postgres via /api/projects/sheep/{event,expense} — never a spreadsheet. */

const EVENT_TYPES = ['death', 'birth', 'sale', 'purchase'] as const
const EXPENSE_CATEGORIES = ['vet', 'ear_tag', 'pasture', 'feed_silage', 'sourcing', 'transport', 'labour', 'other'] as const
const today = () => new Date().toISOString().slice(0, 10)

async function send(url: string, method: string, body?: unknown) {
  const r = await fetch(url, {
    method, credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    const d = (await r.json().catch(() => ({})))?.detail
    throw new Error(typeof d === 'string' ? d : `invalid input (${r.status})`)   // 422 detail can be an array
  }
  return r.json()
}

const inputCls = 'w-full rounded-[8px] border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-[13px] text-white'
const labelCls = 'text-[11px] text-[var(--muted-2)]'
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))

function Flash({ show }: { show: boolean }) {
  if (!show) return null
  return <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-[#4ade80]"><Check size={12} /> saved</span>
}

function EventForm({ onSaved }: { onSaved: () => void }) {
  const [f, setF] = useState({ event_type: 'death', event_date: today(), count: '1', cause: '', amount_ugx: '', counterparty: '', note: '' })
  const [ok, setOk] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const money = f.event_type === 'sale' || f.event_type === 'purchase'
  const summary = () => {
    const parts = [f.event_type.toUpperCase(), `${Number(f.count) || 1} sheep`, f.event_date]
    if (f.event_type === 'death') parts.push(`cause: ${f.cause.trim() || 'not specified'}`)
    if (money) { parts.push(`${f.amount_ugx.trim() ? Number(f.amount_ugx).toLocaleString() : '—'} UGX`); if (f.counterparty.trim()) parts.push(f.counterparty.trim()) }
    return parts.join('  ·  ')
  }
  const m = useMutation({
    mutationFn: () => send('/api/projects/sheep/event', 'POST', {
      event_type: f.event_type, event_date: f.event_date, count: Number(f.count) || 1,
      cause: f.cause || null,
      amount_ugx: money ? numOrNull(f.amount_ugx) : null,   // blank → null so backend 422s, not silent 0
      counterparty: f.counterparty || null, note: f.note || null,
    }),
    onSuccess: () => { setOk(true); setConfirming(false); setTimeout(() => setOk(false), 2500); setF(s => ({ ...s, count: '1', cause: '', amount_ugx: '', counterparty: '', note: '' })); onSaved() },
  })
  return (
    <div className="rounded-[10px] bg-[var(--card-inset)] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-white"><Skull size={13} className="text-[#f87171]" /> Record event <Flash show={ok} /></div>
      <div className="grid grid-cols-2 gap-2">
        <label><span className={labelCls}>Type</span>
          <select className={inputCls} value={f.event_type} onChange={e => setF(s => ({ ...s, event_type: e.target.value }))}>
            {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select></label>
        <label><span className={labelCls}>Date</span>
          <input type="date" className={inputCls} value={f.event_date} onChange={e => setF(s => ({ ...s, event_date: e.target.value }))} /></label>
        <label><span className={labelCls}>Count</span>
          <input type="number" min={1} inputMode="numeric" className={inputCls} value={f.count} onChange={e => setF(s => ({ ...s, count: e.target.value }))} /></label>
        {f.event_type === 'death' && <label><span className={labelCls}>Cause</span>
          <input className={inputCls} placeholder="unknown" value={f.cause} onChange={e => setF(s => ({ ...s, cause: e.target.value }))} /></label>}
        {money && <label><span className={labelCls}>Amount (UGX)</span>
          <input type="number" inputMode="numeric" className={inputCls} value={f.amount_ugx} onChange={e => setF(s => ({ ...s, amount_ugx: e.target.value }))} /></label>}
        {money && <label><span className={labelCls}>{f.event_type === 'purchase' ? 'Seller' : 'Buyer'}</span>
          <input className={inputCls} placeholder={f.event_type === 'purchase' ? 'e.g. Mum' : 'buyer'} value={f.counterparty} onChange={e => setF(s => ({ ...s, counterparty: e.target.value }))} /></label>}
        <label className="col-span-2"><span className={labelCls}>Note</span>
          <input className={inputCls} value={f.note} onChange={e => setF(s => ({ ...s, note: e.target.value }))} /></label>
      </div>
      {m.isError && <div className="mt-1.5 text-[11px] text-[#f87171]">{(m.error as Error).message}</div>}
      {!confirming ? (
        <button onClick={() => setConfirming(true)} className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] border border-[var(--border)] bg-[var(--card)] text-[13px] font-semibold text-white">
          <PlusCircle size={14} /> Review event
        </button>
      ) : (
        <div className="mt-2 rounded-[8px] border border-[rgba(248,113,113,0.35)] bg-[rgba(248,113,113,0.06)] p-2.5">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--muted-2)]">Confirm — this saves for the whole family</div>
          <div className="mb-2.5 text-[13px] font-semibold text-[#fca5a5]">{summary()}</div>
          <div className="flex gap-2">
            <button onClick={() => setConfirming(false)} className="h-9 flex-1 rounded-[8px] border border-[var(--border)] text-[13px] text-[var(--muted)]">Cancel</button>
            <button onClick={() => m.mutate()} disabled={m.isPending} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[8px] bg-[var(--primary)] text-[13px] font-semibold text-[#0b1220] disabled:opacity-50"><Check size={14} /> {m.isPending ? 'Saving…' : 'Confirm & save'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

function ExpenseForm({ onSaved }: { onSaved: () => void }) {
  const [f, setF] = useState({ category: 'vet', amount_ugx: '', spent_on: today(), paid_by: '', note: '' })
  const [ok, setOk] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const summary = () => [f.category, `${f.amount_ugx.trim() ? Number(f.amount_ugx).toLocaleString() : '—'} UGX`, f.spent_on]
    .concat(f.paid_by.trim() ? [`paid by ${f.paid_by.trim()}`] : []).join('  ·  ')
  const m = useMutation({
    mutationFn: () => send('/api/projects/sheep/expense', 'POST', {
      category: f.category, amount_ugx: numOrNull(f.amount_ugx), spent_on: f.spent_on,
      paid_by: f.paid_by || null, note: f.note || null,
    }),
    onSuccess: () => { setOk(true); setConfirming(false); setTimeout(() => setOk(false), 2500); setF(s => ({ ...s, amount_ugx: '', paid_by: '', note: '' })); onSaved() },
  })
  return (
    <div className="mt-2 rounded-[10px] bg-[var(--card-inset)] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-white"><Syringe size={13} className="text-[#60a5fa]" /> Record expense (vaccines = vet) <Flash show={ok} /></div>
      <div className="grid grid-cols-2 gap-2">
        <label><span className={labelCls}>Category</span>
          <select className={inputCls} value={f.category} onChange={e => setF(s => ({ ...s, category: e.target.value }))}>
            {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select></label>
        <label><span className={labelCls}>Amount (UGX)</span>
          <input type="number" inputMode="numeric" className={inputCls} value={f.amount_ugx} onChange={e => setF(s => ({ ...s, amount_ugx: e.target.value }))} /></label>
        <label><span className={labelCls}>Date</span>
          <input type="date" className={inputCls} value={f.spent_on} onChange={e => setF(s => ({ ...s, spent_on: e.target.value }))} /></label>
        <label><span className={labelCls}>Paid by</span>
          <input className={inputCls} value={f.paid_by} onChange={e => setF(s => ({ ...s, paid_by: e.target.value }))} /></label>
        <label className="col-span-2"><span className={labelCls}>Note</span>
          <input className={inputCls} value={f.note} onChange={e => setF(s => ({ ...s, note: e.target.value }))} /></label>
      </div>
      {m.isError && <div className="mt-1.5 text-[11px] text-[#f87171]">{(m.error as Error).message}</div>}
      {!confirming ? (
        <button onClick={() => setConfirming(true)} className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] border border-[var(--border)] bg-[var(--card)] text-[13px] font-semibold text-white">
          <PlusCircle size={14} /> Review expense
        </button>
      ) : (
        <div className="mt-2 rounded-[8px] border border-[rgba(96,165,250,0.35)] bg-[rgba(96,165,250,0.06)] p-2.5">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--muted-2)]">Confirm — this saves for the whole family</div>
          <div className="mb-2.5 text-[13px] font-semibold text-[#93c5fd]">{summary()}</div>
          <div className="flex gap-2">
            <button onClick={() => setConfirming(false)} className="h-9 flex-1 rounded-[8px] border border-[var(--border)] text-[13px] text-[var(--muted)]">Cancel</button>
            <button onClick={() => m.mutate()} disabled={m.isPending} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[8px] bg-[var(--primary)] text-[13px] font-semibold text-[#0b1220] disabled:opacity-50"><Check size={14} /> {m.isPending ? 'Saving…' : 'Confirm & save'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

interface Detail { recent_events?: { id: number; date: string; event_type: string; count: number; note?: string }[]; recent_expenses?: { id: number; category: string; amount_ugx: number; spent_on: string }[] }

function RecentEntries({ onChanged }: { onChanged: () => void }) {
  const { data } = useQuery<Detail>({ queryKey: ['detail', 'sheep'], queryFn: () => send('/api/projects/sheep/detail', 'GET') })
  const del = useMutation({
    mutationFn: (v: { kind: 'event' | 'expense'; id: number }) => send(`/api/projects/sheep/${v.kind}/${v.id}`, 'DELETE'),
    onSuccess: onChanged,
  })
  const ev = data?.recent_events?.slice(0, 5) || []
  const ex = data?.recent_expenses?.slice(0, 5) || []
  if (!ev.length && !ex.length) return null
  return (
    <div className="mt-2 rounded-[10px] bg-[var(--card-inset)] p-3">
      <div className="mb-1.5 text-[11px] font-semibold text-[var(--muted)]">Recent entries — tap 🗑 to undo a mistake</div>
      <div className="space-y-1">
        {ev.map(e => (
          <div key={`ev${e.id}`} className="flex items-center justify-between gap-2 text-[11px] text-[#cbd5e1]">
            <span className="truncate">{e.date} · <b>{e.event_type}</b> ×{e.count}</span>
            <button onClick={() => del.mutate({ kind: 'event', id: e.id })} className="shrink-0 text-[var(--muted-2)] hover:text-[#f87171]"><Trash2 size={13} /></button>
          </div>
        ))}
        {ex.map(x => (
          <div key={`ex${x.id}`} className="flex items-center justify-between gap-2 text-[11px] text-[#cbd5e1]">
            <span className="truncate">{x.spent_on} · <b>{x.category}</b> {ugx(x.amount_ugx)}</span>
            <button onClick={() => del.mutate({ kind: 'expense', id: x.id })} className="shrink-0 text-[var(--muted-2)] hover:text-[#f87171]"><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
      {del.isError && <div className="mt-1 text-[11px] text-[#f87171]">{(del.error as Error).message}</div>}
    </div>
  )
}

export function SheepTracker() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const canWrite = user?.role === 'admin' || user?.name === 'Solomon'
  if (!canWrite) return null
  const onChanged = () => qc.invalidateQueries({ queryKey: ['detail', 'sheep'] })
  return (
    <div className="mt-2">
      <EventForm onSaved={onChanged} />
      <ExpenseForm onSaved={onChanged} />
      <RecentEntries onChanged={onChanged} />
    </div>
  )
}
