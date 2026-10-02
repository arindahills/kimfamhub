// LedgerPage — the project ledger that replaces Solomon's AppSheet (ADR-032).
// APIs: GET /api/ledger/{pid}, /entries, /reconciliation · POST /api/ledger/{pid}/{expense|sale|loss|stock}
//       POST .../{kind}/{id}/receipt · DELETE .../{kind}/{id} · POST .../notes, /reimbursements (admin)
// Everyone logged in can read (incl. the reconciliation); recorders (Solomon + admins) can record.
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'

const PID = 'chicken'
const api = (p: string) => `/api/ledger/${PID}${p}`
const ugx = (n: number | null | undefined) => (n == null ? '-' : Number(n).toLocaleString('en-US'))
const today = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10)
const card = 'rounded-[12px] border border-[var(--border)] bg-[var(--card)] p-4'
const input = 'w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none'
const who = (n?: string | null) => (n === 'Israel' ? 'Dad (Israel)' : n === 'Merab' ? 'Mum (Merab)' : n ?? '')
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.')
const btn = 'h-11 rounded-[10px] bg-[#166534] px-5 text-sm font-semibold text-white disabled:opacity-40'

type Kind = 'expense' | 'sale' | 'stock' | 'loss'
interface Product { product_id: string; name: string; cost_price: number; sell_price: number; qty_available: number }
interface Row {
  id: number; item?: string; product_id?: string; qty?: number; total?: number; total_cost?: number
  expense_date?: string; sale_date?: string; loss_date?: string; event_date?: string
  created_by: string; source: string; paid_by?: string | null; receipt_url?: string | null
}
interface Note { body: string; author: string; at: string; explained: boolean }
interface Item { key: string; title: string; amount: number; detail: string; explained: boolean; notes: Note[] }
interface Recon {
  farm_box: { in: { capital: number; sales: number; total: number }; out: { opex: number; capex: number; total: number }; gap: number }
  paid_by: { who: string; count: number; total: number }[]
  treasury: { id: number; date: string; description: string; amount: number; kind: string }[]
  open_items: Item[]; open_count: number
}
interface Kpi { key: string; label: string; plan: number; plan_as_written: number; actual: number; pct: number | null; status: 'green' | 'amber' | 'red' }
interface MonthRow {
  n: number; month: string; past: boolean
  plan: { eggs: number; revenue: number; cos: number; other: number; profit: number }
  plan_as_written: { revenue: number }
  actual: { eggs_sold: number; revenue: number; cos: number; other: number; profit: number; capex: number } | null
}
interface Scorecard {
  as_of: string; month_now: number; months_total: number
  execution: { birds_planned_by_now: number; birds_bought: number; pct: number }
  score: { total: number; rating: string; meaning: string; parts: { key: string; weight: number; pct: number }[] }
  kpis: Kpi[]
  yield: { actual_rate: number | null; plan_rate: number }
  flock: { bought: number; died: number; survival_pct: number | null }
  months: MonthRow[]
  phases: { n: number; name: string; birds: number; start: string | null; first_eggs: string | null; status: string }[]
  capital: { sections: { name: string; total: number; items: { label: string; amount: number }[] }[]; plan_total: number; capex_to_date: number; note: string }
  recoupment: { investment: number; share: number; plan_payback_month: string | null; actual_return_to_date: number }
  findings: { severity: string; text: string }[]
  source: { title: string; url: string; version: number; imported_at: string }
}
interface Batch { id: number | null; date: string; product: string; qty: number; cost: number; held: string; held_days: number; age_at_purchase_weeks: number | null; age_now_weeks: number | null; supplier: string }
interface Summary {
  batches: Batch[]
  statement: Record<string, number>; products: Product[]; recent: Record<string, Row[]>
  options: { paid_by: string[]; loss_kinds: string[] }; can_write: boolean; is_admin: boolean; reads_ledger: boolean
}

async function call<T = any>(url: string, method = 'GET', body?: unknown): Promise<T> {  // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(url, {
    method, credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : 'Something went wrong. Try again.')
  return j
}

function Stat({ l, v, tone, onClick }: { l: string; v: number; tone?: 'good' | 'bad'; onClick?: () => void }) {
  const color = tone === 'good' ? '#4ade80' : tone === 'bad' ? '#f87171' : 'var(--foreground)'
  const body = (
    <>
      <div className="text-sm font-bold tabular-nums" style={{ color }}>{ugx(v)}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--muted-2)]">{l}</div>
      {onClick && <div className="mt-1 text-[10px] text-[#60a5fa]">tap for details ›</div>}
    </>
  )
  return onClick
    ? <button onClick={onClick} className="rounded-[10px] bg-[var(--card-inset)] p-3 text-center transition-transform active:scale-[0.98]">{body}</button>
    : <div className="rounded-[10px] bg-[var(--card-inset)] p-3 text-center">{body}</div>
}

interface DrillRow { key: string; label: string; count: number; amount: number; share: number; note?: string }
interface DrillLine { date: string; title: string; detail: string; amount: number; balance?: number; unit?: string; id?: number | null; receipt_url?: string | null }
interface Drill {
  card: string; label: string; total: number; level: 'group' | 'year' | 'month' | 'lines' | 'movements'
  crumbs: { label: string; params: { group?: string; year?: number; month?: number } }[]
  rows: DrillRow[]; lines: DrillLine[]; qty_available?: number
}

function DrillView({ which, onBack }: { which: string; onBack: () => void }) {
  const [p, setP] = useState<{ group?: string; year?: number; month?: number }>({})
  const qs = new URLSearchParams()
  if (p.group) qs.set('group', p.group)
  if (p.year) qs.set('year', String(p.year))
  if (p.month) qs.set('month', String(p.month))
  const q = useQuery<Drill>({ queryKey: ['ledger-drill', which, p.group, p.year, p.month], queryFn: () => call<Drill>(api(`/drill/${which}?${qs.toString()}`)) })
  if (q.error) return <div className={card + ' text-sm'}>{(q.error as Error).message}</div>
  const d = q.data
  const open = (r: DrillRow) => {
    if (!d) return
    if (d.level === 'group') setP({ group: r.key })
    else if (d.level === 'year') setP({ group: p.group, year: Number(r.key) })
    else if (d.level === 'month') setP({ group: p.group, year: p.year, month: Number(r.key) })
  }
  const tappable = d && (d.level === 'group' || d.level === 'year' || d.level === 'month')
  const isQty = d?.level === 'movements'
  return (
    <div className="space-y-3">
      <button onClick={() => (d && d.crumbs.length > 1 ? setP(d.crumbs[d.crumbs.length - 2].params) : onBack())} className="text-sm font-semibold text-[#60a5fa]">‹ Back</button>
      {d && (
        <>
          <div className="flex flex-wrap items-center gap-1 text-xs text-[var(--muted-2)]">
            <button onClick={onBack} className="underline">Summary</button>
            {d.crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">›
                {i < d.crumbs.length - 1 ? <button onClick={() => setP(c.params)} className="underline">{c.label}</button> : <span className="font-semibold text-[var(--foreground)]">{c.label}</span>}
              </span>
            ))}
          </div>
          <div className={card}>
            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-2)]">{d.crumbs[d.crumbs.length - 1].label}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{isQty ? ugx(d.total) + ' UGX' : ugx(d.total)}</div>
            {isQty && <div className="mt-0.5 text-xs text-[var(--muted-2)]">{d.qty_available} in stock now</div>}
          </div>
          {tappable && (
            <div className="divide-y divide-[var(--border)] rounded-[12px] border border-[var(--border)] bg-[var(--card)]">
              {d.rows.map(r => (
                <button key={r.key} onClick={() => open(r)} className="block w-full px-4 py-3 text-left">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">{r.label} <span className="text-xs font-normal text-[var(--muted-2)]">{r.note ?? `${r.count} ${r.count === 1 ? 'entry' : 'entries'}`}</span></span>
                    <span className="tabular-nums">{ugx(r.amount)} <span className="text-[#60a5fa]">›</span></span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--card-inset)]"><div className="h-full rounded-full bg-[#22c55e]" style={{ width: Math.max(2, r.share) + '%' }} /></div>
                  <div className="mt-0.5 text-right text-[10px] text-[var(--muted-2)]">{r.share}%</div>
                </button>
              ))}
              {d.rows.length === 0 && <div className="p-4 text-sm text-[var(--muted-2)]">Nothing here.</div>}
            </div>
          )}
          {!tappable && (
            <div className="divide-y divide-[var(--border)] rounded-[12px] border border-[var(--border)] bg-[var(--card)]">
              {d.lines.map((l, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{l.title}</div>
                    <div className="text-xs text-[var(--muted-2)]">{l.date}{l.detail ? ' · ' + l.detail : ''}{l.receipt_url && <> · <a className="underline" href={l.receipt_url} target="_blank" rel="noreferrer">receipt</a></>}</div>
                  </div>
                  <div className="text-right tabular-nums">
                    <div style={{ color: isQty ? (l.amount < 0 ? '#f87171' : '#4ade80') : undefined }}>{isQty ? (l.amount > 0 ? '+' : '') + l.amount : ugx(l.amount)}</div>
                    {l.balance != null && <div className="text-[10px] text-[var(--muted-2)]">balance {l.balance}</div>}
                  </div>
                </div>
              ))}
              {d.lines.length === 0 && <div className="p-4 text-sm text-[var(--muted-2)]">Nothing here.</div>}
            </div>
          )}
        </>
      )}
      {!d && <div className="p-4 text-sm text-[var(--muted-2)]">Loading…</div>}
    </div>
  )
}

function SummaryTab({ s }: { s: Summary }) {
  const st = s.statement
  const [open, setCard] = useState<string | null>(null)
  if (open) return <DrillView which={open} onBack={() => setCard(null)} />
  return (
    <div className="space-y-3">
      <div className={card}>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)]">Profit and loss (UGX)</div>
        <div className="grid grid-cols-2 gap-2">
          <Stat l="Total sales" v={st.sales} onClick={() => setCard('sales')} /><Stat l="Spoilt / lost" v={st.spoilt} onClick={() => setCard('spoilt')} />
          <Stat l="Running costs (OPEX)" v={st.opex} onClick={() => setCard('opex')} /><Stat l="Equipment (CapEx)" v={st.capex} onClick={() => setCard('capex')} />
          <Stat l="Stock at cost" v={st.available_stock_cost} onClick={() => setCard('stock')} /><Stat l="Expected sales" v={st.expected_sales} onClick={() => setCard('expected')} />
        </div>
        <div className="mt-3 space-y-1 border-t border-[var(--border)] pt-3 text-xs">
          {([['Gross position', st.gross], ['Net (with CapEx)', st.net_with_capex], ['Net (with depreciation)', st.net_with_depreciation]] as const).map(([l, v]) => (
            <div key={l} className="flex justify-between"><span className="text-[var(--muted-2)]">{l}</span>
              <span className="font-semibold tabular-nums" style={{ color: v >= 0 ? '#4ade80' : '#f87171' }}>{ugx(v)}</span></div>
          ))}
        </div>
      </div>
      {s.batches.length > 0 && (
        <div className={card}>
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)]">Flock by batch</div>
          <p className="mb-2 text-xs text-[var(--muted-2)]">Every bird purchase and how long it has been held. Add the age when bought on a purchase to see true age.</p>
          <div className="divide-y divide-[var(--border)]">
            {s.batches.map((b, i) => (
              <div key={b.id ?? i} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{b.qty} {b.product.toLowerCase()}</div>
                  <div className="text-xs text-[var(--muted-2)]">bought {b.date}{b.supplier ? ' · ' + b.supplier : ''}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{b.held}</div>
                  <div className="text-xs text-[var(--muted-2)]">{b.age_now_weeks != null ? 'about ' + b.age_now_weeks + ' weeks old' : 'age when bought not recorded'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className={card}>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)]">In stock now</div>
        {s.products.map(p => (
          <div key={p.product_id} className="flex justify-between py-1 text-sm">
            <span className="capitalize">{p.name}</span><span className="tabular-nums">{p.qty_available}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function L({ t, children }: { t: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs text-[var(--muted-2)]">{t}</span>{children}</label>
}

function RecordTab({ s, onSaved }: { s: Summary; onSaved: () => void }) {
  const [kind, setKind] = useState<Kind>('expense')
  const [f, setF] = useState<Record<string, string>>({ date: today(), kind: 'opex' })
  const [birds, setBirds] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: string) => setF(o => ({ ...o, [k]: v }))
  const reset = (k: Kind) => { setKind(k); setF({ date: today(), kind: 'opex' }); setBirds(false); setFile(null); setMsg(null) }
  const money = (k: string) => (
    <input className={input} inputMode="numeric" value={f[k] ? Number(f[k]).toLocaleString('en-US') : ''}
      onChange={e => set(k, e.target.value.replace(/[^0-9]/g, ''))} />
  )
  const product = (
    <select className={input} value={f.product_id || ''} onChange={e => set('product_id', e.target.value)}>
      <option value="">Choose…</option>
      {s.products.map(p => <option key={p.product_id} value={p.product_id}>{p.name} ({p.qty_available} in stock)</option>)}
    </select>
  )
  const submit = async () => {
    setBusy(true); setMsg(null)
    try {
      const body: Record<string, unknown> = { ...f }
      if (kind === 'expense' && !birds) delete body.product_id
      const res = await call(api('/' + kind), 'POST', body)
      if (file && res.id && kind !== 'loss') {
        const fd = new FormData(); fd.append('file', file)
        const up = await fetch(api(`/${kind}/${res.id}/receipt`), { method: 'POST', credentials: 'include', body: fd })
        if (!up.ok) throw new Error('Saved, but the receipt photo did not upload. Open Entries and add it again.')
      }
      setMsg({ ok: true, text: 'Saved.' + (res.warning ? ' ' + res.warning : '') })
      setF({ date: f.date, kind: 'opex' }); setFile(null); setBirds(false); onSaved()
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }) }
    setBusy(false)
  }
  const chips: [Kind, string][] = [['expense', 'Money spent'], ['sale', 'Sale'], ['stock', 'Eggs / stock'], ['loss', 'Loss']]
  return (
    <div className={card + ' space-y-3'}>
      <div className="flex flex-wrap gap-2">
        {chips.map(([k, l]) => (
          <button key={k} onClick={() => reset(k)} className="rounded-full border px-3 py-1.5 text-xs font-semibold"
            style={{ borderColor: kind === k ? '#22c55e' : 'var(--border)', color: kind === k ? '#4ade80' : 'var(--muted-2)' }}>{l}</button>
        ))}
      </div>
      <L t="Date"><input type="date" className={input} max={today()} value={f.date || ''} onChange={e => set('date', e.target.value)} style={{ colorScheme: 'dark' }} /></L>

      {kind === 'expense' && <>
        <L t="What was bought?"><input className={input} value={f.item || ''} onChange={e => set('item', e.target.value)} placeholder="e.g. Layer mash" /></L>
        <div className="grid grid-cols-2 gap-2">
          <L t="Quantity"><input className={input} inputMode="numeric" value={f.qty || ''} onChange={e => set('qty', e.target.value.replace(/[^0-9]/g, ''))} /></L>
          <L t="Total (UGX)">{money('total')}</L>
        </div>
        <L t="Type">
          <select className={input} value={f.kind} onChange={e => set('kind', e.target.value)}>
            <option value="opex">Running cost (feed, medicine, transport, labour)</option>
            <option value="capex">Equipment or building (lasts years)</option>
          </select>
        </L>
        <L t="Who paid?">
          <select className={input} value={f.paid_by || ''} onChange={e => set('paid_by', e.target.value)}>
            <option value="">Choose…</option>
            {s.options.paid_by.map(p => <option key={p} value={p}>{who(p)}</option>)}
          </select>
        </L>
        <L t="Bought from (optional)"><input className={input} value={f.supplier || ''} onChange={e => set('supplier', e.target.value)} /></L>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={birds} onChange={e => setBirds(e.target.checked)} /> These are birds (adds them to the flock)</label>
        {birds && <div className="grid grid-cols-2 gap-2">
          <L t="Which birds">{product}</L>
          <L t="How many birds"><input className={input} inputMode="numeric" value={f.stock_qty || ''} onChange={e => set('stock_qty', e.target.value.replace(/[^0-9]/g, ''))} /></L>
          <L t="Age when bought, in weeks (optional)"><input className={input} inputMode="numeric" value={f.age_weeks || ''} onChange={e => set('age_weeks', e.target.value.replace(/[^0-9]/g, ''))} placeholder="e.g. 16" /></L>
        </div>}
        <L t="Note (optional)"><input className={input} value={f.note || ''} onChange={e => set('note', e.target.value)} /></L>
      </>}

      {kind === 'sale' && <>
        <L t="What was sold?">{product}</L>
        <div className="grid grid-cols-2 gap-2">
          <L t="Quantity"><input className={input} inputMode="numeric" value={f.qty || ''} onChange={e => set('qty', e.target.value.replace(/[^0-9]/g, ''))} /></L>
          <L t="Price each (UGX)">{money('unit_price')}</L>
        </div>
        <L t="Buyer (optional)"><input className={input} value={f.buyer || ''} onChange={e => set('buyer', e.target.value)} /></L>
      </>}

      {kind === 'stock' && <>
        <L t="Product">{product}</L>
        <L t="Quantity added (e.g. eggs laid this week)"><input className={input} inputMode="numeric" value={f.qty || ''} onChange={e => set('qty', e.target.value.replace(/[^0-9]/g, ''))} /></L>
      </>}

      {kind === 'loss' && <>
        <L t="What was lost?">{product}</L>
        <div className="grid grid-cols-2 gap-2">
          <L t="Quantity"><input className={input} inputMode="numeric" value={f.qty || ''} onChange={e => set('qty', e.target.value.replace(/[^0-9]/g, ''))} /></L>
          <L t="What happened">
            <select className={input} value={f.kind === 'opex' ? '' : f.kind} onChange={e => set('kind', e.target.value)}>
              <option value="">Choose…</option>
              {s.options.loss_kinds.map(k => <option key={k} value={k}>{k === 'Damaged' ? 'Died / broken' : 'Used (eaten)'}</option>)}
            </select>
          </L>
        </div>
        <L t="Reason"><input className={input} value={f.reason || ''} onChange={e => set('reason', e.target.value)} placeholder="e.g. Killed by predator" /></L>
      </>}

      {kind !== 'loss' && kind !== 'stock' && (
        <L t="Receipt photo (optional, recommended)">
          <input type="file" accept="image/*,application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
        </L>
      )}
      {msg && <div className="rounded-lg p-2.5 text-sm" style={{ background: msg.ok ? '#052e16' : '#450a0a', color: msg.ok ? '#86efac' : '#fca5a5' }}>{msg.text}</div>}
      <button className={btn} disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  )
}

const KINDS: [Kind, string][] = [['expense', 'Spending'], ['sale', 'Sales'], ['stock', 'Stock'], ['loss', 'Losses']]

function EntriesTab({ s, onChanged }: { s: Summary; onChanged: () => void }) {
  const [kind, setKind] = useState<Kind>('expense')
  const q = useQuery({ queryKey: ['ledger-entries', kind, s.statement.sales], queryFn: () => call<{ rows: Row[] }>(api('/entries?kind=' + kind)) })
  const [err, setErr] = useState('')
  const dateOf = (r: Row) => r.expense_date || r.sale_date || r.loss_date || r.event_date
  const label = (r: Row) => kind === 'expense' ? r.item : (s.products.find(p => p.product_id === r.product_id)?.name ?? r.product_id)
  const amt = (r: Row) => (kind === 'stock' ? r.total_cost : r.total)
  const remove = async (r: Row) => {
    if (!window.confirm(`Remove this entry (${label(r)}, ${ugx(amt(r))})?`)) return
    try { await call(api(`/${kind}/${r.id}`), 'DELETE'); setErr(''); q.refetch(); onChanged() } catch (e) { setErr(errMsg(e)) }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {KINDS.map(([k, l]) => (
          <button key={k} onClick={() => setKind(k)} className="rounded-full border px-3 py-1.5 text-xs font-semibold"
            style={{ borderColor: kind === k ? '#22c55e' : 'var(--border)', color: kind === k ? '#4ade80' : 'var(--muted-2)' }}>{l}</button>
        ))}
      </div>
      {err && <div className="rounded-lg bg-[#450a0a] p-2.5 text-sm text-[#fca5a5]">{err}</div>}
      <div className={card + ' divide-y divide-[var(--border)] !p-0'}>
        {(q.data?.rows ?? []).map((r: Row) => (
          <div key={r.id} className="flex items-start gap-3 px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium capitalize">{label(r)} {r.qty ? <span className="text-[var(--muted-2)]">× {r.qty}</span> : null}</div>
              <div className="text-xs text-[var(--muted-2)]">
                {dateOf(r)} · {r.created_by}{r.source === 'appsheet_import' ? ' (from AppSheet)' : ''}{r.paid_by ? ' · paid by ' + who(r.paid_by) : ''}
                {r.receipt_url && <> · <a className="underline" href={r.receipt_url} target="_blank" rel="noreferrer">receipt</a></>}
              </div>
            </div>
            <div className="text-right tabular-nums">{ugx(amt(r))}</div>
            {s.can_write && <button onClick={() => remove(r)} aria-label="Remove" className="text-[var(--muted-2)]">✕</button>}
          </div>
        ))}
        {q.data && q.data.rows.length === 0 && <div className="p-4 text-sm text-[var(--muted-2)]">Nothing here yet.</div>}
      </div>
    </div>
  )
}

const DOT = { green: '#4ade80', amber: '#fbbf24', red: '#f87171' } as const
const PART_LABEL: Record<string, string> = { revenue: 'Revenue', profit: 'Profit', costs: 'Cost control', yield: 'Egg yield', survival: 'Flock survival' }

function ScorecardTab() {
  const q = useQuery<Scorecard>({ queryKey: ['ledger-score'], queryFn: () => call<Scorecard>(api('/scorecard')), retry: false })
  const [written, setWritten] = useState(false)
  if (q.error) return <div className={card + ' text-sm text-[var(--muted-2)]'}>{(q.error as Error).message}</div>
  if (!q.data) return <div className="p-4 text-sm text-[var(--muted-2)]">Scoring against the proposal…</div>
  const c = q.data
  const tone = c.score.total >= 80 ? '#4ade80' : c.score.total >= 60 ? '#fbbf24' : '#f87171'
  const exTone = c.execution.pct >= 80 ? '#4ade80' : c.execution.pct >= 60 ? '#fbbf24' : '#f87171'
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className={card + ' text-center'}>
          <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-2)]">Execution</div>
          <div className="mt-1 text-3xl font-bold tabular-nums" style={{ color: exTone }}>{c.execution.pct}%</div>
          <div className="mt-1 text-xs text-[var(--muted-2)]">{c.execution.birds_bought} birds bought of {c.execution.birds_planned_by_now} planned by {c.as_of}</div>
        </div>
        <div className={card + ' text-center'}>
          <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-2)]">Performance</div>
          <div className="mt-1 text-3xl font-bold tabular-nums" style={{ color: tone }}>{c.score.total}<span className="text-base text-[var(--muted-2)]">/100</span></div>
          <div className="mt-1 text-xs font-semibold" style={{ color: tone }}>{c.score.rating}</div>
        </div>
      </div>
      <p className="px-1 text-xs text-[var(--muted-2)]">Execution asks whether the plan's phases happened. Performance asks how the phases that did happen are doing against the plan for those phases.</p>

      {c.findings.length > 0 && (
        <div className={card + ' space-y-2'}>
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)]">What stands out</div>
          {c.findings.map((f, i) => (
            <div key={i} className="flex gap-2 text-sm"><span style={{ color: f.severity === 'high' ? '#f87171' : '#fbbf24' }}>●</span><span>{f.text}</span></div>
          ))}
        </div>
      )}

      <div className={card}>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)]">Plan against actual, to {c.as_of} (UGX)</div>
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--muted-2)]"><input type="checkbox" checked={written} onChange={e => setWritten(e.target.checked)} /> plan as written</label>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {c.kpis.map(k => {
            const plan = written ? k.plan_as_written : k.plan
            return (
              <div key={k.key} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: DOT[k.status] }} />
                <div className="min-w-0 flex-1">
                  <div>{k.label}</div>
                  <div className="text-xs text-[var(--muted-2)]">plan {ugx(plan)}{!written && plan !== k.plan_as_written ? ` (as written ${ugx(k.plan_as_written)})` : ''}</div>
                </div>
                <div className="text-right"><div className="font-semibold tabular-nums">{ugx(k.actual)}</div>
                  <div className="text-xs tabular-nums text-[var(--muted-2)]">{plan ? Math.round((100 * k.actual) / plan) + '%' : ''}</div></div>
              </div>
            )
          })}
        </div>
        <div className="mt-3 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted-2)]">
          Laying rate {c.yield.actual_rate != null ? Math.round(c.yield.actual_rate * 100) : '-'}% against {Math.round(c.yield.plan_rate * 100)}% planned · {c.flock.died} of {c.flock.bought} birds lost ({c.flock.survival_pct ?? '-'}% survived)
        </div>
      </div>

      <div className={card}>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)]">How the score is made</div>
        {c.score.parts.map(p => (
          <div key={p.key} className="flex items-center gap-2 py-1 text-xs">
            <span className="w-28 shrink-0">{PART_LABEL[p.key] ?? p.key} <span className="text-[var(--muted-2)]">({p.weight})</span></span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--card-inset)]"><div className="h-full rounded-full" style={{ width: p.pct + '%', background: p.pct >= 80 ? '#4ade80' : p.pct >= 50 ? '#fbbf24' : '#f87171' }} /></div>
            <span className="w-9 text-right tabular-nums">{p.pct}%</span>
          </div>
        ))}
      </div>

      <div className={card}>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)]">Phases in the proposal</div>
        {c.phases.map(p => (
          <div key={p.n} className="flex items-center justify-between py-1.5 text-sm">
            <span>{p.name}<span className="block text-xs text-[var(--muted-2)]">birds {p.start ?? '-'} · eggs from {p.first_eggs ?? '-'}</span></span>
            <span className="rounded-full border px-2.5 py-0.5 text-[11px] font-semibold" style={{ borderColor: p.status === 'bought' ? '#22c55e' : p.status === 'overdue' ? '#f87171' : 'var(--border)', color: p.status === 'bought' ? '#4ade80' : p.status === 'overdue' ? '#f87171' : 'var(--muted-2)' }}>{p.status}</span>
          </div>
        ))}
      </div>

      <div className={card}>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)]">Month by month (revenue, UGX)</div>
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-xs tabular-nums">
            <thead><tr className="text-left text-[var(--muted-2)]"><th className="py-1">Month</th><th className="text-right">Plan</th><th className="text-right">Actual</th><th className="text-right">Profit</th></tr></thead>
            <tbody>
              {c.months.map(m => (
                <tr key={m.n} className="border-t border-[var(--border)]" style={{ opacity: m.past ? 1 : 0.55 }}>
                  <td className="py-1.5">{m.month}</td>
                  <td className="text-right">{ugx(written ? m.plan_as_written.revenue : m.plan.revenue)}</td>
                  <td className="text-right">{m.actual ? ugx(m.actual.revenue) : '-'}</td>
                  <td className="text-right" style={{ color: m.actual ? (m.actual.profit >= 0 ? '#4ade80' : '#f87171') : undefined }}>{m.actual ? ugx(m.actual.profit) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={card}>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)]">Capital plan</div>
        <div className="mb-2 text-sm">Proposal total {ugx(c.capital.plan_total)} · equipment recorded so far {ugx(c.capital.capex_to_date)}</div>
        {c.capital.sections.map(sec => (
          <details key={sec.name} className="border-t border-[var(--border)] py-1.5 text-sm">
            <summary className="flex cursor-pointer justify-between"><span>{sec.name}</span><span className="tabular-nums">{ugx(sec.total)}</span></summary>
            <div className="mt-1 space-y-0.5 pl-2 text-xs text-[var(--muted-2)]">
              {sec.items.map((i, k) => <div key={k} className="flex justify-between gap-3"><span>{i.label}</span><span className="tabular-nums">{ugx(i.amount)}</span></div>)}
            </div>
          </details>
        ))}
        {c.capital.note && <p className="mt-2 text-xs text-[#fbbf24]">{c.capital.note}</p>}
        <div className="mt-3 border-t border-[var(--border)] pt-2 text-xs text-[var(--muted-2)]">
          Payback: the proposal returns {Math.round(c.recoupment.share * 100)}% of profit to the club and investor; on its own plan the investment is recovered by {c.recoupment.plan_payback_month ?? 'beyond the plan'}. Returned so far: {ugx(c.recoupment.actual_return_to_date)}.
        </div>
      </div>
      <p className="px-1 text-[11px] text-[var(--muted-2)]">Source: <a className="underline" href={c.source.url} target="_blank" rel="noreferrer">{c.source.title}</a> (v{c.source.version}).</p>
    </div>
  )
}

function ReconTab({ s }: { s: Summary }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['ledger-recon'], queryFn: () => call<Recon>(api('/reconciliation')) })
  const [open, setOpen] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [explained, setExplained] = useState(false)
  const [err, setErr] = useState('')
  const [linking, setLinking] = useState<number | null>(null)
  const [pick, setPick] = useState<Record<number, boolean>>({})
  const ex = useQuery({ queryKey: ['ledger-exp-for-link'], queryFn: () => call<{ rows: Row[] }>(api('/entries?kind=expense&limit=400')), enabled: linking != null })
  if (!q.data) return <div className="p-4 text-sm text-[var(--muted-2)]">Loading…</div>
  const r = q.data
  const save = async (key: string) => {
    try { await call(api('/notes'), 'POST', { item_key: key, body: text, explained }); setText(''); setOpen(null); setExplained(false); setErr(''); qc.invalidateQueries({ queryKey: ['ledger-recon'] }) }
    catch (e) { setErr(errMsg(e)) }
  }
  const link = async (eid: number) => {
    const rows = (ex.data?.rows ?? []).filter((x: Row) => pick[x.id]).map((x: Row) => ({ kind: 'expense', row_id: x.id, amount: x.total }))
    try { await call(api('/reimbursements'), 'POST', { expenditure_id: eid, rows }); setLinking(null); setPick({}); setErr(''); qc.invalidateQueries({ queryKey: ['ledger-recon'] }) }
    catch (e) { setErr(errMsg(e)) }
  }
  const fb = r.farm_box
  return (
    <div className="space-y-3">
      <div className={card}>
        <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)]">Farm cash box (UGX)</div>
        <div className="grid grid-cols-2 gap-2">
          <Stat l="Capital from the club" v={fb.in.capital} /><Stat l="Sales" v={fb.in.sales} />
          <Stat l="Running costs" v={fb.out.opex} /><Stat l="Equipment" v={fb.out.capex} />
          <Stat l="Total in" v={fb.in.total} tone="good" /><Stat l="Total out" v={fb.out.total} tone="bad" />
        </div>
        <div className="mt-2 flex justify-between border-t border-[var(--border)] pt-2 text-sm">
          <span>{fb.gap > 0 ? 'Spent beyond money in' : 'Money in beyond spending'}</span>
          <b className="tabular-nums" style={{ color: fb.gap > 0 ? '#f87171' : '#4ade80' }}>{ugx(Math.abs(fb.gap))}</b>
        </div>
        <p className="mt-2 text-xs text-[var(--muted-2)]">The club treasury is a separate account: capital and the club's own payments are listed below, never mixed into the farm's spending.</p>
      </div>

      <div className={card}>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)]">Who paid for the farm's spending</div>
        {r.paid_by.map((b: Recon['paid_by'][number]) => (
          <div key={b.who} className="flex justify-between py-1 text-sm"><span>{who(b.who)} <span className="text-xs text-[var(--muted-2)]">({b.count} {b.count === 1 ? 'line' : 'lines'})</span></span><span className="tabular-nums">{ugx(b.total)}</span></div>
        ))}
      </div>

      <div className={card}>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)]">Club treasury payments for chicken</div>
        {r.treasury.map((t: Recon['treasury'][number]) => (
          <div key={t.id} className="flex justify-between gap-3 py-1 text-sm">
            <span><span className="text-xs uppercase text-[var(--muted-2)]">{t.kind}</span> {t.date} · {t.description}</span>
            <span className="tabular-nums">{ugx(t.amount)}</span>
          </div>
        ))}
      </div>

      <div className="text-xs font-bold uppercase tracking-wide text-[var(--muted-2)]">{r.open_count} open item{r.open_count === 1 ? '' : 's'} to explain</div>
      {err && <div className="rounded-lg bg-[#450a0a] p-2.5 text-sm text-[#fca5a5]">{err}</div>}
      {r.open_items.map((i: Item) => (
        <div key={i.key} className={card}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{i.title}</div>
              <div className="mt-0.5 text-xs text-[var(--muted-2)]">{i.detail}</div>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold tabular-nums">{ugx(i.amount)}</div>
              <div className="text-[10px] font-bold uppercase" style={{ color: i.explained ? '#4ade80' : '#fbbf24' }}>{i.explained ? 'explained' : 'open'}</div>
            </div>
          </div>
          {i.notes.map((n: Note, k: number) => (
            <div key={k} className="mt-2 rounded-lg bg-[var(--card-inset)] p-2.5 text-xs">
              <div>{n.body}</div><div className="mt-1 text-[var(--muted-2)]">{n.author} · {String(n.at).slice(0, 10)}{n.explained ? ' · marked explained' : ''}</div>
            </div>
          ))}
          {s.is_admin && (open === i.key ? (
            <div className="mt-2 space-y-2">
              <textarea className={input} rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="What explains this?" />
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={explained} onChange={e => setExplained(e.target.checked)} /> This explains it (close the item)</label>
              <div className="flex gap-2"><button className={btn + ' !h-9 !px-4'} onClick={() => save(i.key)}>Save note</button>
                <button className="text-xs text-[var(--muted-2)]" onClick={() => setOpen(null)}>Cancel</button></div>
            </div>
          ) : (
            <div className="mt-2 flex gap-4 text-xs">
              <button className="font-semibold text-[#60a5fa]" onClick={() => { setOpen(i.key); setText('') }}>Add a note</button>
              {i.key.startsWith('treasury:') && <button className="font-semibold text-[#60a5fa]" onClick={() => setLinking(Number(i.key.split(':')[1]))}>Link expense lines</button>}
            </div>
          ))}
          {linking != null && i.key === 'treasury:' + linking && (
            <div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-[var(--border)] p-2 text-xs">
              {(ex.data?.rows ?? []).filter((x: Row) => x.source !== 'appsheet_import').map((x: Row) => (
                <label key={x.id} className="flex items-center gap-2"><input type="checkbox" checked={!!pick[x.id]} onChange={e => setPick(o => ({ ...o, [x.id]: e.target.checked }))} />
                  {x.expense_date} · {x.item} · {ugx(x.total)} · {who(x.paid_by)}</label>
              ))}
              {(ex.data?.rows ?? []).filter((x: Row) => x.source !== 'appsheet_import').length === 0 && <div className="text-[var(--muted-2)]">No expense lines recorded in the Hub yet.</div>}
              <div className="flex gap-2 pt-1"><button className={btn + ' !h-9 !px-4'} onClick={() => link(linking)}>Link selected</button>
                <button className="text-[var(--muted-2)]" onClick={() => setLinking(null)}>Cancel</button></div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function LedgerPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState<'summary' | 'score' | 'record' | 'entries' | 'recon'>('summary')
  const q = useQuery<Summary>({ queryKey: ['ledger'], queryFn: () => call<Summary>(api('')), enabled: !!user })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['ledger'] }); qc.invalidateQueries({ queryKey: ['ledger-recon'] }); qc.invalidateQueries({ queryKey: ['ledger-entries'] }) }
  if (q.error) return <div className="p-6 text-sm text-[#fca5a5]">{(q.error as Error).message}</div>
  if (!q.data) return <div className="p-6 text-sm text-[var(--muted-2)]">Loading the chicken ledger…</div>
  const s = q.data
  const tabs: ['summary' | 'score' | 'record' | 'entries' | 'recon', string][] = [['summary', 'Summary'], ['score', 'Scorecard'], ...(s.can_write ? [['record', 'Record'] as ['record', string]] : []), ['entries', 'Entries'], ['recon', 'Reconciliation']]
  return (
    <div className="mx-auto max-w-2xl space-y-3 px-4 pb-24 pt-4">
      <div>
        <h1 className="text-lg font-bold">🐔 Chicken ledger</h1>
        <p className="text-xs text-[var(--muted-2)]">Every shilling in and out of the farm, who recorded it and who paid. This replaces the AppSheet.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className="shrink-0 rounded-full border px-4 py-2 text-xs font-semibold"
            style={{ borderColor: tab === k ? '#22c55e' : 'var(--border)', color: tab === k ? '#4ade80' : 'var(--muted-2)' }}>{l}</button>
        ))}
      </div>
      {tab === 'summary' && <SummaryTab s={s} />}
      {tab === 'score' && <ScorecardTab />}
      {tab === 'record' && s.can_write && <RecordTab s={s} onSaved={refresh} />}
      {tab === 'entries' && <EntriesTab s={s} onChanged={refresh} />}
      {tab === 'recon' && <ReconTab s={s} />}
    </div>
  )
}
