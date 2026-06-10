import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Inset } from '@/components/ui/card'
import { LoadingRow } from '@/components/ui/spinner'
import { ugx } from '@/lib/utils'

interface IncomeRecord {
  id: number
  date: string
  amount_ugx: number
  received_from: string
  collector: string
  txn_ref: string
  notes: string
  recorded_at: string
}
interface IncomeResponse {
  total_ugx: number
  count: number
  records: IncomeRecord[]
}

const todayISO = () => new Date().toISOString().slice(0, 10)
const onlyDigits = (s: string) => s.replace(/[^\d]/g, '')
const groupDigits = (s: string) => (s ? Number(onlyDigits(s)).toLocaleString('en-US') : '')

function AddIncomeForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ pin: '', date: todayISO(), amount: '', collector: '', received_from: '', txn_ref: '', notes: '' })
  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }))

  const mut = useMutation({
    mutationFn: () =>
      fetch('/api/washing-bay/income', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: form.pin,
          date: form.date,
          amount_ugx: Number(onlyDigits(form.amount)),
          received_from: form.received_from,
          collector: form.collector,
          txn_ref: form.txn_ref,
          notes: form.notes,
        }),
      }).then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Failed to save')
        return r.json()
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wb-income'] })
      onDone()
    },
  })

  const valid = form.pin && form.date && onlyDigits(form.amount) && form.collector
  const field = 'h-10 w-full rounded-[10px] border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-2)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]'

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="mb-1 block text-[11px] text-[var(--muted-2)]">Date</label>
          <input type="date" className={field} value={form.date} onChange={e => set('date', e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-[var(--muted-2)]">Amount (UGX)</label>
          <input type="text" inputMode="numeric" className={field} placeholder="0" value={groupDigits(form.amount)} onChange={e => set('amount', e.target.value)} />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-[11px] text-[var(--muted-2)]">Collector *</label>
        <input className={field} placeholder="Who received the money" value={form.collector} onChange={e => set('collector', e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="mb-1 block text-[11px] text-[var(--muted-2)]">Received from</label>
          <input className={field} placeholder="Optional" value={form.received_from} onChange={e => set('received_from', e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-[var(--muted-2)]">Txn ref</label>
          <input className={field} placeholder="Optional" value={form.txn_ref} onChange={e => set('txn_ref', e.target.value)} />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-[11px] text-[var(--muted-2)]">Notes</label>
        <input className={field} placeholder="Optional" value={form.notes} onChange={e => set('notes', e.target.value)} />
      </div>
      <div>
        <label className="mb-1 block text-[11px] text-[var(--muted-2)]">PIN *</label>
        <input type="password" inputMode="numeric" className={field} placeholder="Required to record income" value={form.pin} onChange={e => set('pin', onlyDigits(e.target.value))} />
      </div>
      {mut.isError && <p className="text-xs text-[var(--danger)]">{(mut.error as Error).message}</p>}
      <div className="flex gap-2 pt-1">
        <Button variant="ghost" className="flex-1" onClick={onDone}>Cancel</Button>
        <Button variant="success" className="flex-1" disabled={!valid || mut.isPending} onClick={() => mut.mutate()}>
          {mut.isPending ? 'Saving…' : 'Record income'}
        </Button>
      </div>
    </div>
  )
}

export function WashingBayIncome() {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)

  const { data, isLoading } = useQuery<IncomeResponse>({
    queryKey: ['wb-income'],
    queryFn: () => fetch('/api/washing-bay/income', { credentials: 'include' }).then(r => r.json()),
    enabled: open,
  })

  return (
    <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) setAdding(false) }}>
      <DialogTrigger asChild>
        <Button variant="subtle" size="sm" className="flex-1">🧾 Income</Button>
      </DialogTrigger>
      <DialogContent title="🚗 Washing Bay Income" subtitle="Recorded collections">
        {isLoading || !data ? (
          <LoadingRow label="Loading income records…" />
        ) : adding ? (
          <AddIncomeForm onDone={() => setAdding(false)} />
        ) : (
          <div>
            <Inset className="mb-3 flex items-center justify-between p-3.5">
              <div>
                <div className="text-[11px] text-[var(--muted-2)]">Total recorded ({data.count})</div>
                <div className="text-lg font-bold text-[var(--success)]">{ugx(data.total_ugx)}</div>
              </div>
              <Button variant="success" size="sm" onClick={() => setAdding(true)}>+ Record</Button>
            </Inset>

            {data.records.length === 0 && (
              <p className="py-6 text-center text-xs text-[var(--muted-2)]">No income recorded yet.</p>
            )}
            <div className="space-y-2">
              {data.records.map(r => (
                <Inset key={r.id} className="p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-[var(--foreground)]">{ugx(r.amount_ugx)}</span>
                    <span className="text-[11px] text-[var(--muted-2)]">{r.date}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                    {r.collector}{r.received_from ? ` · from ${r.received_from}` : ''}{r.txn_ref ? ` · ref ${r.txn_ref}` : ''}
                  </div>
                  {r.notes && <div className="mt-0.5 text-[11px] text-[var(--muted-2)]">{r.notes}</div>}
                </Inset>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
