// LedgerPage — the project ledger that replaces Solomon's AppSheet (ADR-032).
// APIs: GET /api/ledger/{pid}, /entries, /reconciliation · POST /api/ledger/{pid}/{expense|sale|loss|stock}
//       POST .../{kind}/{id}/receipt · DELETE .../{kind}/{id} · POST .../notes, /reimbursements (admin)
// Everyone logged in can read (incl. the reconciliation); recorders (Solomon + admins) can record.
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'

const PID = 'chicken'
const api = (p: string) => `/api/ledger/${PID}${p}`
const ugx = (n: number | null | undefined) => (n == null ? '-' : Number(n).toLocaleString('en-US'))
const today = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10)
const card = 'rounded-[12px] border border-[var(--border)] bg-[var(--card)] p-4'
const input = 'w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none'
const nice = (n?: string | null) => (n === 'Israel' ? 'Dad (Israel)' : n === 'Merab' ? 'Mum (Merab)' : n ?? '')
const who = (n?: string | null) => (n && n.startsWith('Held cash: ') ? 'Cash held by ' + nice(n.slice(11)) : nice(n))
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.')
const btn = 'h-11 rounded-[10px] bg-[#166534] px-5 text-sm font-semibold text-white disabled:opacity-40'

type Kind = 'expense' | 'sale' | 'stock' | 'loss'
interface Product { product_id: string; name: string; cost_price: number; sell_price: number; qty_available: number }
interface Row {
  id: number; item?: string; product_id?: string; qty?: number; total?: number; total_cost?: number
  expense_date?: string; sale_date?: string; loss_date?: string; event_date?: string
  created_by: string; source: string; paid_by?: string | null; receipt_url?: string | null
  payment?: string; paid_amount?: number; due_date?: string | null; buyer?: string | null; supplier?: string | null; uom?: string | null
  gps_lat?: number | null; gps_away?: boolean; distance_m?: number | null; gps_note?: string | null
}
interface Note { body: string; author: string; at: string; explained: boolean }
interface Item { key: string; title: string; amount: number; detail: string; explained: boolean; notes: Note[] }
interface Recon {
  farm_box: { in: { capital: number; sales: number; total: number }; out: { opex: number; capex: number; total: number }; gap: number }
  paid_by: { who: string; count: number; total: number }[]
  treasury: { id: number; date: string; description: string; amount: number; kind: string }[]
  open_items: Item[]; open_count: number
  custody: { holders: { holder: string; received: number; moved_in: number; moved_out: number; spent: number; balance: number; in_transit_in: number }[]; held_outside_club: number; unassigned: number }
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
interface Item { id: number; name: string; group_name: string | null; kind: 'opex' | 'capex'; default_uom: string; is_birds: boolean }
interface Party {
  id: number; name: string; contact_name?: string | null; title?: string | null; phone?: string | null; email?: string | null
  address?: string | null; country?: string | null; website?: string | null; payment_terms?: string | null; account_number?: string | null
  category?: string | null; status?: string | null; notes?: string | null; registered_on?: string | null
}
interface Shop { id: number; name: string; lat: number | null; lng: number | null; radius_m: number }
interface Lists { items: Item[]; suppliers: Party[]; buyers: Party[]; units: string[]; shops: Shop[] }
interface Fix { lat: number; lng: number; accuracy: number; at: number }
interface Receivables { total: number; overdue: number; buyers: { buyer: string; owed: number; count: number; overdue: number; oldest: string | null }[] }
interface Summary {
  holders: string[]
  lists: Lists; receivables: Receivables
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

interface UnitAvg { unit: string; qty: number; amount: number; avg: number | null }
interface DrillRow { key: string; label: string; count: number; amount: number; share: number; note?: string; qty?: number | null; avg?: number | null; units?: UnitAvg[] }
interface DrillLine { date: string; title: string; detail: string; amount: number; balance?: number; unit?: string; id?: number | null; receipt_url?: string | null }
interface Drill {
  card: string; label: string; total: number; level: 'group' | 'year' | 'month' | 'lines' | 'movements'
  crumbs: { label: string; params: { group?: string; year?: number; month?: number } }[]
  rows: DrillRow[]; lines: DrillLine[]; qty_available?: number; qty?: number | null; avg?: number | null; units?: UnitAvg[]
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
            {!isQty && d.units && d.units.length > 0 && (
              <div className="mt-2 border-t border-[var(--border)] pt-2">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--muted-2)]">Average price per unit</div>
                <div className="flex flex-wrap gap-2">
                  {d.units.map(u => (
                    <div key={u.unit} className="rounded-lg bg-[var(--card-inset)] px-3 py-1.5 text-center">
                      <div className="text-sm font-bold tabular-nums">{u.avg != null ? ugx(u.avg) : '-'}<span className="text-[10px] font-normal text-[var(--muted-2)]"> / {u.unit}</span></div>
                      <div className="text-[10px] text-[var(--muted-2)]">{ugx(u.qty)} {u.unit} bought</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!isQty && d.qty != null && (
              <div className="mt-2 flex items-baseline justify-between border-t border-[var(--border)] pt-2 text-xs text-[var(--muted-2)]">
                <span>{ugx(d.qty)} {d.qty === 1 ? 'item' : 'items'}</span>
                {d.avg != null && <span>average per item <b className="text-sm text-[var(--foreground)] tabular-nums">{ugx(d.avg)}</b></span>}
              </div>
            )}
          </div>
          {tappable && (
            <div className="divide-y divide-[var(--border)] rounded-[12px] border border-[var(--border)] bg-[var(--card)]">
              {d.rows.map(r => (
                <button key={r.key} onClick={() => open(r)} className="block w-full px-4 py-3 text-left">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">{r.label} <span className="text-xs font-normal text-[var(--muted-2)]">{r.note ?? `${r.count} ${r.count === 1 ? 'entry' : 'entries'}`}{r.qty ? ` · ${ugx(r.qty)} items` : ''}{r.avg != null ? ` · avg ${ugx(r.avg)} each` : ''}{r.units && r.units.length ? ' · ' + r.units.slice(0, 2).map(u => `${u.avg != null ? ugx(u.avg) : '-'}/${u.unit}`).join(', ') : ''}</span></span>
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
      {s.receivables.total > 0 && (
        <div className={card}>
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)]">Owed to the farm (credit sales)</div>
          <div className="mb-2 text-2xl font-bold tabular-nums">{ugx(s.receivables.total)}{s.receivables.overdue > 0 && <span className="ml-2 text-sm font-semibold text-[#f87171]">{ugx(s.receivables.overdue)} overdue</span>}</div>
          {s.receivables.buyers.map(b => (
            <div key={b.buyer} className="flex justify-between py-1 text-sm"><span>{b.buyer} <span className="text-xs text-[var(--muted-2)]">{b.count} sale{b.count === 1 ? '' : 's'}{b.oldest ? ', since ' + b.oldest : ''}</span></span><span className="tabular-nums">{ugx(b.owed)}</span></div>
          ))}
          <p className="mt-2 text-xs text-[var(--muted-2)]">Record money received from Entries, then Sales.</p>
        </div>
      )}
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

function ItemPicker({ value, items, onChange, onPick }: { value: string; items: Item[]; onChange: (v: string) => void; onPick: (i: Item) => void }) {
  const [open, setOpen] = useState(false)
  const q = value.trim().toLowerCase()
  const hits = items.filter(i => !q || i.name.toLowerCase().includes(q)).slice(0, 8)
  const exact = items.some(i => i.name.toLowerCase() === q)
  return (
    <div className="relative">
      <input className={input} value={value} placeholder="Start typing, e.g. Layer mash" autoComplete="off"
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={e => { onChange(e.target.value); setOpen(true) }} />
      {open && (hits.length > 0 || q) && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg">
          {hits.map(i => (
            <button key={i.id} type="button" onMouseDown={e => e.preventDefault()} onClick={() => { onPick(i); setOpen(false) }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--card-inset)]">
              <span>{i.name}</span><span className="text-[10px] text-[var(--muted-2)]">{i.group_name ?? ''} · {i.default_uom}</span>
            </button>
          ))}
          {q && hits.length === 0 && <div className="px-3 py-2 text-xs text-[#fbbf24]">No match: "{value.trim()}" will be added to the list as a new item when you save.</div>}
        </div>
      )}
      {!open && q && !exact && <div className="mt-1 text-xs text-[#fbbf24]">New item: "{value.trim()}" will be added to the list when you save.</div>}
    </div>
  )
}

function PartyPicker({ kind, value, parties, onChange, onAdded }: { kind: 'supplier' | 'buyer'; value: string; parties: Party[]; onChange: (v: string) => void; onAdded: () => void }) {
  const [adding, setAdding] = useState(false)
  const [nm, setNm] = useState(''); const [ph, setPh] = useState(''); const [err, setErr] = useState('')
  const save = async () => {
    try { await call(api('/lists/' + kind), 'POST', { name: nm, phone: ph }); onChange(nm.trim()); setAdding(false); setNm(''); setPh(''); setErr(''); onAdded() }
    catch (e) { setErr(errMsg(e)) }
  }
  return (
    <div className="space-y-2">
      <select className={input} value={adding ? '__new' : value} onChange={e => { if (e.target.value === '__new') setAdding(true); else { setAdding(false); onChange(e.target.value) } }}>
        <option value="">{kind === 'supplier' ? 'Choose a supplier…' : 'Choose a buyer…'}</option>
        {parties.filter(p => (p.status ?? 'Active') === 'Active' || p.name === value).map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
        <option value="__new">+ Add a new {kind}…</option>
      </select>
      {adding && (
        <div className="space-y-2 rounded-lg border border-[var(--border)] p-2.5">
          <input className={input} placeholder={`${kind === 'supplier' ? 'Supplier' : 'Buyer'} name`} value={nm} onChange={e => setNm(e.target.value)} />
          <input className={input} placeholder="Phone (optional)" inputMode="tel" value={ph} onChange={e => setPh(e.target.value)} />
          {err && <div className="text-xs text-[#fca5a5]">{err}</div>}
          <div className="flex gap-3"><button type="button" className={btn + ' !h-9 !px-4'} onClick={save}>Add</button>
            <button type="button" className="text-xs text-[var(--muted-2)]" onClick={() => setAdding(false)}>Cancel</button></div>
          <p className="text-[11px] text-[var(--muted-2)]">More details can be added later under Lists.</p>
        </div>
      )}
    </div>
  )
}

const GEO_HELP = 'Allow location for this site in your phone settings (Site settings, Location), then tap Retry.'
function useLocation() {
  const [fix, setFix] = useState<Fix | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<Fix | null>(null)
  const locate = () => new Promise<Fix>((resolve, reject) => {
    if (!navigator.geolocation) { const m = 'This phone or browser cannot give a location. ' + GEO_HELP; setErr(m); reject(new Error(m)); return }
    setBusy(true); setErr('')
    navigator.geolocation.getCurrentPosition(
      pos => { const f = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, at: Date.now() }; ref.current = f; setFix(f); setBusy(false); resolve(f) },
      e => { const m = e.code === 1 ? 'Location is switched off for this site. ' + GEO_HELP : 'Could not find your location yet. Go where there is a signal and tap Retry.'; setErr(m); setBusy(false); reject(new Error(m)) },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 })
  })
  useEffect(() => { locate().catch(() => undefined) }, [])  
  // a location older than ten minutes is taken again before saving
  const fresh = async () => (ref.current && Date.now() - ref.current.at < 600000 ? ref.current : locate())
  return { fix, err, busy, retry: () => locate().catch(() => undefined), fresh }
}

function RecordTab({ s, onSaved }: { s: Summary; onSaved: () => void }) {
  const qc = useQueryClient()
  const reload = () => qc.invalidateQueries({ queryKey: ['ledger'] })
  const loc = useLocation()
  const [noLoc, setNoLoc] = useState(false)
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
      if (kind === 'sale' && (f.payment || 'Cash') === 'Cash' && !body.held_by) { const r = localStorage.getItem('ledger_held_by'); if (r) body.held_by = r }
      if (noLoc && s.is_admin) body.gps_override_reason = f.gps_reason || ''
      else { const g = await loc.fresh(); body.gps = { lat: g.lat, lng: g.lng, accuracy: g.accuracy } }
      const res = await call(api('/' + kind), 'POST', body)
      if (file && res.id && kind !== 'loss') {
        const fd = new FormData(); fd.append('file', file)
        const up = await fetch(api(`/${kind}/${res.id}/receipt`), { method: 'POST', credentials: 'include', body: fd })
        if (!up.ok) throw new Error('Saved, but the receipt photo did not upload. Open Entries and add it again.')
      }
      setMsg({ ok: true, text: 'Saved.' + (res.warning ? ' ' + res.warning : '') })
      setF({ date: f.date, kind: 'opex', gps_reason: f.gps_reason || '' }); setFile(null); setBirds(false); onSaved()
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

      <div className="rounded-lg border p-2.5 text-sm" style={{ borderColor: loc.fix ? '#166534' : loc.err ? '#7f1d1d' : 'var(--border)' }}>
        {noLoc && s.is_admin ? (
          <div className="space-y-2">
            <div className="text-[#fbbf24]">Recording without a location. Say why (it is kept on the entry):</div>
            <input className={input} value={f.gps_reason || ''} onChange={e => set('gps_reason', e.target.value)} placeholder="e.g. back-filling from receipts" />
            <button type="button" className="text-xs text-[#60a5fa]" onClick={() => setNoLoc(false)}>Use my location instead</button>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div>
              {loc.busy && <span className="text-[var(--muted-2)]">📍 Finding your location…</span>}
              {!loc.busy && loc.fix && <span style={{ color: '#4ade80' }}>📍 Location found (within {Math.round(loc.fix.accuracy)} m)</span>}
              {!loc.busy && !loc.fix && <span style={{ color: '#fca5a5' }}>📍 {loc.err || 'Location needed to save'}</span>}
            </div>
            <div className="flex shrink-0 gap-3 text-xs">
              <button type="button" className="text-[#60a5fa]" onClick={loc.retry}>{loc.fix ? 'Refresh' : 'Retry'}</button>
              {s.is_admin && <button type="button" className="text-[var(--muted-2)]" onClick={() => setNoLoc(true)}>Skip</button>}
            </div>
          </div>
        )}
        {s.lists.shops.length > 1 && (
          <select className={input + ' mt-2'} value={f.shop_id || ''} onChange={e => set('shop_id', e.target.value)}>
            <option value="">Shop: nearest to me</option>
            {s.lists.shops.map(sh => <option key={sh.id} value={sh.id}>{sh.name}</option>)}
          </select>
        )}
      </div>

      {kind === 'expense' && <>
        <L t="What was bought?">
          <ItemPicker value={f.item || ''} items={s.lists.items} onChange={v => set('item', v)}
            onPick={i => { setF(o => ({ ...o, item: i.name, kind: i.kind, uom: i.default_uom })); setBirds(i.is_birds) }} />
        </L>
        <div className="grid grid-cols-2 gap-2">
          <L t="Quantity"><input className={input} inputMode="numeric" value={f.qty || ''} onChange={e => set('qty', e.target.value.replace(/[^0-9]/g, ''))} /></L>
          <L t="Total (UGX)">{money('total')}</L>
        </div>
        <L t="Unit bought in">
          <select className={input} value={f.uom || 'pc'} onChange={e => set('uom', e.target.value)}>
            {s.lists.units.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </L>
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
        <L t="Bought from (supplier)"><PartyPicker kind="supplier" value={f.supplier || ''} parties={s.lists.suppliers} onChange={v => set('supplier', v)} onAdded={reload} /></L>
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
        <L t="Paid"><select className={input} value={f.payment || 'Cash'} onChange={e => set('payment', e.target.value)}><option value="Cash">Cash, paid now</option><option value="Credit">On credit, paid later</option></select></L>
        {(f.payment || 'Cash') === 'Cash' && (
          <L t="Cash received by (who is holding it now)">
            <select className={input} value={f.held_by || localStorage.getItem('ledger_held_by') || ''} onChange={e => { set('held_by', e.target.value); try { localStorage.setItem('ledger_held_by', e.target.value) } catch { /* private window */ } }}>
              <option value="">Choose…</option>
              {s.holders.map(h => <option key={h} value={h}>{nice(h)}</option>)}
            </select>
          </L>
        )}
        <L t={f.payment === 'Credit' ? 'Buyer (required for credit)' : 'Buyer (optional)'}><PartyPicker kind="buyer" value={f.buyer || ''} parties={s.lists.buyers} onChange={v => set('buyer', v)} onAdded={reload} /></L>
        {f.payment === 'Credit' && <L t="Promised payment date (optional)"><input type="date" className={input} value={f.due_date || ''} onChange={e => set('due_date', e.target.value)} style={{ colorScheme: 'dark' }} /></L>}
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
  const [payRow, setPayRow] = useState<number | null>(null)
  const [payAmt, setPayAmt] = useState('')
  const [payBy, setPayBy] = useState('')
  const pay = (r: Row) => { setPayRow(r.id); setPayAmt(String((r.total ?? 0) - (r.paid_amount ?? 0))); setPayBy(localStorage.getItem('ledger_held_by') || '') }
  const savePay = async (r: Row) => {
    try { await call(api(`/sale/${r.id}/payment`), 'POST', { amount: payAmt.replace(/[^0-9]/g, ''), received_by: payBy }); setErr(''); setPayRow(null); q.refetch(); onChanged() } catch (e) { setErr(errMsg(e)) }
  }
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
          <div key={r.id} className="relative flex items-start gap-3 px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium capitalize">{label(r)} {r.qty ? <span className="text-[var(--muted-2)]">× {r.qty}</span> : null}</div>
              <div className="text-xs text-[var(--muted-2)]">
                {dateOf(r)} · {r.created_by}{r.source === 'appsheet_import' ? ' (from AppSheet)' : ''}{r.paid_by ? ' · paid by ' + who(r.paid_by) : ''}
                {r.receipt_url && <> · <a className="underline" href={r.receipt_url} target="_blank" rel="noreferrer">receipt</a></>}
                {r.payment === 'Credit' && <> · <span className="font-semibold" style={{ color: (r.paid_amount ?? 0) >= (r.total ?? 0) ? '#4ade80' : '#fbbf24' }}>{(r.paid_amount ?? 0) >= (r.total ?? 0) ? 'credit, paid' : `credit, owed ${ugx((r.total ?? 0) - (r.paid_amount ?? 0))}`}</span>{r.due_date ? ' (due ' + r.due_date + ')' : ''}</>}
                {r.buyer ? ' · ' + r.buyer : ''}{r.supplier ? ' · from ' + r.supplier : ''}
                {r.source !== 'appsheet_import' && (r.gps_lat == null
                  ? <span className="text-[#fbbf24]"> · no location</span>
                  : r.gps_away ? <span className="text-[#fbbf24]"> · {((r.distance_m ?? 0) / 1000).toFixed(1)} km from the farm</span> : <span> · 📍</span>)}
              </div>
            </div>
            <div className="text-right tabular-nums">{ugx(amt(r))}</div>
            {payRow === r.id && (
              <div className="absolute inset-x-3 z-10 mt-12 space-y-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 shadow-lg">
                <input className={input} inputMode="numeric" value={payAmt ? Number(payAmt).toLocaleString('en-US') : ''} onChange={e => setPayAmt(e.target.value.replace(/[^0-9]/g, ''))} />
                <select className={input} value={payBy} onChange={e => setPayBy(e.target.value)}><option value="">Who received the money?</option>{s.holders.map(h => <option key={h} value={h}>{nice(h)}</option>)}</select>
                <div className="flex gap-3"><button className={btn + ' !h-9 !px-4'} onClick={() => savePay(r)}>Save</button><button className="text-xs text-[var(--muted-2)]" onClick={() => setPayRow(null)}>Cancel</button></div>
              </div>
            )}
            {s.can_write && kind === 'sale' && r.payment === 'Credit' && (r.paid_amount ?? 0) < (r.total ?? 0) && (
              <button onClick={() => pay(r)} className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-semibold text-[#60a5fa]">Got paid</button>
            )}
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

const SUP_FIELDS: [keyof Party, string, string?][] = [
  ['name', 'Company name'], ['contact_name', 'Contact person'], ['title', 'Contact title (Mr, Mrs…)'], ['phone', 'Phone number'], ['email', 'Email address'],
  ['address', 'Physical address'], ['country', 'Country'], ['website', 'Website'], ['payment_terms', 'Payment terms (e.g. Cash, 30 days)'],
  ['account_number', 'Account number'], ['category', 'What they supply (e.g. Feed, Chicken)'], ['notes', 'Notes'],
]
const BUY_FIELDS: [keyof Party, string][] = [['name', 'Buyer name'], ['phone', 'Contact (phone)'], ['address', 'Where they are (optional)'], ['notes', 'Notes']]

function PartyForm({ kind, start, onDone }: { kind: 'supplier' | 'buyer'; start: Party | null; onDone: () => void }) {
  const fields = kind === 'supplier' ? SUP_FIELDS : BUY_FIELDS
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries([...fields.map(([k]) => [k as string, String(start?.[k] ?? '')]), ['status', start?.status ?? 'Active'], ['registered_on', start?.registered_on ?? '']]))
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try { await call(api(start ? `/lists/${kind}/${start.id}` : '/lists/' + kind), start ? 'PUT' : 'POST', f); onDone() } catch (e) { setErr(errMsg(e)) }
    setBusy(false)
  }
  return (
    <div className={card + ' space-y-2.5'}>
      <div className="text-sm font-semibold">{start ? 'Edit ' + start.name : 'New ' + kind}</div>
      {fields.map(([k, label]) => (
        <L key={k as string} t={label}>{k === 'notes' ? <textarea className={input} rows={2} value={f[k as string]} onChange={e => setF(o => ({ ...o, [k as string]: e.target.value }))} />
          : <input className={input} value={f[k as string]} onChange={e => setF(o => ({ ...o, [k as string]: e.target.value }))} />}</L>
      ))}
      {kind === 'supplier' && (
        <div className="grid grid-cols-2 gap-2">
          <L t="Status"><select className={input} value={f.status} onChange={e => setF(o => ({ ...o, status: e.target.value }))}><option>Active</option><option>Inactive</option></select></L>
          <L t="Registered on"><input type="date" className={input} value={f.registered_on} onChange={e => setF(o => ({ ...o, registered_on: e.target.value }))} style={{ colorScheme: 'dark' }} /></L>
        </div>
      )}
      {err && <div className="rounded-lg bg-[#450a0a] p-2.5 text-sm text-[#fca5a5]">{err}</div>}
      <div className="flex gap-3"><button className={btn} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button><button className="text-sm text-[var(--muted-2)]" onClick={onDone}>Cancel</button></div>
    </div>
  )
}

function ListsTab({ s }: { s: Summary }) {
  const qc = useQueryClient()
  const [which, setWhich] = useState<'suppliers' | 'buyers' | 'items' | 'units' | 'shops'>('suppliers')
  const [edit, setEdit] = useState<Party | 'new' | null>(null)
  const [find, setFind] = useState('')
  const [msg, setMsg] = useState('')
  const [it, setIt] = useState({ name: '', group_name: '', kind: 'opex', default_uom: 'pc', is_birds: false })
  const [unit, setUnit] = useState('')
  const [shop, setShop] = useState({ name: '', lat: '', lng: '', radius_m: '1000' })
  const here = () => navigator.geolocation?.getCurrentPosition(p => setShop(o => ({ ...o, lat: String(p.coords.latitude), lng: String(p.coords.longitude) })), () => setMsg('Could not get your location. ' + GEO_HELP), { enableHighAccuracy: true, timeout: 20000 })
  const reload = () => { qc.invalidateQueries({ queryKey: ['ledger'] }); setEdit(null); setMsg('') }
  const guard = async (fn: () => Promise<unknown>) => { try { await fn(); reload() } catch (e) { setMsg(errMsg(e)) } }
  const kindOf = which === 'suppliers' ? 'supplier' : 'buyer'
  const people = (which === 'suppliers' ? s.lists.suppliers : s.lists.buyers).filter(p => !find || p.name.toLowerCase().includes(find.toLowerCase()))
  const groups = [...new Set(s.lists.items.map(i => i.group_name ?? 'Other'))].sort()
  const tabs: ['suppliers' | 'buyers' | 'items' | 'units' | 'shops', string, number][] = [['suppliers', 'Suppliers', s.lists.suppliers.length], ['buyers', 'Buyers', s.lists.buyers.length], ['items', 'Items', s.lists.items.length], ['units', 'Units', s.lists.units.length], ['shops', 'Shops', s.lists.shops.length]]
  return (
    <div className="space-y-3">
      <p className="px-1 text-xs text-[var(--muted-2)]">The lists behind every dropdown. Pick from them when recording so the same thing is always spelt the same way. A new name typed while recording is added here automatically.</p>
      <div className="flex flex-wrap gap-2">
        {tabs.map(([k, l, n]) => (
          <button key={k} onClick={() => { setWhich(k); setEdit(null); setMsg('') }} className="rounded-full border px-3 py-1.5 text-xs font-semibold"
            style={{ borderColor: which === k ? '#22c55e' : 'var(--border)', color: which === k ? '#4ade80' : 'var(--muted-2)' }}>{l} ({n})</button>
        ))}
      </div>
      {msg && <div className="rounded-lg bg-[#450a0a] p-2.5 text-sm text-[#fca5a5]">{msg}</div>}

      {(which === 'suppliers' || which === 'buyers') && (edit
        ? <PartyForm kind={kindOf} start={edit === 'new' ? null : edit} onDone={reload} />
        : <>
          <div className="flex gap-2">
            <input className={input} placeholder="Search…" value={find} onChange={e => setFind(e.target.value)} />
            {s.can_write && <button className={btn + ' shrink-0 !px-4'} onClick={() => setEdit('new')}>+ New</button>}
          </div>
          <div className={card + ' divide-y divide-[var(--border)] !p-0'}>
            {people.map(p => (
              <div key={p.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <button className="min-w-0 flex-1 text-left" onClick={() => s.can_write && setEdit(p)}>
                  <div className="font-medium">{p.name} {p.status === 'Inactive' && <span className="text-xs text-[var(--muted-2)]">(inactive)</span>}</div>
                  <div className="text-xs text-[var(--muted-2)]">{[p.category, p.phone, p.payment_terms, p.address].filter(Boolean).join(' · ') || 'no details yet'}</div>
                  {p.notes && <div className="mt-0.5 text-xs text-[var(--muted-2)]">{p.notes}</div>}
                </button>
                {s.is_admin && <button className="text-xs text-[var(--muted-2)]" onClick={() => window.confirm(`Stop offering ${p.name} in the dropdown? Past records keep their name.`) && guard(() => call(api(`/lists/${kindOf}/${p.id}`), 'DELETE'))}>remove</button>}
              </div>
            ))}
            {people.length === 0 && <div className="p-4 text-sm text-[var(--muted-2)]">Nothing here yet.</div>}
          </div>
        </>)}

      {which === 'items' && (
        <>
          {s.can_write && (
            <div className={card + ' space-y-2'}>
              <div className="text-sm font-semibold">Add an item to the "What was bought" list</div>
              <input className={input} placeholder="Item name, e.g. Sunflower cake" value={it.name} onChange={e => setIt(o => ({ ...o, name: e.target.value }))} />
              <div className="grid grid-cols-2 gap-2">
                <select className={input} value={it.group_name} onChange={e => setIt(o => ({ ...o, group_name: e.target.value }))}><option value="">Group (automatic)</option>{groups.map(g => <option key={g}>{g}</option>)}</select>
                <select className={input} value={it.default_uom} onChange={e => setIt(o => ({ ...o, default_uom: e.target.value }))}>{s.lists.units.map(u => <option key={u}>{u}</option>)}</select>
              </div>
              <select className={input} value={it.kind} onChange={e => setIt(o => ({ ...o, kind: e.target.value }))}><option value="opex">Running cost</option><option value="capex">Equipment or building</option></select>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={it.is_birds} onChange={e => setIt(o => ({ ...o, is_birds: e.target.checked }))} /> These are birds</label>
              <button className={btn + ' !h-9 !px-4'} onClick={() => guard(async () => { await call(api('/lists/item'), 'POST', it); setIt({ name: '', group_name: '', kind: 'opex', default_uom: 'pc', is_birds: false }) })}>Add item</button>
            </div>
          )}
          {groups.map(g => (
            <div key={g} className={card}>
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)]">{g}</div>
              {s.lists.items.filter(i => (i.group_name ?? 'Other') === g).map(i => (
                <div key={i.id} className="flex items-center justify-between gap-2 py-1 text-sm">
                  <span>{i.name}{i.is_birds ? ' 🐔' : ''}</span>
                  <span className="flex items-center gap-3 text-xs text-[var(--muted-2)]">{i.kind === 'capex' ? 'equipment' : 'running'} · {i.default_uom}
                    {s.is_admin && <button onClick={() => window.confirm(`Stop offering ${i.name}?`) && guard(() => call(api(`/lists/item/${i.id}`), 'DELETE'))}>remove</button>}</span>
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      {which === 'shops' && (
        <>
          <p className="px-1 text-xs text-[var(--muted-2)]">A shop is a place the farm records from. Entries are tagged with the nearest shop, and flagged when recorded farther away than its radius. Items, suppliers and buyers are shared by all shops. Adding a second shop does not change any existing record.</p>
          {s.lists.shops.map(sh => (
            <div key={sh.id} className={card}>
              <div className="font-medium">{sh.name}</div>
              <div className="text-xs text-[var(--muted-2)]">{sh.lat != null ? `${sh.lat.toFixed(5)}, ${sh.lng?.toFixed(5)}` : 'no location set'} · flags entries beyond {sh.radius_m} m</div>
            </div>
          ))}
          {s.is_admin && (
            <div className={card + ' space-y-2'}>
              <div className="text-sm font-semibold">Add a shop</div>
              <input className={input} placeholder="Shop or site name" value={shop.name} onChange={e => setShop(o => ({ ...o, name: e.target.value }))} />
              <div className="grid grid-cols-2 gap-2">
                <input className={input} placeholder="Latitude" value={shop.lat} onChange={e => setShop(o => ({ ...o, lat: e.target.value }))} />
                <input className={input} placeholder="Longitude" value={shop.lng} onChange={e => setShop(o => ({ ...o, lng: e.target.value }))} />
              </div>
              <button type="button" className="text-xs text-[#60a5fa]" onClick={here}>Use my current location (stand at the shop)</button>
              <input className={input} inputMode="numeric" placeholder="Radius in metres" value={shop.radius_m} onChange={e => setShop(o => ({ ...o, radius_m: e.target.value.replace(/[^0-9]/g, '') }))} />
              <button className={btn + ' !h-9 !px-4'} onClick={() => guard(async () => { await call(api('/lists/shop'), 'POST', shop); setShop({ name: '', lat: '', lng: '', radius_m: '1000' }) })}>Add shop</button>
            </div>
          )}
        </>
      )}

      {which === 'units' && (
        <div className={card + ' space-y-3'}>
          <div className="flex flex-wrap gap-2">{s.lists.units.map(u => <span key={u} className="rounded-full border border-[var(--border)] px-3 py-1 text-sm">{u}</span>)}</div>
          {s.can_write && (
            <div className="flex gap-2">
              <input className={input} placeholder="New unit, e.g. crate" value={unit} onChange={e => setUnit(e.target.value)} />
              <button className={btn + ' shrink-0 !px-4'} onClick={() => guard(async () => { await call(api('/lists/unit'), 'POST', { name: unit }); setUnit('') })}>Add</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface Move { id: number; kind: 'opening' | 'handover' | 'banked'; from_holder: string | null; to_holder: string; amount: number; move_date: string; note: string | null; status: 'pending' | 'acknowledged' | 'rejected'; created_by: string; decided_by: string | null; decision_note: string | null; receipt_url: string | null; can_acknowledge: boolean }
interface CashData { holders: { holder: string; received: number; moved_in: number; moved_out: number; spent: number; balance: number; in_transit_in: number; in_transit_out: number }[]; unassigned: number; held_outside_club: number; moves: Move[]; options: string[] }
const MOVE_LABEL: Record<Move['kind'], string> = { opening: 'Opening declaration', handover: 'Handover', banked: 'Banked' }

function CashTab() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const q = useQuery<CashData>({ queryKey: ['ledger-cash'], queryFn: () => call<CashData>(api('/cash')) })
  const [form, setForm] = useState<null | 'opening' | 'handover' | 'banked'>(null)
  const [f, setF] = useState<Record<string, string>>({})
  const [file, setFile] = useState<File | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  if (q.error) return <div className={card + ' text-sm'}>{(q.error as Error).message}</div>
  if (!q.data) return <div className="p-4 text-sm text-[var(--muted-2)]">Loading…</div>
  const c = q.data
  const refresh = () => { qc.invalidateQueries({ queryKey: ['ledger-cash'] }); qc.invalidateQueries({ queryKey: ['ledger-recon'] }) }
  const open = (k: 'opening' | 'handover' | 'banked') => { setForm(k); setErr(''); setFile(null); setF({ date: today(), amount: k === 'opening' ? String(c.unassigned) : '', to_holder: k === 'banked' ? 'Club account' : '', from_holder: localStorage.getItem('ledger_held_by') || '' }) }
  const submit = async () => {
    if (!form) return
    setBusy(true)
    try {
      const res = await call(api('/cash/move'), 'POST', { ...f, kind: form })
      if (file) { const fd = new FormData(); fd.append('file', file); await fetch(api(`/cash/move/${res.id}/receipt`), { method: 'POST', credentials: 'include', body: fd }) }
      setForm(null); refresh()
    } catch (e) { setErr(errMsg(e)) }
    setBusy(false)
  }
  const decide = async (m: Move, approve: boolean) => {
    const note = approve ? '' : (window.prompt('Why are you rejecting it?') ?? null)
    if (!approve && note === null) return
    try { await call(api(`/cash/move/${m.id}/decision`), 'POST', { approve, note }); refresh() } catch (e) { setErr(errMsg(e)) }
  }
  const withdraw = async (m: Move) => { if (window.confirm('Withdraw this submission?')) { try { await call(api(`/cash/move/${m.id}`), 'DELETE'); refresh() } catch (e) { setErr(errMsg(e)) } } }
  const badge = (st: Move['status']) => <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase" style={{ borderColor: st === 'acknowledged' ? '#22c55e' : st === 'rejected' ? '#f87171' : '#fbbf24', color: st === 'acknowledged' ? '#4ade80' : st === 'rejected' ? '#f87171' : '#fbbf24' }}>{st === 'pending' ? 'waiting' : st}</span>
  const money = (k: string) => <input className={input} inputMode="numeric" value={f[k] ? Number(f[k]).toLocaleString('en-US') : ''} onChange={e => setF(o => ({ ...o, [k]: e.target.value.replace(/[^0-9]/g, '') }))} />
  const sel = (k: string, label: string, opts: string[], fixed?: boolean) => (
    <L t={label}><select className={input} disabled={fixed} value={f[k] || ''} onChange={e => setF(o => ({ ...o, [k]: e.target.value }))}><option value="">Choose…</option>{opts.map(o => <option key={o} value={o}>{nice(o)}</option>)}</select></L>
  )
  return (
    <div className="space-y-3">
      <p className="px-1 text-xs text-[var(--muted-2)]">Where the farm's cash physically is. Cash from sales is not in the club account until it is banked, but every shilling is tracked: whoever hands it over or banks it submits it with a slip, and the receiver (the Treasurer for the club account) acknowledges it, like a contribution.</p>
      {c.unassigned > 0 && (
        <div className={card + ' border-[#92400e]'}>
          <div className="text-sm font-semibold text-[#fbbf24]">{ugx(c.unassigned)} of cash sales has no recorded holder</div>
          <p className="mt-1 text-xs text-[var(--muted-2)]">These are the AppSheet-period sales (and any sold by message). Declare who is holding the cash; the Treasurer or an admin then acknowledges it.</p>
          <button className={btn + ' mt-2 !h-9 !px-4'} onClick={() => open('opening')}>Declare who holds it</button>
        </div>
      )}
      <div className={card}>
        <div className="mb-2 flex items-baseline justify-between"><div className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)]">Cash held</div>
          <div className="text-xs text-[var(--muted-2)]">outside the club account: <b className="text-[var(--foreground)]">{ugx(c.held_outside_club)}</b></div></div>
        {c.holders.filter(h => h.received || h.moved_in || h.moved_out || h.spent || h.in_transit_in).map(h => (
          <div key={h.holder} className="border-t border-[var(--border)] py-2 first:border-0">
            <div className="flex justify-between text-sm"><span className="font-medium">{nice(h.holder)}</span><span className="font-bold tabular-nums" style={{ color: h.balance < 0 ? '#f87171' : undefined }}>{ugx(h.balance)}</span></div>
            <div className="text-xs text-[var(--muted-2)]">received {ugx(h.received + h.moved_in)} · handed on {ugx(h.moved_out)} · spent {ugx(h.spent)}{h.in_transit_in ? ` · ${ugx(h.in_transit_in)} on its way` : ''}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button className={btn + ' !h-10 flex-1'} onClick={() => open('handover')}>Hand over cash</button>
        <button className={btn + ' !h-10 flex-1'} onClick={() => open('banked')}>Banked</button>
      </div>
      {err && <div className="rounded-lg bg-[#450a0a] p-2.5 text-sm text-[#fca5a5]">{err}</div>}
      {form && (
        <div className={card + ' space-y-2.5'}>
          <div className="text-sm font-semibold">{MOVE_LABEL[form]}</div>
          {form === 'opening' ? sel('to_holder', 'Who is holding it?', c.options.filter(o => o !== 'Club account'))
            : <>{sel('from_holder', 'From', c.options.filter(o => o !== 'Club account'))}{sel('to_holder', form === 'banked' ? 'Paid into' : 'To', form === 'banked' ? ['Club account'] : c.options.filter(o => o !== f.from_holder), form === 'banked')}</>}
          <L t="Amount (UGX)">{money('amount')}</L>
          <L t="Date"><input type="date" className={input} max={today()} value={f.date || ''} onChange={e => setF(o => ({ ...o, date: e.target.value }))} style={{ colorScheme: 'dark' }} /></L>
          <L t="Note (optional)"><input className={input} value={f.note || ''} onChange={e => setF(o => ({ ...o, note: e.target.value }))} /></L>
          {form !== 'opening' && <L t={form === 'banked' ? 'Deposit slip photo' : 'Photo of the handover note (optional)'}><input type="file" accept="image/*,application/pdf" className="text-xs" onChange={e => setFile(e.target.files?.[0] ?? null)} /></L>}
          <div className="flex gap-3"><button className={btn} disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit'}</button><button className="text-sm text-[var(--muted-2)]" onClick={() => setForm(null)}>Cancel</button></div>
          <p className="text-[11px] text-[var(--muted-2)]">It counts once the {form === 'banked' ? 'Treasurer' : 'receiver'} acknowledges it.</p>
        </div>
      )}
      <div className={card + ' divide-y divide-[var(--border)] !p-0'}>
        {c.moves.map(m => (
          <div key={m.id} className="space-y-1 px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-2"><span className="font-medium">{MOVE_LABEL[m.kind]}: {ugx(m.amount)}</span>{badge(m.status)}</div>
            <div className="text-xs text-[var(--muted-2)]">{m.move_date} · {m.from_holder ? nice(m.from_holder) + ' → ' : 'AppSheet-period sales → '}{nice(m.to_holder)} · submitted by {m.created_by}{m.decided_by ? ` · ${m.status} by ${m.decided_by}` : ''}{m.receipt_url && <> · <a className="underline" href={m.receipt_url} target="_blank" rel="noreferrer">slip</a></>}</div>
            {m.note && <div className="text-xs text-[var(--muted-2)]">{m.note}</div>}
            {m.decision_note && <div className="text-xs text-[#fca5a5]">{m.decision_note}</div>}
            {m.status === 'pending' && (
              <div className="flex gap-3 pt-1 text-xs font-semibold">
                {m.can_acknowledge && <><button className="text-[#4ade80]" onClick={() => decide(m, true)}>Acknowledge</button><button className="text-[#f87171]" onClick={() => decide(m, false)}>Reject</button></>}
                {(m.created_by === user?.display || user?.role === 'admin') && <button className="text-[var(--muted-2)]" onClick={() => withdraw(m)}>Withdraw</button>}
              </div>
            )}
          </div>
        ))}
        {c.moves.length === 0 && <div className="p-4 text-sm text-[var(--muted-2)]">No handovers or bankings yet.</div>}
      </div>
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
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)]">Where the cash is held</div>
        {r.custody.holders.filter(h => h.balance || h.received || h.moved_in).map(h => (
          <div key={h.holder} className="flex justify-between py-1 text-sm"><span>{nice(h.holder)}</span><span className="tabular-nums" style={{ color: h.balance < 0 ? '#f87171' : undefined }}>{ugx(h.balance)}</span></div>
        ))}
        <div className="mt-1 border-t border-[var(--border)] pt-1 text-xs text-[var(--muted-2)]">Held outside the club account: {ugx(r.custody.held_outside_club)}{r.custody.unassigned ? ` · with no recorded holder: ${ugx(r.custody.unassigned)}` : ''}. See the Cash tab.</div>
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
  const [tab, setTab] = useState<'summary' | 'score' | 'record' | 'entries' | 'cash' | 'lists' | 'recon'>('summary')
  const [sumKey, setSumKey] = useState(0)          // tapping Summary always returns from a drill-down to the cards
  const q = useQuery<Summary>({ queryKey: ['ledger'], queryFn: () => call<Summary>(api('')), enabled: !!user })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['ledger'] }); qc.invalidateQueries({ queryKey: ['ledger-recon'] }); qc.invalidateQueries({ queryKey: ['ledger-entries'] }) }
  if (q.error) return <div className="p-6 text-sm text-[#fca5a5]">{(q.error as Error).message}</div>
  if (!q.data) return <div className="p-6 text-sm text-[var(--muted-2)]">Loading the chicken ledger…</div>
  const s = q.data
  const tabs: ['summary' | 'score' | 'record' | 'entries' | 'cash' | 'lists' | 'recon', string][] = [['summary', 'Summary'], ['score', 'Scorecard'], ...(s.can_write ? [['record', 'Record'] as ['record', string]] : []), ['entries', 'Entries'], ['cash', 'Cash'], ['lists', 'Lists'], ['recon', 'Reconciliation']]
  return (
    <div className="mx-auto max-w-2xl space-y-3 px-4 pb-24 pt-4">
      <div>
        <h1 className="text-lg font-bold">🐔 Chicken ledger</h1>
        <p className="text-xs text-[var(--muted-2)]">Every shilling in and out of the farm, who recorded it and who paid. This replaces the AppSheet.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => { setTab(k); if (k === 'summary') setSumKey(n => n + 1) }} className="shrink-0 rounded-full border px-4 py-2 text-xs font-semibold"
            style={{ borderColor: tab === k ? '#22c55e' : 'var(--border)', color: tab === k ? '#4ade80' : 'var(--muted-2)' }}>{l}</button>
        ))}
      </div>
      {tab === 'summary' && <SummaryTab key={sumKey} s={s} />}
      {tab === 'score' && <ScorecardTab />}
      {tab === 'record' && s.can_write && <RecordTab s={s} onSaved={refresh} />}
      {tab === 'entries' && <EntriesTab s={s} onChanged={refresh} />}
      {tab === 'cash' && <CashTab />}
      {tab === 'lists' && <ListsTab s={s} />}
      {tab === 'recon' && <ReconTab s={s} />}
    </div>
  )
}
