import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PlusCircle, Skull, Syringe, Check, Trash2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { ugx } from '@/lib/utils'
import { LIVESTOCK, livestockApi, ownerDisplay, type LivestockCfg, type LivestockId } from './livestockConfig'

/** In-app entry for any livestock project (sheep, goats, …; ADR-026, ADR-029). Records go
 *  straight to Postgres — never a spreadsheet. Every save and delete asks to confirm first. */

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
const typeLabel = (t: string) => (t === 'opening' ? 'opening count' : t)

function Flash({ show }: { show: boolean }) {
  if (!show) return null
  return <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-[#4ade80]"><Check size={12} /> saved</span>
}

function OwnerSelect({ cfg, value, onChange, optional }: { cfg: LivestockCfg; value: string; onChange: (v: string) => void; optional?: boolean }) {
  return (
    <select className={inputCls} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{optional ? '— not for one owner —' : '— choose owner —'}</option>
      {cfg.owners.map(o => <option key={o.name} value={o.name}>{o.display}</option>)}
    </select>
  )
}

function EventForm({ id, cfg, onSaved }: { id: LivestockId; cfg: LivestockCfg; onSaved: () => void }) {
  const owned = cfg.ownedBy === 'owners'
  const [f, setF] = useState({ event_type: owned ? 'opening' : 'death', event_date: today(), count: '1', cause: '', amount_ugx: '', counterparty: '', owner: '', note: '' })
  const [ok, setOk] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const money = f.event_type === 'sale' || f.event_type === 'purchase'
  const needsOwner = owned && f.event_type === 'opening'
  const summary = () => {
    const n = Number(f.count) || 1
    const parts = [typeLabel(f.event_type).toUpperCase(), `${n} ${n === 1 ? cfg.noun : cfg.plural}`, f.event_date]
    if (owned) parts.push(`owner: ${ownerDisplay(cfg, f.owner || null)}`)
    if (f.event_type === 'death') parts.push(`cause: ${f.cause.trim() || 'not specified'}`)
    if (money) { parts.push(`${f.amount_ugx.trim() ? Number(f.amount_ugx).toLocaleString() : '—'} UGX`); if (f.counterparty.trim()) parts.push(f.counterparty.trim()) }
    return parts.join('  ·  ')
  }
  const m = useMutation({
    mutationFn: () => send(livestockApi(id).event, 'POST', {
      event_type: f.event_type, event_date: f.event_date, count: Number(f.count) || 1,
      cause: f.cause || null,
      amount_ugx: money ? numOrNull(f.amount_ugx) : null,   // blank → null so backend 422s, not silent 0
      counterparty: f.counterparty || null, owner: f.owner || null, note: f.note || null,
    }),
    onSuccess: () => { setOk(true); setConfirming(false); setTimeout(() => setOk(false), 2500); setF(s => ({ ...s, count: '1', cause: '', amount_ugx: '', counterparty: '', note: '' })); onSaved() },
  })
  return (
    <div className="rounded-[10px] bg-[var(--card-inset)] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-white"><Skull size={13} className="text-[#f87171]" /> Record {cfg.noun} event <Flash show={ok} /></div>
      <div className="grid grid-cols-2 gap-2">
        <label><span className={labelCls}>Type</span>
          <select className={inputCls} value={f.event_type} onChange={e => setF(s => ({ ...s, event_type: e.target.value }))}>
            {cfg.eventTypes.map(t => <option key={t} value={t}>{typeLabel(t)}</option>)}
          </select></label>
        <label><span className={labelCls}>Date</span>
          <input type="date" className={inputCls} value={f.event_date} onChange={e => setF(s => ({ ...s, event_date: e.target.value }))} /></label>
        {owned && <label className="col-span-2"><span className={labelCls}>Owner{needsOwner ? '' : ' (whose ' + cfg.plural + ')'}</span>
          <OwnerSelect cfg={cfg} value={f.owner} onChange={v => setF(s => ({ ...s, owner: v }))} optional={!needsOwner} /></label>}
        <label><span className={labelCls}>{f.event_type === 'opening' ? `How many ${cfg.plural} now` : 'Count'}</span>
          <input type="number" min={1} inputMode="numeric" className={inputCls} value={f.count} onChange={e => setF(s => ({ ...s, count: e.target.value }))} /></label>
        {f.event_type === 'death' && <label><span className={labelCls}>Cause</span>
          <input className={inputCls} placeholder="unknown" value={f.cause} onChange={e => setF(s => ({ ...s, cause: e.target.value }))} /></label>}
        {money && <label><span className={labelCls}>Amount (UGX)</span>
          <input type="number" inputMode="numeric" className={inputCls} value={f.amount_ugx} onChange={e => setF(s => ({ ...s, amount_ugx: e.target.value }))} /></label>}
        {money && <label><span className={labelCls}>{f.event_type === 'purchase' ? 'Seller' : 'Buyer'}</span>
          <input className={inputCls} placeholder={f.event_type === 'purchase' ? 'seller' : 'buyer'} value={f.counterparty} onChange={e => setF(s => ({ ...s, counterparty: e.target.value }))} /></label>}
        <label className="col-span-2"><span className={labelCls}>Note</span>
          <input className={inputCls} value={f.note} onChange={e => setF(s => ({ ...s, note: e.target.value }))} /></label>
      </div>
      {owned && money && <div className="mt-1.5 text-[10px] text-[var(--muted-2)]">Sale and purchase money belongs to the owner, not the club.</div>}
      {m.isError && <div className="mt-1.5 text-[11px] text-[#f87171]">{(m.error as Error).message}</div>}
      {!confirming ? (
        <button onClick={() => setConfirming(true)} disabled={needsOwner && !f.owner}
          className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] border border-[var(--border)] bg-[var(--card)] text-[13px] font-semibold text-white disabled:opacity-40">
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

function ExpenseForm({ id, cfg, onSaved }: { id: LivestockId; cfg: LivestockCfg; onSaved: () => void }) {
  const owned = cfg.ownedBy === 'owners'
  const [f, setF] = useState({ category: 'vet', amount_ugx: '', spent_on: today(), paid_by: '', owner: '', note: '' })
  const [ok, setOk] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const summary = () => [f.category.replace('_', ' '), `${f.amount_ugx.trim() ? Number(f.amount_ugx).toLocaleString() : '—'} UGX`, f.spent_on]
    .concat(owned && f.owner ? [`for ${ownerDisplay(cfg, f.owner)}'s ${cfg.plural}`] : [])
    .concat(f.paid_by.trim() ? [`paid by ${f.paid_by.trim()}`] : []).join('  ·  ')
  const m = useMutation({
    mutationFn: () => send(livestockApi(id).expense, 'POST', {
      category: f.category, amount_ugx: numOrNull(f.amount_ugx), spent_on: f.spent_on,
      paid_by: f.paid_by || null, owner: f.owner || null, note: f.note || null,
    }),
    onSuccess: () => { setOk(true); setConfirming(false); setTimeout(() => setOk(false), 2500); setF(s => ({ ...s, amount_ugx: '', paid_by: '', note: '' })); onSaved() },
  })
  return (
    <div className="mt-2 rounded-[10px] bg-[var(--card-inset)] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-white"><Syringe size={13} className="text-[#60a5fa]" /> Record expense (vaccines = vet) <Flash show={ok} /></div>
      <div className="grid grid-cols-2 gap-2">
        <label><span className={labelCls}>Category</span>
          <select className={inputCls} value={f.category} onChange={e => setF(s => ({ ...s, category: e.target.value }))}>
            {cfg.expenseCategories.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
          </select></label>
        <label><span className={labelCls}>Amount (UGX)</span>
          <input type="number" inputMode="numeric" className={inputCls} value={f.amount_ugx} onChange={e => setF(s => ({ ...s, amount_ugx: e.target.value }))} /></label>
        <label><span className={labelCls}>Date</span>
          <input type="date" className={inputCls} value={f.spent_on} onChange={e => setF(s => ({ ...s, spent_on: e.target.value }))} /></label>
        <label><span className={labelCls}>Paid by</span>
          <input className={inputCls} value={f.paid_by} onChange={e => setF(s => ({ ...s, paid_by: e.target.value }))} /></label>
        {owned && <label className="col-span-2"><span className={labelCls}>For whose {cfg.plural}</span>
          <OwnerSelect cfg={cfg} value={f.owner} onChange={v => setF(s => ({ ...s, owner: v }))} optional /></label>}
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

interface Row { id: number; date: string; event_type?: string; count?: number; category?: string; amount_ugx?: number; owner?: string | null; created_by?: string | null }
interface Detail { recent_events?: Row[]; recent_expenses?: Row[] }

function RecentEntries({ id, cfg, onChanged }: { id: LivestockId; cfg: LivestockCfg; onChanged: () => void }) {
  const api = livestockApi(id)
  const { data } = useQuery<Detail>({ queryKey: ['detail', id], queryFn: () => send(api.detail, 'GET') })
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const del = useMutation({
    mutationFn: (v: { kind: 'event' | 'expense'; rowId: number }) => send(api.remove(v.kind, v.rowId), 'DELETE'),
    onSuccess: () => { setConfirmKey(null); onChanged() },
  })
  const ev = data?.recent_events?.slice(0, 5) || []
  const ex = data?.recent_expenses?.slice(0, 5) || []
  if (!ev.length && !ex.length) return null
  const who = (r: Row) => [cfg.ownedBy === 'owners' ? ownerDisplay(cfg, r.owner) : null, r.created_by ? `by ${r.created_by}` : null].filter(Boolean).join(' · ')
  // tap trash → asks to confirm (Yes/No); nothing is removed on a single tap, and removals are kept on record
  const controls = (key: string, kind: 'event' | 'expense', rowId: number) =>
    confirmKey === key ? (
      <span className="flex shrink-0 items-center gap-2">
        <span className="text-[10px] text-[var(--muted-2)]">remove?</span>
        <button onClick={() => del.mutate({ kind, rowId })} disabled={del.isPending} className="font-semibold text-[#f87171]">Yes</button>
        <button onClick={() => setConfirmKey(null)} className="text-[var(--muted-2)]">No</button>
      </span>
    ) : (
      <button onClick={() => setConfirmKey(key)} className="shrink-0 text-[var(--muted-2)] hover:text-[#f87171]"><Trash2 size={13} /></button>
    )
  return (
    <div className="mt-2 rounded-[10px] bg-[var(--card-inset)] p-3">
      <div className="mb-1.5 text-[11px] font-semibold text-[var(--muted)]">Recent entries — tap 🗑 to remove a mistake (asks to confirm)</div>
      <div className="space-y-1">
        {ev.map(e => (
          <div key={`ev${e.id}`} className="flex items-center justify-between gap-2 text-[11px] text-[#cbd5e1]">
            <span className="truncate">{e.date} · <b>{typeLabel(e.event_type || '')}</b> ×{e.count}{who(e) ? ` · ${who(e)}` : ''}</span>
            {controls(`ev${e.id}`, 'event', e.id)}
          </div>
        ))}
        {ex.map(x => (
          <div key={`ex${x.id}`} className="flex items-center justify-between gap-2 text-[11px] text-[#cbd5e1]">
            <span className="truncate">{x.date} · <b>{(x.category || '').replace('_', ' ')}</b> {ugx(x.amount_ugx || 0)}{who(x) ? ` · ${who(x)}` : ''}</span>
            {controls(`ex${x.id}`, 'expense', x.id)}
          </div>
        ))}
      </div>
      {del.isError && <div className="mt-1 text-[11px] text-[#f87171]">{(del.error as Error).message}</div>}
    </div>
  )
}

export function LivestockTracker({ id }: { id: LivestockId }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const cfg = LIVESTOCK[id]
  const canWrite = user?.role === 'admin' || (!!user?.name && cfg.writers.includes(user.name))
  if (!canWrite) return null
  const onChanged = () => qc.invalidateQueries({ queryKey: ['detail', id] })
  return (
    <div className="mt-2">
      <EventForm id={id} cfg={cfg} onSaved={onChanged} />
      <ExpenseForm id={id} cfg={cfg} onSaved={onChanged} />
      <RecentEntries id={id} cfg={cfg} onChanged={onChanged} />
    </div>
  )
}
