import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'

const ADMIN_USERS = ['Hillary', 'Hellen']

interface Summary {
  as_at: string
  opening_balance: number
  total_contributions_paid: number
  total_loan_payments: number
  total_expenditure: number
  computed_balance: number
  confirmed_bank_balance: number
  confirmed_balance_date: string
  current_obligations: number
  opening_obligations: number
}

interface FamilyBalance {
  family_name: string
  composition: string
  current_monthly_rate: number
  current_balance: number
  initial_balance: number
  combined_balance: number
}

interface PendingPayment {
  id: number
  family_name: string
  amount_ugx: number
  period_month: string
  payment_reference: string
  submitted_by_user_id: string
  submitted_at: string
  receipt_url?: string
}

const ugx = (v: number) => 'UGX ' + Math.abs(v || 0).toLocaleString()

function ReconciliationBadge({ confirmed, computed }: { confirmed: number; computed: number }) {
  const gap = confirmed - computed
  const abs = Math.abs(gap)
  let icon: string, label: string, color: string, bg: string
  if (abs <= 10_000) {
    icon = '✓'; label = 'In sync'; color = '#4ade80'; bg = '#14532d33'
  } else if (abs <= 100_000) {
    icon = '⚠'; label = `${gap >= 0 ? '+' : ''}UGX ${gap.toLocaleString()} (likely bank charges or rounding)`
    color = '#fbbf24'; bg = '#78350f33'
  } else {
    icon = '⚠'; label = `${gap >= 0 ? '+' : ''}UGX ${gap.toLocaleString()} out of sync. Check expenses and unconfirmed payments.`
    color = '#fca5a5'; bg = '#7f1d1d33'
  }
  return (
    <div className="flex items-start gap-2 rounded-lg px-3 py-2 mt-2 text-xs" style={{ background: bg }}>
      <span style={{ color, fontSize: 14 }}>{icon}</span>
      <div>
        <div className="font-semibold" style={{ color: '#cbd5e1' }}>Reconciliation</div>
        <div style={{ color }}>{label}</div>
      </div>
    </div>
  )
}

function FamilyCard({ f }: { f: FamilyBalance }) {
  const rate = f.current_monthly_rate || 0
  const curBal = f.current_balance || 0
  const initBal = f.initial_balance || 0
  const outstanding = curBal <= 0 ? initBal : f.combined_balance
  const borderCol = outstanding === 0 ? '#166534' : outstanding <= rate * 3 ? '#d97706' : '#dc2626'

  const mStatus = curBal < 0
    ? <span style={{ color: '#4ade80' }}>UGX {Math.abs(curBal).toLocaleString()} credit</span>
    : curBal === 0
    ? <span style={{ color: '#4ade80' }}>Up to date</span>
    : <span style={{ color: '#f87171' }}>UGX {curBal.toLocaleString()} owed</span>

  const iStatus = initBal > 0
    ? <span style={{ color: '#fbbf24' }}>UGX {initBal.toLocaleString()} owed</span>
    : <span style={{ color: '#4ade80' }}>Cleared</span>

  return (
    <div className="rounded-xl p-3" style={{ background: '#1e293b', border: `1px solid ${borderCol}` }}>
      <div className="flex justify-between items-baseline mb-0.5">
        <span className="font-bold text-sm" style={{ color: '#f1f5f9' }}>{f.family_name}</span>
        <span className="text-[11px]" style={{ color: '#64748b' }}>UGX {rate.toLocaleString()}/mo</span>
      </div>
      <div className="text-[11px] mb-2" style={{ color: '#475569' }}>
        {f.composition}
      </div>
      <div className="flex justify-between text-xs mb-1">
        <span style={{ color: 'var(--text-muted)' }}>Monthly</span>
        {mStatus}
      </div>
      <div className="flex justify-between text-xs mb-1">
        <span style={{ color: 'var(--text-muted)' }}>Initial (2023)</span>
        {iStatus}
      </div>
      <div className="flex justify-between text-xs font-semibold mt-2">
        <span style={{ color: 'var(--text-muted)' }}>Total outstanding</span>
        {outstanding === 0
          ? <span style={{ color: '#4ade80' }}>Nothing owed</span>
          : <span style={{ color: '#f87171' }}>UGX {outstanding.toLocaleString()}</span>
        }
      </div>
    </div>
  )
}

function SubmitPaymentModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [family, setFamily] = useState(user?.name || '')
  const [amount, setAmount] = useState('')
  const [period, setPeriod] = useState('')
  const [ref, setRef] = useState('')
  const [alloc, setAlloc] = useState('monthly')
  const [file, setFile] = useState<File | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const FAMILIES = ['Alex', 'Israel', 'Max', 'Solomon', 'Viola', 'Hellen', 'Priscilla']

  const submit = async () => {
    setErr('')
    const amt = parseInt(amount.replace(/[^0-9]/g, '')) || 0
    if (!family) return setErr('Select a family.')
    if (!amt || amt <= 0) return setErr('Enter a valid amount.')
    if (!period) return setErr('Select a period.')
    setBusy(true)
    try {
      const r = await fetch('/api/contributions/submit', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ family_name: family, amount_ugx: amt, period_month: period, payment_reference: ref, allocation_type: alloc }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        setErr(j.detail || 'Submission failed.')
        setBusy(false)
        return
      }
      const j = await r.json()
      if (file) {
        const fd = new FormData(); fd.append('file', file)
        await fetch(`/api/contributions/${j.submission_id}/receipt`, { method: 'POST', credentials: 'include', body: fd })
      }
      qc.invalidateQueries({ queryKey: ['contributions-summary'] })
      qc.invalidateQueries({ queryKey: ['contributions-ledger'] })
      onClose()
    } catch {
      setErr('Network error. Try again.')
      setBusy(false)
    }
  }

  const months: string[] = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(); d.setMonth(d.getMonth() - i)
    months.push(d.toISOString().slice(0, 7))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-md rounded-2xl p-5 space-y-3" style={{ background: 'var(--bg-card)' }}>
        <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Submit a Payment</h2>

        <div className="rounded-xl p-3 text-center mb-2" style={{ background: '#0a2a14', border: '1px solid #166534' }}>
          <div className="text-xs mb-1" style={{ color: '#94a3b8' }}>Pay to ABSA Uganda</div>
          <div className="text-xl font-bold tracking-widest" style={{ color: '#22c55e' }}>6004961127</div>
          <div className="text-sm mt-1" style={{ color: '#cbd5e1' }}>TUSIIME HELLEN</div>
        </div>

        <select value={family} onChange={e => setFamily(e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm"
          style={{ background: '#0f172a', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
          <option value="">Select family...</option>
          {FAMILIES.map(f => <option key={f} value={f}>{f}</option>)}
        </select>

        <input
          type="text" inputMode="numeric" placeholder="Amount (UGX)"
          value={amount}
          onChange={e => { const raw = e.target.value.replace(/[^0-9]/g, ''); setAmount(raw ? parseInt(raw).toLocaleString() : '') }}
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: '#0f172a', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        />

        <select value={period} onChange={e => setPeriod(e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm"
          style={{ background: '#0f172a', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
          <option value="">Period (month)...</option>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        <select value={alloc} onChange={e => setAlloc(e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm"
          style={{ background: '#0f172a', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
          <option value="monthly">Monthly contribution</option>
          <option value="initial_obligation">Initial obligation (2023)</option>
        </select>

        <input type="text" placeholder="Payment reference (optional)" value={ref}
          onChange={e => setRef(e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: '#0f172a', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        />

        <div>
          <label className="text-xs block mb-1" style={{ color: 'var(--text-muted)' }}>Receipt (optional)</label>
          <input type="file" accept="image/*,.pdf" onChange={e => setFile(e.target.files?.[0] || null)}
            className="text-xs w-full" style={{ color: 'var(--text-muted)' }} />
        </div>

        {err && <p className="text-xs" style={{ color: 'var(--accent-red)' }}>{err}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 rounded-lg py-2.5 text-sm"
            style={{ background: '#1e293b', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
            {t('common.cancel')}
          </button>
          <button onClick={submit} disabled={busy} className="flex-2 rounded-lg py-2.5 text-sm font-semibold disabled:opacity-60"
            style={{ flex: 2, background: '#166534', color: '#fff' }}>
            {busy ? 'Submitting...' : t('common.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function FinancesPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const isAdmin = ADMIN_USERS.includes(user?.name || '')
  const [showPayment, setShowPayment] = useState(false)

  const { data: summary, isLoading: summLoading } = useQuery<Summary>({
    queryKey: ['contributions-summary'],
    queryFn: () => fetch('/api/contributions/summary', { credentials: 'include' }).then(r => r.json()),
  })

  const { data: ledger } = useQuery<FamilyBalance[]>({
    queryKey: ['contributions-ledger'],
    queryFn: () => fetch('/api/contributions/ledger', { credentials: 'include' }).then(r => r.json()),
  })

  const { data: pending } = useQuery<PendingPayment[]>({
    queryKey: ['contributions-pending'],
    queryFn: () => fetch('/api/contributions/pending', { credentials: 'include' }).then(r => r.ok ? r.json() : []),
    enabled: isAdmin,
  })

  if (summLoading) return <div className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</div>

  return (
    <div className="max-w-2xl md:max-w-5xl mx-auto space-y-4">

      {/* Admin: pending confirmations */}
      {isAdmin && pending && pending.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid #f59e0b' }}>
          <h3 className="font-semibold mb-3" style={{ color: '#f59e0b' }}>
            Pending Confirmations ({pending.length})
          </h3>
          <div className="space-y-3">
            {pending.map(p => (
              <div key={p.id} className="rounded-lg p-3" style={{ border: '1px solid var(--border)' }}>
                <div className="flex justify-between mb-1">
                  <strong style={{ color: '#f1f5f9' }}>{p.family_name}</strong>
                  <span style={{ color: '#22c55e' }}>{ugx(p.amount_ugx)}</span>
                </div>
                <div className="text-xs mb-2" style={{ color: '#94a3b8' }}>
                  Period: {p.period_month} · By: {p.submitted_by_user_id} on {p.submitted_at?.slice(0, 10)}
                </div>
                {p.receipt_url && (
                  <a href={p.receipt_url} target="_blank" rel="noreferrer"
                    className="text-xs" style={{ color: '#22c55e' }}>View receipt ↗</a>
                )}
                <div className="flex gap-2 mt-2">
                  <button onClick={() => fetch(`/api/contributions/${p.id}/review`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm' }) })}
                    className="flex-1 rounded-lg py-2 text-sm font-medium" style={{ background: '#166534', color: '#fff' }}>
                    Confirm
                  </button>
                  <button onClick={() => fetch(`/api/contributions/${p.id}/review`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reject' }) })}
                    className="flex-1 rounded-lg py-2 text-sm font-medium" style={{ background: '#991b1b', color: '#fff' }}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary card */}
      {summary && (
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)' }}>
          <h3 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
            Club Finances — as at {summary.as_at}
          </h3>
          {([
            ['Opening Balance (Jan 2023)', summary.opening_balance, ''],
            ['Total Contributions Collected', summary.total_contributions_paid, '#22c55e'],
            ['+ Loan Repayments Received', summary.total_loan_payments, '#86efac'],
            ['- Total Expenditure', summary.total_expenditure, ''],
          ] as [string, number, string][]).map(([label, val, color]) => (
            <div key={label} className="flex justify-between text-sm py-1.5" style={{ borderBottom: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text-muted)' }}>{label}</span>
              <span style={{ color: color || 'var(--text-primary)' }}>{ugx(val)}</span>
            </div>
          ))}
          <div className="flex justify-between text-sm py-1.5 mt-1">
            <span style={{ color: 'var(--text-muted)' }}>Expected Balance</span>
            <span style={{ color: '#cbd5e1' }}>{ugx(summary.computed_balance)}</span>
          </div>
          <div className="flex justify-between items-center py-1.5 mt-1">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Confirmed Bank Balance (ABSA)</span>
            <span className="text-lg font-bold" style={{ color: '#22c55e' }}>{ugx(summary.confirmed_bank_balance)}</span>
          </div>
          <div className="text-xs mb-1" style={{ color: '#64748b' }}>
            Confirmed {summary.confirmed_balance_date} · Hellen (Treasurer)
          </div>
          <ReconciliationBadge confirmed={summary.confirmed_bank_balance} computed={summary.computed_balance} />
          <div className="flex justify-between text-sm py-1.5 mt-3" style={{ borderTop: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Outstanding Obligations</span>
            <span style={{ color: '#f87171' }}>{ugx(summary.current_obligations)}</span>
          </div>
        </div>
      )}

      {/* Pay to */}
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)' }}>
        <h3 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Pay to Account</h3>
        <div className="rounded-xl p-4 text-center mb-4" style={{ background: '#0a2a14', border: '1px solid #166534' }}>
          <div className="text-xs mb-1" style={{ color: '#94a3b8' }}>ABSA Uganda</div>
          <div className="text-2xl font-bold tracking-widest" style={{ color: '#22c55e' }}>6004961127</div>
          <div className="text-sm mt-1" style={{ color: '#cbd5e1' }}>TUSIIME HELLEN</div>
        </div>
        <button onClick={() => setShowPayment(true)}
          className="w-full rounded-xl py-3 font-semibold text-sm"
          style={{ background: '#166534', color: '#fff' }}>
          {t('finances.submitPayment')}
        </button>
      </div>

      {/* Family ledger */}
      {ledger && ledger.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)' }}>
          <h3 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
            {t('finances.family')} {t('finances.balance')}s
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {ledger.map(f => <FamilyCard key={f.family_name} f={f} />)}
          </div>
        </div>
      )}

      {showPayment && <SubmitPaymentModal onClose={() => setShowPayment(false)} />}
    </div>
  )
}
