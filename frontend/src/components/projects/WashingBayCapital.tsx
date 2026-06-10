import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Landmark, Trash2, ShieldCheck, AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Inset } from '@/components/ui/card'
import { LoadingRow } from '@/components/ui/spinner'
import { ugx, cn } from '@/lib/utils'

interface CapRecord {
  id: number
  contributor: string
  amount_ugx: number
  date: string
  source: string
  proof_ref: string
  verified: boolean
  recorded_at: string
}
interface CapResponse {
  target_ugx: number
  total_accounted_ugx: number
  verified_ugx: number
  remaining_ugx: number
  pct_accounted: number
  balanced: boolean
  by_contributor: { contributor: string; amount_ugx: number }[]
  records: CapRecord[]
}

// Dad and Alex first (known majors), then the rest of the family, then free text.
const CONTRIBUTORS = ['Dad', 'Alex', 'Max', 'Viola', 'Solomon', 'Hillary', 'Mum', 'Hellen', 'Lawi']

const onlyDigits = (s: string) => s.replace(/[^\d]/g, '')
const groupDigits = (s: string) => (s ? Number(onlyDigits(s)).toLocaleString('en-US') : '')
const todayISO = () => new Date().toISOString().slice(0, 10)

function AddCapitalForm({ remaining, onDone }: { remaining: number; onDone: () => void }) {
  const qc = useQueryClient()
  const [pick, setPick] = useState('Dad')
  const [form, setForm] = useState({ other: '', amount: '', date: todayISO(), source: '', proof_ref: '', pin: '', verified: false })
  const set = (k: keyof typeof form, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))
  const contributor = pick === '__other__' ? form.other.trim() : pick

  const mut = useMutation({
    mutationFn: () =>
      fetch('/api/washing-bay/capital', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: form.pin, contributor, amount_ugx: Number(onlyDigits(form.amount)),
          date: form.date, source: form.source, proof_ref: form.proof_ref, verified: form.verified,
        }),
      }).then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Failed to save')
        return r.json()
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['wb-capital'] }); onDone() },
  })

  const field = 'h-10 w-full rounded-[10px] border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-2)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]'
  const valid = contributor && onlyDigits(form.amount) && form.pin

  return (
    <div className="space-y-2.5">
      <div>
        <label className="mb-1 block text-[11px] text-[var(--muted-2)]">Contributor *</label>
        <select className={field} value={pick} onChange={e => setPick(e.target.value)}>
          {CONTRIBUTORS.map(c => <option key={c} value={c}>{c}</option>)}
          <option value="__other__">Other…</option>
        </select>
        {pick === '__other__' && (
          <input className={cn(field, 'mt-2')} placeholder="Type contributor name" value={form.other} onChange={e => set('other', e.target.value)} />
        )}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="mb-1 block text-[11px] text-[var(--muted-2)]">Amount (UGX) *</label>
          <input type="text" inputMode="numeric" className={field} placeholder="0" value={groupDigits(form.amount)} onChange={e => set('amount', e.target.value)} />
          {!!onlyDigits(form.amount) && remaining > 0 && (
            <button type="button" className="mt-1 text-[11px] text-[var(--info)]" onClick={() => set('amount', String(remaining))}>
              use remaining {ugx(remaining)}
            </button>
          )}
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-[var(--muted-2)]">Date</label>
          <input type="date" className={field} value={form.date} onChange={e => set('date', e.target.value)} />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-[11px] text-[var(--muted-2)]">Source</label>
        <input className={field} placeholder="e.g. Bank transfer, cash, equipment in kind" value={form.source} onChange={e => set('source', e.target.value)} />
      </div>
      <div>
        <label className="mb-1 block text-[11px] text-[var(--muted-2)]">Proof reference</label>
        <input className={field} placeholder="Receipt no, slip, invoice (optional)" value={form.proof_ref} onChange={e => set('proof_ref', e.target.value)} />
      </div>
      <label className="flex items-center gap-2.5 rounded-[10px] border border-[var(--border)] bg-[var(--background)] p-2.5">
        <span className={cn('flex h-5 w-5 items-center justify-center rounded-[6px] border-2', form.verified ? 'border-[#22c55e] bg-[#22c55e]' : 'border-[var(--muted-2)]')}>
          {form.verified && <ShieldCheck size={13} className="text-white" />}
        </span>
        <input type="checkbox" className="sr-only" checked={form.verified} onChange={e => set('verified', e.target.checked)} />
        <span className="text-[12px] text-[var(--foreground)]">Proof sighted / verified</span>
      </label>
      <div>
        <label className="mb-1 block text-[11px] text-[var(--muted-2)]">PIN *</label>
        <input type="password" inputMode="numeric" className={field} placeholder="Required to record" value={form.pin} onChange={e => set('pin', onlyDigits(e.target.value))} />
      </div>
      {mut.isError && <p className="text-xs text-[var(--danger)]">{(mut.error as Error).message}</p>}
      <div className="flex gap-2 pt-1">
        <Button variant="ghost" className="flex-1" onClick={onDone}>Cancel</Button>
        <Button variant="success" className="flex-1" disabled={!valid || mut.isPending} onClick={() => mut.mutate()}>
          {mut.isPending ? 'Saving…' : 'Record capital'}
        </Button>
      </div>
    </div>
  )
}

function CapRow({ r }: { r: CapRecord }) {
  const qc = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [pin, setPin] = useState('')
  const del = useMutation({
    mutationFn: () =>
      fetch('/api/washing-bay/capital/delete', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, id: r.id }),
      }).then(async res => { if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Failed'); return res.json() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['wb-capital'] }) },
  })
  return (
    <Inset className="p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[var(--foreground)]">{r.contributor}</span>
        <span className="text-sm font-bold tabular-nums text-[var(--success)]">{ugx(r.amount_ugx)}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--muted-2)]">
        {r.verified
          ? <span className="inline-flex items-center gap-1 text-[#4ade80]"><ShieldCheck size={11} /> verified</span>
          : <span className="inline-flex items-center gap-1 text-[#fcd34d]"><AlertTriangle size={11} /> unverified</span>}
        {r.date && <span>· {r.date}</span>}
        {r.source && <span>· {r.source}</span>}
        {r.proof_ref && <span>· ref {r.proof_ref}</span>}
      </div>
      {!confirming ? (
        <button onClick={() => setConfirming(true)} className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[var(--muted-2)] hover:text-[var(--danger)]">
          <Trash2 size={11} /> remove
        </button>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <input type="password" inputMode="numeric" placeholder="PIN" value={pin} onChange={e => setPin(onlyDigits(e.target.value))}
            className="h-8 w-20 rounded-[8px] border border-[var(--border)] bg-[var(--background)] px-2 text-xs text-[var(--foreground)]" />
          <Button variant="ghost" size="sm" onClick={() => { setConfirming(false); setPin('') }}>Cancel</Button>
          <Button variant="danger" size="sm" disabled={!pin || del.isPending} onClick={() => del.mutate()}>Delete</Button>
          {del.isError && <span className="text-[11px] text-[var(--danger)]">{(del.error as Error).message}</span>}
        </div>
      )}
    </Inset>
  )
}

export function WashingBayCapital() {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)

  const { data, isLoading } = useQuery<CapResponse>({
    queryKey: ['wb-capital'],
    queryFn: () => fetch('/api/washing-bay/capital', { credentials: 'include' }).then(r => r.json()),
    enabled: open,
  })

  const pct = Math.min(100, data?.pct_accounted ?? 0)

  return (
    <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) setAdding(false) }}>
      <DialogTrigger asChild>
        <Button variant="subtle" size="sm" className="w-full"><Landmark size={15} /> Capital</Button>
      </DialogTrigger>
      <DialogContent title="🚗 Capital Accountability" subtitle="Who funded the CapEx, and how it balances">
        {isLoading || !data ? (
          <LoadingRow label="Loading capital records…" />
        ) : adding ? (
          <AddCapitalForm remaining={data.remaining_ugx} onDone={() => setAdding(false)} />
        ) : (
          <div>
            {/* Balancing panel */}
            <Inset className="mb-3 p-3.5">
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-[11px] text-[var(--muted-2)]">Accounted of {ugx(data.target_ugx)}</div>
                  <div className="text-lg font-bold tabular-nums text-[var(--foreground)]">{ugx(data.total_accounted_ugx)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-[var(--muted-2)]">{pct}%</div>
                  <div className={cn('text-[12px] font-semibold', data.balanced ? 'text-[#4ade80]' : 'text-[#fcd34d]')}>
                    {data.balanced ? 'Balanced' : `${ugx(data.remaining_ugx)} unaccounted`}
                  </div>
                </div>
              </div>
              <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-[var(--background)]">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: data.balanced ? 'linear-gradient(90deg,#16a34a,#22c55e)' : 'linear-gradient(90deg,#f59e0b,#fbbf24)' }} />
              </div>
              {!data.balanced && (
                <div className="mt-2.5 flex items-start gap-1.5 rounded-[8px] border border-[rgba(251,191,36,.4)] bg-[rgba(251,191,36,.1)] p-2 text-[11px] text-[#fcd34d]">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>Risk: the {ugx(data.target_ugx)} CapEx has no full proof of sources. Dad is reconciling who contributed what.</span>
                </div>
              )}
              <Button variant="success" size="sm" className="mt-3 w-full" onClick={() => setAdding(true)}>+ Record capital</Button>
            </Inset>

            {/* Per-contributor split */}
            {data.by_contributor.length > 0 && (
              <div className="mb-3 space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-2)]">By contributor</div>
                {data.by_contributor.map(c => (
                  <div key={c.contributor} className="flex items-center justify-between text-[13px]">
                    <span className="text-[var(--muted)]">{c.contributor}</span>
                    <span className="font-semibold tabular-nums text-[#cbd5e1]">{ugx(c.amount_ugx)}</span>
                  </div>
                ))}
              </div>
            )}

            {data.records.length === 0 && (
              <p className="py-6 text-center text-xs text-[var(--muted-2)]">No capital recorded yet. Start logging who funded the CapEx.</p>
            )}
            <div className="space-y-2">
              {data.records.map(r => <CapRow key={r.id} r={r} />)}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
