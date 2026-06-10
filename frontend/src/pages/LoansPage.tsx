import { useQuery } from '@tanstack/react-query'

interface LoanHeader {
  id: string
  member: string
  date: string
  principal: string
  interest_pct: string
  interest_cash: string
  total_to_pay: string
  due_date: string
  days_remaining: string
  amount_paid: string
  balance: string
}

interface Payment {
  date: string
  amount_paid: string
  month: string
  interest_paid: string
  balance: string
}

interface LoansData {
  loan: LoanHeader | Record<string, never>
  payments: Payment[]
}

function ProgressBar({ paid, total }: { paid: string; total: string }) {
  const p = parseInt(paid.replace(/,/g, '')) || 0
  const t = parseInt(total.replace(/,/g, '')) || 1
  const pct = Math.min(100, Math.round((p / t) * 100))
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span style={{ color: 'var(--text-muted)' }}>Repayment progress</span>
        <span style={{ color: pct === 100 ? '#4ade80' : '#f1f5f9' }}>{pct}%</span>
      </div>
      <div className="rounded-full h-2 overflow-hidden" style={{ background: '#1e293b' }}>
        <div className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: pct === 100 ? '#22c55e' : '#3b82f6' }} />
      </div>
    </div>
  )
}

export default function LoansPage() {
  const { data, isLoading } = useQuery<LoansData>({
    queryKey: ['loans'],
    queryFn: () => fetch('/api/loans', { credentials: 'include' }).then(r => r.json()),
  })

  if (isLoading) return <p className="text-xs text-center py-10" style={{ color: 'var(--text-muted)' }}>Loading...</p>

  const loan = data?.loan as LoanHeader | undefined
  const payments = data?.payments || []

  if (!loan || !loan.id) {
    return (
      <div className="max-w-2xl md:max-w-5xl mx-auto">
        <div className="rounded-xl p-8 text-center" style={{ background: 'var(--bg-card)' }}>
          <div className="text-3xl mb-2">🏦</div>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No active loans at this time.</p>
        </div>
      </div>
    )
  }

  const daysNum = parseInt(loan.days_remaining)
  // A fully repaid loan (balance <= 0) is settled — don't flag it "overdue".
  const balanceNum = parseFloat(String(loan.balance).replace(/[^\d.-]/g, ''))
  const settled = !Number.isNaN(balanceNum) && balanceNum <= 0
  const daysColor = settled ? '#4ade80' : daysNum < 0 ? '#f87171' : daysNum <= 14 ? '#fbbf24' : '#4ade80'

  return (
    <div className="max-w-2xl md:max-w-5xl mx-auto space-y-4">
      {/* Loan summary card */}
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)' }}>
        <div className="flex justify-between items-start mb-3">
          <div>
            <div className="font-semibold" style={{ color: '#f1f5f9' }}>{loan.member}</div>
            <div className="text-xs" style={{ color: '#64748b' }}>Issued {loan.date}</div>
          </div>
          <span className="text-xs px-2 py-1 rounded-full font-semibold"
            style={{ color: daysColor, background: daysColor + '22' }}>
            {settled ? 'Settled ✓' : daysNum < 0 ? `${Math.abs(daysNum)}d overdue` : daysNum === 0 ? 'Due today' : `${daysNum}d left`}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          {([
            ['Principal', `UGX ${loan.principal}`],
            ['Interest (3%/mo × 3)', `UGX ${loan.interest_cash}`],
            ['Total to Repay', `UGX ${loan.total_to_pay}`],
            ['Due Date', loan.due_date],
            ['Amount Paid', `UGX ${loan.amount_paid}`],
            ['Balance', `UGX ${loan.balance}`],
          ] as [string, string][]).map(([label, val]) => (
            <div key={label}>
              <div className="text-[10px] mb-0.5" style={{ color: '#64748b' }}>{label}</div>
              <div className="text-sm font-semibold" style={{ color: label === 'Balance' ? '#f87171' : '#e2e8f0' }}>
                {val}
              </div>
            </div>
          ))}
        </div>

        <ProgressBar paid={loan.amount_paid} total={loan.total_to_pay} />
      </div>

      {/* Payment history */}
      {payments.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)' }}>
          <h3 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
            Payment History ({payments.length})
          </h3>
          <div className="space-y-0 overflow-hidden rounded-lg" style={{ border: '1px solid var(--border)' }}>
            {payments.map((p, i) => (
              <div key={i} className="flex justify-between items-center px-3 py-2.5 text-xs"
                style={{ borderBottom: i < payments.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div>
                  <span style={{ color: '#cbd5e1' }}>{p.month || p.date}</span>
                  {p.interest_paid && (
                    <span className="ml-2" style={{ color: '#64748b' }}>incl. UGX {p.interest_paid} interest</span>
                  )}
                </div>
                <div className="text-right">
                  <div style={{ color: '#4ade80' }}>UGX {p.amount_paid}</div>
                  {p.balance && <div style={{ color: '#64748b' }}>bal: UGX {p.balance}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
