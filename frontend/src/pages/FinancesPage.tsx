import CrossLinks from '../components/CrossLinks'
import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import ExpenditurePage from './ExpenditurePage'
import { FAMILY_HEAD_AVATAR } from '../data/familyTree'

// Member → family name mapping (matches backend _MEMBER_FAMILY_NAME)
const MEMBER_FAMILY: Record<string, string> = {
  Hillary: 'ARINDAS', Esther: 'ARINDAS',
  Viola: 'ARUNGAS', Simon: 'ARUNGAS',
  Israel: 'KIKANGIS', Merab: 'KIKANGIS',
  Max: 'TURAMYES', Janet: 'TURAMYES',
  Solomon: 'ARIHOS',
  Hellen: 'KOFUNAS', Lawi: 'KOFUNAS',
  Alex: 'TUHIMBISES', Priscilla: 'TUHIMBISES',
}


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

interface ArrearsMonth {
  month: string        // "2026-07"
  label: string        // "Jul 2026"
  amount_owed: number
  due_date: string     // "2026-08-10"
  overdue?: boolean    // past its 10th deadline
}
interface ArrearsDetail {
  paid_through: string | null
  paid_through_label: string | null
  arrears_months: ArrearsMonth[]
  total_arrears: number
  next_due: ArrearsMonth | null
}
interface FamilyBalance {
  family_id: number
  family_name: string
  composition: string
  current_monthly_rate: number
  current_balance: number
  initial_balance: number
  combined_balance: number
  arrears_detail?: ArrearsDetail
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

interface FamilyPayment {
  id: number
  period_month: string
  amount_ugx: number
  payment_reference: string | null
  receipt_photo_path: string | null
  receipt_url: string | null
  status: 'pending' | 'confirmed' | 'rejected'
  confirmation_note: string | null
  submitted_at: string
  confirmed_at: string | null
}

const ugx = (v: number) => 'UGX ' + Math.abs(v || 0).toLocaleString()

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/**
 * If currentBalance < 0 (credit) and monthlyRate > 0, returns the calendar
 * month+year the family is paid up to — e.g. "Jun 2026". Otherwise null.
 * Ported from the original vanilla JS paidToLabel() in index.html.
 */
function paidToLabel(currentBalance: number, monthlyRate: number): string | null {
  if (!monthlyRate || currentBalance >= 0) return null
  const ahead = Math.floor(Math.abs(currentBalance) / monthlyRate)
  if (ahead <= 0) return null
  const today = new Date()
  let y = today.getFullYear(), m = today.getMonth()
  // Start from previous month (last fully closed month)
  if (m === 0) { m = 11; y-- } else { m-- }
  m += ahead
  while (m > 11) { m -= 12; y++ }
  return MONTHS[m] + ' ' + y
}

/** "2026-09-10" -> "10 Sep 2026". */
function fmtDue(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  return `${day} ${MONTHS[m - 1]} ${y}`
}

/** N consecutive month labels starting at "YYYY-MM" -> "Aug 2026, Sep 2026". */
function monthsFrom(startYm: string, n: number): string {
  const [y0, m0] = startYm.split('-').map(Number)
  const out: string[] = []
  let y = y0, m = m0
  for (let i = 0; i < n; i++) { out.push(`${MONTHS[m - 1]} ${y}`); m++; if (m > 12) { m = 1; y++ } }
  return out.join(', ')
}

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

function FamilyAvatar({ familyName, size = 36 }: { familyName: string; size?: number }) {
  const [err, setErr] = useState(false)
  const key = FAMILY_HEAD_AVATAR[familyName.toUpperCase()]
  const initial = familyName.charAt(0).toUpperCase()
  if (err || !key) {
    return (
      <div style={{ width: size, height: size, borderRadius: '50%', background: '#1e3a5f', border: '2px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.38, fontWeight: 700, color: '#64748b', flexShrink: 0 }}>
        {initial}
      </div>
    )
  }
  return (
    <img src={`/static/avatars/${key}.jpg`} onError={() => setErr(true)} alt={familyName}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '2px solid #334155', flexShrink: 0 }} />
  )
}

// Toaster messages per balance status — personalized but deterministic
function toastMessage(familyLabel: string, curBal: number, rate: number, outstanding: number): string {
  const name = familyLabel  // e.g. "The Arindas"
  const paidTo = paidToLabel(curBal, rate)
  if (outstanding === 0 && curBal <= 0) {
    const msgs = [
      `${name} are fully paid up${paidTo ? ` to ${paidTo}` : ''}! You're ahead of the curve. The club thanks you 🏆`,
      `Nothing owed and ${paidTo ? `paid to ${paidTo}` : 'all clear'}! ${name} are keeping the club healthy 💚`,
      `All clear! ${name} are setting the standard this month. Keep going 🌟`,
    ]
    return msgs[Math.floor(Date.now() / 1000) % msgs.length]
  }
  if (outstanding > 0 && outstanding <= rate) {
    return `Almost there! ${name} are just UGX ${outstanding.toLocaleString()} away from being all clear this month. One quick transfer does it 💪`
  }
  if (outstanding > 0 && outstanding <= rate * 3) {
    return `${name} have UGX ${outstanding.toLocaleString()} outstanding. A steady payment now keeps the club moving forward — every contribution matters 🤝`
  }
  return `${name} have UGX ${outstanding.toLocaleString()} outstanding. The club's growth depends on everyone keeping up — please reach out to Hellen if you need a payment plan 💛`
}

function FamilyCard({ f, isMyFamily, onPay }: { f: FamilyBalance; isMyFamily: boolean; onOpen?: () => void; onPay?: (familyId: number, amount: number) => void }) {
  const rate = f.current_monthly_rate || 0
  const curBal = f.current_balance || 0
  const initBal = f.initial_balance || 0
  const outstanding = curBal <= 0 ? initBal : f.combined_balance
  const borderCol = outstanding === 0 ? '#166534' : outstanding <= rate * 3 ? '#d97706' : '#dc2626'
  const glowCol   = outstanding === 0 ? '#22c55e' : outstanding <= rate * 3 ? '#f59e0b' : '#ef4444'

  const [showToast, setShowToast] = useState(false)
  const [toastDismissed, setToastDismissed] = useState(false)
  const [showCalc, setShowCalc] = useState(false)
  const [calcMonths, setCalcMonths] = useState(0)
  const [showPayments, setShowPayments] = useState(false)
  const [payments, setPayments] = useState<FamilyPayment[]>([])
  const [loadingPayments, setLoadingPayments] = useState(false)

  // Show toaster shortly after mount for the logged-in user's card
  useEffect(() => {
    if (!isMyFamily || toastDismissed) return
    const t = setTimeout(() => setShowToast(true), 1200)
    return () => clearTimeout(t)
  }, [isMyFamily, toastDismissed])

  // Auto-dismiss toast after 6 seconds
  useEffect(() => {
    if (!showToast) return
    const t = setTimeout(() => { setShowToast(false); setToastDismissed(true) }, 6000)
    return () => clearTimeout(t)
  }, [showToast])

  const familyLabel = 'The ' + f.family_name.charAt(0) + f.family_name.slice(1).toLowerCase()

  const paidTo = paidToLabel(curBal, rate)
  const mStatus = paidTo
    ? <span style={{ color: '#4ade80', fontWeight: 600 }}>Paid to {paidTo}</span>
    : curBal < 0
    ? <span style={{ color: '#4ade80' }}>UGX {Math.abs(curBal).toLocaleString()} credit</span>
    : curBal === 0
    ? <span style={{ color: '#4ade80' }}>Up to date</span>
    : <span style={{ color: '#f87171' }}>UGX {curBal.toLocaleString()} owed</span>

  const iStatus = initBal > 0
    ? <span style={{ color: '#fbbf24' }}>UGX {initBal.toLocaleString()} owed</span>
    : <span style={{ color: '#4ade80' }}>Cleared</span>

  // ── Payment History loader ──
  const loadPayments = async () => {
    if (payments.length > 0 || loadingPayments) return
    setLoadingPayments(true)
    try {
      const r = await fetch(`/api/contributions/family/${f.family_id}`, { credentials: 'include' })
      if (r.ok) {
        const data = await r.json()
        setPayments(data.payments || [])
      }
    } catch {}
    setLoadingPayments(false)
  }

  // ── Calculator ──
  const calcArrears = Math.max(0, curBal)
  const calcExistingCredit = Math.max(0, -curBal)
  const calcOpening = Math.max(0, initBal)
  const calcAdditionalAhead = Math.max(0, calcMonths * rate - calcExistingCredit)
  const calcTotal = calcArrears + calcOpening + calcAdditionalAhead
  const ad = f.arrears_detail
  const arrearsMonthsLabel = ad && ad.arrears_months.length
    ? ` (${ad.arrears_months.map(a => a.label).join(', ')})` : ''
  // Name only the months this payment ACTUALLY buys (calcAdditionalAhead / rate),
  // starting at the first uncovered month (next_due). Existing credit already
  // absorbs the earlier ones, so naming all calcMonths would list covered months.
  const aheadStart = ad?.next_due?.month
  const additionalMonths = rate > 0 ? Math.max(0, Math.round(calcAdditionalAhead / rate)) : 0
  const aheadNames = (additionalMonths > 0 && aheadStart) ? ` (${monthsFrom(aheadStart, additionalMonths)})` : ''
  const aheadCount = `${calcMonths} month${calcMonths > 1 ? 's' : ''} ahead`
  const calcRows: [string, string, string][] = []
  if (calcArrears > 0) calcRows.push([`Clear monthly arrears${arrearsMonthsLabel}`, `UGX ${calcArrears.toLocaleString()}`, '#f87171'])
  if (calcOpening > 0) calcRows.push(['Clear opening balance', `UGX ${calcOpening.toLocaleString()}`, '#fbbf24'])
  if (calcExistingCredit > 0) calcRows.push(['Existing credit (already paid ahead)', `− UGX ${calcExistingCredit.toLocaleString()}`, '#a5b4fc'])
  if (calcMonths > 0 && calcAdditionalAhead > 0) calcRows.push([`${aheadCount}${aheadNames}`, `UGX ${calcAdditionalAhead.toLocaleString()}`, '#86efac'])
  if (calcMonths > 0 && calcAdditionalAhead === 0) calcRows.push([aheadCount, 'Already covered ✓', '#4ade80'])

  const payLabel = (ym: string) => {
    const [y, m] = ym.split('-').map(Number)
    return new Date(y, m - 1, 1).toLocaleString('default', { month: 'short', year: 'numeric' })
  }

  const statusBadge = (status: string) => {
    const map: Record<string, [string, string]> = {
      confirmed: ['#14532d', '#4ade80'],
      rejected:  ['#450a0a', '#fca5a5'],
      pending:   ['#2d1b69', '#c4b5fd'],
    }
    const [background, color] = map[status] ?? ['#1e293b', '#94a3b8']
    return <span style={{ background, color, padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600 }}>{status}</span>
  }

  return (
    <>
      {/* Animated border keyframe injected once */}
      <style>{`
        @keyframes familyCardGlow {
          0%,100% { box-shadow: 0 0 0 0 ${glowCol}00, 0 0 16px 2px ${glowCol}22; }
          50%      { box-shadow: 0 0 0 4px ${glowCol}22, 0 0 28px 6px ${glowCol}55; }
        }
        @keyframes toastIn  { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes toastOut { from { opacity:1; } to { opacity:0; } }
      `}</style>

      <div
        className="rounded-xl p-3"
        style={{
          background: '#1e293b',
          border: `1px solid ${borderCol}`,
          cursor: 'default',
          animation: isMyFamily ? `familyCardGlow 2.5s ease-in-out infinite` : undefined,
          position: 'relative',
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <FamilyAvatar familyName={f.family_name} size={38} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="flex justify-between items-baseline">
              <span className="font-bold text-sm" style={{ color: '#f1f5f9' }}>
                {f.family_name}
                {isMyFamily && <span style={{ marginLeft: 5, fontSize: 10, color: borderCol }}>● you</span>}
              </span>
              <span className="text-[11px]" style={{ color: '#64748b' }}>UGX {rate.toLocaleString()}/mo</span>
            </div>
            <div className="text-[10px]" style={{ color: '#475569' }}>{f.composition}</div>
          </div>
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

        {/* Which months are owed, and when the next one is due */}
        {ad && (ad.arrears_months.length > 0 || ad.next_due || ad.paid_through_label) && (
          <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.5 }}>
            {ad.arrears_months.length > 0 && (
              <div style={{ color: '#f87171' }}>
                Owed: {ad.arrears_months.map(a => `${a.label} (${a.overdue ? 'overdue since' : 'due'} ${fmtDue(a.due_date)})`).join(', ')}
              </div>
            )}
            {ad.arrears_months.length === 0 && ad.paid_through_label && (
              <div style={{ color: '#4ade80' }}>Paid through {ad.paid_through_label}</div>
            )}
            {ad.next_due && (
              <div style={{ color: '#94a3b8' }}>
                Next: UGX {ad.next_due.amount_owed.toLocaleString()} for {ad.next_due.label}, due {fmtDue(ad.next_due.due_date)}
              </div>
            )}
          </div>
        )}

        {/* Calculator toggle */}
        <button onClick={() => { setShowCalc(!showCalc); if (!showCalc) setCalcMonths(0) }}
          style={{
            marginTop: 10, width: '100%', background: '#0f172a', color: showCalc ? '#f59e0b' : '#94a3b8',
            border: `1px solid ${showCalc ? '#f59e0b' : '#334155'}`, borderRadius: 7, padding: 7,
            fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
          }}>
          🧮 Payment Calculator
        </button>

      {/* ── Calculator expanded ── */}
      {showCalc && (
        <div style={{ marginTop: 8, background: '#0f172a', borderRadius: 7, padding: 10 }}>
          {/* Stepper */}
          <div className="flex items-center justify-between mb-2">
            <span style={{ color: '#94a3b8', fontSize: 12 }}>Months ahead:</span>
            <div className="flex items-center gap-2">
              <button onClick={(e) => { e.stopPropagation(); setCalcMonths(Math.max(0, calcMonths - 1)) }}
                style={{ background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155', borderRadius: 6, width: 30, height: 30, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                −
              </button>
              <span style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 18, minWidth: 28, textAlign: 'center' }}>{calcMonths}</span>
              <button onClick={(e) => { e.stopPropagation(); setCalcMonths(calcMonths + 1) }}
                style={{ background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155', borderRadius: 6, width: 30, height: 30, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                +
              </button>
            </div>
          </div>

          {/* Breakdown rows */}
          {calcRows.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {calcRows.map(([label, value, color]) => (
                <div key={label} className="flex justify-between py-1.5 text-xs" style={{ borderBottom: '1px solid #1e293b' }}>
                  <span style={{ color: '#94a3b8' }}>{label}</span>
                  <span style={{ color, fontWeight: 600 }}>{value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Total */}
          {calcTotal > 0 && (
            <div className="flex justify-between items-center pt-2 mt-1" style={{ borderTop: '1px solid #334155' }}>
              <span style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 13 }}>Total</span>
              <span style={{ color: '#22c55e', fontWeight: 700, fontSize: 15 }}>UGX {calcTotal.toLocaleString()}</span>
            </div>
          )}

          {/* Pay button (only if onPay callback provided) */}
          {calcTotal > 0 && onPay && (
            <button onClick={(e) => { e.stopPropagation(); onPay(f.family_id, calcTotal) }}
              style={{
                marginTop: 10, width: '100%', background: '#166534', color: '#fff',
                border: 'none', borderRadius: 8, padding: '10px 0',
                fontSize: 13, fontWeight: 700, cursor: 'pointer'
              }}>
              Pay UGX {calcTotal.toLocaleString()} →
            </button>
          )}
        </div>
      )}

        {/* Payment History toggle */}
        <button onClick={() => { setShowPayments(!showPayments); if (!showPayments) loadPayments() }}
          style={{
            marginTop: 6, width: '100%', background: '#0f172a', color: showPayments ? '#60a5fa' : '#94a3b8',
            border: `1px solid ${showPayments ? '#60a5fa' : '#334155'}`, borderRadius: 7, padding: 7,
            fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
          }}>
          📋 Payment History
        </button>

      {/* ── Payment History expanded ── */}
      {showPayments && (
        <div style={{ marginTop: 8, background: '#0f172a', borderRadius: 7, padding: 10, maxHeight: 300, overflowY: 'auto' }}>
          {loadingPayments ? (
            <div style={{ textAlign: 'center', color: '#64748b', fontSize: 12, padding: 10 }}>
              <span className="animate-pulse">Loading payments...</span>
            </div>
          ) : payments.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, padding: 10 }}>
              No payment history for this family.
            </div>
          ) : (
            payments.map((p, i) => (
              <div key={p.id} style={{
                padding: '8px 0',
                borderBottom: i < payments.length - 1 ? '1px solid #1e293b' : 'none',
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 600 }}>
                    UGX {Math.abs(p.amount_ugx).toLocaleString()}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    {payLabel(p.period_month)} · {p.submitted_at?.slice(0, 10)}
                    {p.payment_reference ? ` · ${p.payment_reference}` : ''}
                  </div>
                  {/* Rejection reason */}
                  {p.confirmation_note && (
                    <div style={{ marginTop: 4, fontSize: 11, color: '#fca5a5', background: '#450a0a33', padding: '4px 8px', borderRadius: 6, borderLeft: '2px solid #f87171' }}>
                      {p.confirmation_note}
                    </div>
                  )}
                  {/* Receipt link — receipts are stored in receipt_url (newer flow);
                       receipt_photo_path is the legacy column kept as a fallback. */}
                  {(p.receipt_url || p.receipt_photo_path)
                    ? (
                      <a href={p.receipt_url || p.receipt_photo_path || '#'} target="_blank" rel="noreferrer"
                        style={{ fontSize: 11, color: '#22c55e', marginTop: 2, display: 'inline-block' }}
                        onClick={e => e.stopPropagation()}>
                        View receipt ↗
                      </a>
                    )
                    : p.status === 'confirmed' && (
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>No receipt on file</div>
                    )}
                </div>
                {statusBadge(p.status)}
              </div>
            ))
          )}
        </div>
      )}

      </div>

      {/* AI-style toaster for logged-in user's card */}
      {isMyFamily && showToast && (
        <div
          onClick={() => { setShowToast(false); setToastDismissed(true) }}
          style={{
            position: 'fixed', bottom: 90, left: 12, right: 12, zIndex: 999,
            background: borderCol === '#166534' ? '#052e16' : borderCol === '#d97706' ? '#431407' : '#450a0a',
            border: `1px solid ${borderCol}`,
            borderRadius: 14, padding: '12px 14px',
            boxShadow: `0 4px 24px ${borderCol}44`,
            animation: 'toastIn 0.35s ease-out',
            cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 12, lineHeight: 1.5, color: borderCol === '#166534' ? '#4ade80' : borderCol === '#d97706' ? '#fbbf24' : '#fca5a5' }}>
            {toastMessage(familyLabel, curBal, rate, outstanding)}
          </div>
          <div style={{ fontSize: 10, marginTop: 4, color: '#475569' }}>Tap to dismiss</div>
        </div>
      )}

    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBMIT PAYMENT — 3-STEP WIZARD
//
// Ported faithfully from the vanilla JS app (old-index.html, ~lines 1350–1825).
//
// API CONTRACT (POST /api/contributions/submit):
//   family_id:            int      — from /api/contributions/ledger
//   amount_ugx:           int
//   payment_reference:    str|null
//   declared_through:     str|null — YYYY-MM, last month explicitly covered (Case 3 only)
//   apply_to_initial_ugx: int      — UGX of excess to apply to opening balance
//   → returns { payment_id, status }
//
// POST /api/contributions/{payment_id}/receipt  — attach bank screenshot
//
// ALLOCATION CASES (determined by preview.current_balance vs amount):
//   Case 1: current_balance > 0  AND  amount < current_balance
//     → partial arrears payment, FIFO auto-allocation, no step 2
//   Case 2: current_balance > 0  AND  amount >= current_balance
//     → clears arrears; user splits excess between opening-balance and future monthly
//   Case 3: current_balance <= 0
//     → monthly is current; user picks which months to cover +
//       optionally applies some UGX to the opening balance (initial_balance)
//
// PREVIEW endpoint: GET /api/contributions/family/{id}/preview
//   returns: current_balance, initial_balance, combined_balance,
//            current_monthly_rate, suggested_period (YYYY-MM of oldest unpaid month)
// ─────────────────────────────────────────────────────────────────────────────

interface PayPreview {
  family_id: number
  family_name: string
  combined_balance: number
  initial_balance: number
  current_balance: number
  current_monthly_rate: number
  suggested_period: string
}

interface LedgerFamily { family_id: number; family_name: string }

function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' })
}

function SubmitPaymentModal({ onClose, initFamilyId, initAmount }: { onClose: () => void; initFamilyId?: number; initAmount?: number }) {
  const qc = useQueryClient()

  // ── step state ──
  type Step = 1 | 2 | 3
  const [step, setStep] = useState<Step>(1)

  // ── step 1 state ──
  const [familyId, setFamilyId]   = useState<number | null>(null)
  const [amountRaw, setAmountRaw] = useState('')
  const [ref, setRef]             = useState('')
  const [file, setFile]           = useState<File | null>(null)
  const [preview, setPreview]     = useState<PayPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // ── step 2 (Case 2) — excess allocation ──
  const [excessToInit, setExcessToInit] = useState(0)

  // ── step 2 (Case 3) — month picker ──
  const [selectedMonths, setSelectedMonths] = useState<string[]>([])
  const [initChoice, setInitChoice]         = useState(0)

  // ── submission ──
  const [busy, setBusy]       = useState(false)
  const [err, setErr]         = useState('')
  const [success, setSuccess] = useState<{amount: number; paymentId: number} | null>(null)

  const { data: ledger = [] } = useQuery<LedgerFamily[]>({
    queryKey: ['contributions-ledger'],
    queryFn:  () => fetch('/api/contributions/ledger', { credentials: 'include' }).then(r => r.json()),
    staleTime: 30_000,
  })

  // Pre-fill from calculator
  useEffect(() => {
    if (initFamilyId) setFamilyId(initFamilyId)
    if (initAmount) setAmountRaw(initAmount.toLocaleString())
    if (initFamilyId && initAmount) {
      setPreviewLoading(true)
      fetch(`/api/contributions/family/${initFamilyId}/preview?amount=${initAmount}`, { credentials: 'include' })
        .then(r => r.json()).then(setPreview).catch(() => setPreview(null))
        .finally(() => setPreviewLoading(false))
    }
  }, [])

  const amount = parseInt(amountRaw.replace(/[^0-9]/g, '')) || 0

  // fetch preview whenever family or amount changes
  const loadPreview = async (fid: number) => {
    setPreviewLoading(true)
    try {
      const p: PayPreview = await fetch(
        `/api/contributions/family/${fid}/preview?amount=${amount}`,
        { credentials: 'include' }
      ).then(r => r.json())
      setPreview(p)
    } catch { setPreview(null) }
    setPreviewLoading(false)
  }

  const onFamilyChange = (fid: number) => {
    setFamilyId(fid)
    setPreview(null)
    if (fid) loadPreview(fid)
  }

  const onAmountChange = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '')
    setAmountRaw(digits ? parseInt(digits).toLocaleString() : '')
    if (familyId && digits) {
      const fid = familyId, amt = parseInt(digits)
      fetch(`/api/contributions/family/${fid}/preview?amount=${amt}`, { credentials: 'include' })
        .then(r => r.json()).then(setPreview).catch(() => {})
    }
  }

  // coverage hint shown below amount input
  const coverageHint = (() => {
    if (!preview || !amount) return null
    const { combined_balance: bal, current_monthly_rate: rate } = preview
    if (bal > 0) {
      if (amount < bal) return { bg: '#431407', color: '#fed7aa', text: `Reduces balance from UGX ${bal.toLocaleString()} to UGX ${(bal - amount).toLocaleString()}.` }
      if (amount === bal) return { bg: '#052e16', color: '#86efac', text: 'Clears the full balance. New balance: UGX 0.' }
      const ahead = amount - bal
      return { bg: '#052e16', color: '#86efac', text: `Clears full balance + UGX ${ahead.toLocaleString()} paid in advance (${(ahead / rate).toFixed(1)} months ahead).` }
    }
    const can = Math.floor(amount / rate)
    return { bg: '#1e3a5f', color: '#93c5fd', text: `Covers up to ${can} month${can !== 1 ? 's' : ''}. Choose months on the next step.` }
  })()

  // ── NEXT (step 1 → 2 or 3) ──
  const goNext = () => {
    setErr('')
    if (!familyId) return setErr('Select a family.')
    if (!amount) return setErr('Enter an amount.')
    if (!file) return setErr('Attach a bank or MoMo screenshot. Hellen needs it to verify.')
    if (!preview) return setErr('Loading family balance, please try again.')
    const curBal = preview.current_balance
    if (curBal > 0 && amount < curBal) {
      // Case 1: partial arrears → skip allocation, go to review
      setStep(3)
    } else if (curBal > 0 && amount >= curBal) {
      // Case 2: clears arrears, show excess panel
      setExcessToInit(0)
      setStep(2)
    } else {
      // Case 3: monthly current, show month picker
      setSelectedMonths([])
      setInitChoice(0)
      setStep(2)
    }
  }

  // ── Case 3: affordable months from suggested_period ──
  const affordableMonths = (() => {
    if (!preview || (preview.current_balance > 0)) return []
    const rate = preview.current_monthly_rate
    const existingCredit = Math.max(0, -(preview.current_balance))
    const alreadyCovered = Math.floor(existingCredit / rate)
    const creditRem = existingCredit - alreadyCovered * rate
    const remaining = amount - initChoice
    const pool = remaining + creditRem
    const max = Math.floor(pool / rate)
    const [sy, sm] = preview.suggested_period.split('-').map(Number)
    let y = sy, m = sm
    for (let i = 0; i < alreadyCovered; i++) { m++; if (m > 12) { m = 1; y++ } }
    const months: string[] = []
    for (let i = 0; i < max; i++) {
      months.push(`${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}`)
      m++; if (m > 12) { m = 1; y++ }
    }
    return months
  })()

  const toggleMonth = (mo: string) => {
    setSelectedMonths(prev =>
      prev.includes(mo) ? prev.filter(x => x !== mo) : [...prev, mo].sort()
    )
  }

  // ── step 2 → step 3 (review) ──
  const goReview = () => {
    setErr('')
    const curBal = preview?.current_balance ?? 0
    if (curBal <= 0 && selectedMonths.length === 0 && amount - initChoice > 0) {
      if (initChoice > 0) return setErr(`UGX ${(amount - initChoice).toLocaleString()} unallocated. Select months or increase opening balance amount.`)
      return setErr('Select at least one month to continue.')
    }
    setStep(3)
  }

  // ── SUBMIT ──
  const doSubmit = async () => {
    if (!familyId || !amount || !preview) return
    setBusy(true); setErr('')
    try {
      const curBal = preview.current_balance
      const declaredThrough = (curBal <= 0 && selectedMonths.length > 0)
        ? selectedMonths[selectedMonths.length - 1]
        : null
      const applyToInitial = curBal > 0
        ? excessToInit
        : initChoice

      const r = await fetch('/api/contributions/submit', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          family_id: familyId,
          amount_ugx: amount,
          payment_reference: ref.trim() || null,
          declared_through: declaredThrough,
          apply_to_initial_ugx: applyToInitial,
        }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        setErr(j.detail || 'Submission failed.')
        setBusy(false); return
      }
      const { payment_id } = await r.json()
      if (file) {
        const fd = new FormData(); fd.append('file', file)
        await fetch(`/api/contributions/${payment_id}/receipt`, {
          method: 'POST', credentials: 'include', body: fd
        }).catch(() => {})
      }
      qc.invalidateQueries({ queryKey: ['contributions-summary'] })
      qc.invalidateQueries({ queryKey: ['contributions-ledger'] })
      setSuccess({ amount, paymentId: payment_id })
    } catch {
      setErr('Network error. Try again.')
    }
    setBusy(false)
  }

  const sel = (value: string, onChange: (v: string) => void, children: React.ReactNode) => (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full rounded-lg px-3 py-2.5 text-sm"
      style={{ background: '#0f172a', color: '#f1f5f9', border: '1px solid #334155' }}>
      {children}
    </select>
  )

  const inp = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
      style={{ background: '#0f172a', color: '#f1f5f9', border: '1px solid #334155' }} />
  )

  const initBal    = preview?.initial_balance ?? 0
  const curBal     = preview?.current_balance ?? 0
  const rate       = preview?.current_monthly_rate ?? 0
  const isCase2    = curBal > 0 && amount >= curBal
  const excess     = isCase2 ? amount - curBal : 0
  const _maxInitEx  = Math.min(excess, initBal); void _maxInitEx

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-md rounded-t-2xl flex flex-col" style={{ background: '#0d1829', border: '1px solid #334155', maxHeight: '94vh' }}>

        {/* header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3" style={{ borderBottom: '1px solid #1e293b' }}>
          <div>
            <div className="font-bold text-base" style={{ color: '#f1f5f9' }}>Submit a Payment</div>
            <div className="text-xs mt-0.5" style={{ color: '#475569' }}>
              Step {step} of 3 — {step === 1 ? 'Details' : step === 2 ? 'Allocate' : 'Review'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: '#1e293b', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', color: '#64748b' }}>✕</button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">

          {/* ── STEP 1 ── */}
          {step === 1 && (
            <>
              {/* bank account */}
              <div className="rounded-xl p-3 text-center" style={{ background: '#0a2a14', border: '1px solid #166534' }}>
                <div className="text-xs mb-1" style={{ color: '#94a3b8' }}>Pay to ABSA Uganda</div>
                <div className="text-2xl font-bold tracking-widest" style={{ color: '#22c55e' }}>6004961127</div>
                <div className="text-sm mt-1" style={{ color: '#cbd5e1' }}>TUSIIME HELLEN</div>
              </div>

              {/* family */}
              <div>
                {sel(
                  String(familyId ?? ''),
                  v => onFamilyChange(parseInt(v)),
                  <>
                    <option value="">Select family...</option>
                    {ledger.map(f => (
                      <option key={f.family_id} value={f.family_id}>
                        {'The ' + f.family_name.charAt(0) + f.family_name.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </>
                )}
                {/* balance hint */}
                {previewLoading && <p className="text-xs mt-1" style={{ color: '#64748b' }}>Loading balance...</p>}
                {preview && !previewLoading && (
                  <div className="mt-1.5 rounded-lg px-3 py-2 text-xs space-y-0.5" style={{ background: '#1e293b' }}>
                    {preview.combined_balance > 0 ? (
                      <>
                        {curBal > 0 && <div style={{ color: '#94a3b8' }}>Monthly arrears: UGX {curBal.toLocaleString()}</div>}
                        {initBal > 0 && <div style={{ color: '#94a3b8' }}>Opening owed: UGX {initBal.toLocaleString()}</div>}
                        <div style={{ color: '#f87171', fontWeight: 600 }}>Balance owed: UGX {preview.combined_balance.toLocaleString()}</div>
                      </>
                    ) : preview.combined_balance < 0 ? (
                      <div style={{ color: '#34d399', fontWeight: 600 }}>Paid ahead — UGX {Math.abs(preview.combined_balance).toLocaleString()} in credit</div>
                    ) : (
                      <div style={{ color: '#34d399' }}>All contributions up to date.</div>
                    )}
                    <div style={{ color: '#64748b' }}>Monthly rate: UGX {rate.toLocaleString()}/month</div>
                  </div>
                )}
              </div>

              {/* amount */}
              <div>
                {inp({
                  type: 'text', inputMode: 'numeric', placeholder: 'Amount (UGX)',
                  value: amountRaw,
                  onChange: e => onAmountChange(e.target.value),
                })}
                {coverageHint && (
                  <div className="mt-1.5 rounded-lg px-3 py-2 text-xs" style={{ background: coverageHint.bg, color: coverageHint.color }}>
                    {coverageHint.text}
                  </div>
                )}
              </div>

              {/* reference */}
              {inp({ type: 'text', placeholder: 'Payment reference (optional)', value: ref, onChange: e => setRef(e.target.value) })}

              {/* receipt — required */}
              <div>
                <label className="block text-xs mb-1.5" style={{ color: file ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                  Receipt — bank/MoMo screenshot {!file && '(required)'}
                </label>
                <label className="flex items-center gap-2 rounded-lg px-3 py-2.5 cursor-pointer text-sm"
                  style={{ background: '#1e293b', border: `1px solid ${file ? '#22c55e' : '#dc2626'}`, color: file ? '#22c55e' : '#94a3b8' }}>
                  📎 {file ? file.name : 'Attach bank or MoMo screenshot'}
                  <input type="file" accept="image/*,.pdf" className="sr-only" onChange={e => setFile(e.target.files?.[0] || null)} />
                </label>
              </div>
            </>
          )}

          {/* ── STEP 2 — Case 2: excess allocation ── */}
          {step === 2 && isCase2 && (
            <>
              <div className="rounded-lg px-3 py-2 text-sm" style={{ background: '#1e293b' }}>
                <div style={{ color: '#f1f5f9', fontWeight: 600 }}>UGX {amount.toLocaleString()}</div>
                <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>
                  Clears monthly arrears of UGX {curBal.toLocaleString()}. You have UGX {excess.toLocaleString()} extra.
                </div>
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: '#64748b' }}>
                  Opening balance owed: {initBal > 0 ? `UGX ${initBal.toLocaleString()}` : 'None'}
                </div>
                {inp({
                  type: 'text', inputMode: 'numeric',
                  placeholder: initBal > 0 ? `Apply to opening balance (max UGX ${Math.min(excess, initBal).toLocaleString()})` : 'No opening balance owed',
                  disabled: initBal <= 0,
                  value: excessToInit > 0 ? excessToInit.toLocaleString() : '',
                  onChange: e => {
                    const v = Math.min(parseInt(e.target.value.replace(/[^0-9]/g, '')) || 0, Math.min(excess, initBal))
                    setExcessToInit(v)
                  }
                })}
                <div className="mt-1.5 rounded-lg px-3 py-2 text-xs" style={{ background: '#1e3a5f' }}>
                  <div style={{ color: '#93c5fd' }}>Arrears cleared: UGX {curBal.toLocaleString()}</div>
                  {excessToInit > 0 && <div style={{ color: '#fbbf24' }}>Opening balance: UGX {excessToInit.toLocaleString()}</div>}
                  <div style={{ color: '#a5b4fc' }}>Future monthly credit: UGX {(excess - excessToInit).toLocaleString()}</div>
                </div>
              </div>
            </>
          )}

          {/* ── STEP 2 — Case 3: month picker ── */}
          {step === 2 && !isCase2 && (
            <>
              <div className="rounded-lg px-3 py-2 text-sm" style={{ background: '#1e293b' }}>
                <div style={{ color: '#f1f5f9', fontWeight: 600 }}>UGX {amount.toLocaleString()}</div>
                <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>
                  {affordableMonths.length} month{affordableMonths.length !== 1 ? 's' : ''} available.
                  {initChoice > 0 && ` (UGX ${initChoice.toLocaleString()} to opening balance)`}
                </div>
              </div>

              {/* optional initial balance payment */}
              {initBal > 0 && (
                <div>
                  <div className="text-xs mb-1.5" style={{ color: '#64748b' }}>Opening balance owed: UGX {initBal.toLocaleString()}</div>
                  {inp({
                    type: 'text', inputMode: 'numeric',
                    placeholder: `Apply to opening balance (max UGX ${Math.min(amount, initBal).toLocaleString()})`,
                    value: initChoice > 0 ? initChoice.toLocaleString() : '',
                    onChange: e => {
                      const v = Math.min(parseInt(e.target.value.replace(/[^0-9]/g, '')) || 0, Math.min(amount, initBal))
                      setInitChoice(v)
                      setSelectedMonths(prev => prev.filter(mo => affordableMonths.includes(mo)))
                    }
                  })}
                </div>
              )}

              {/* month toggle buttons */}
              {affordableMonths.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs" style={{ color: '#64748b' }}>Select months to cover:</div>
                  {affordableMonths.map(mo => (
                    <button key={mo} onClick={() => toggleMonth(mo)}
                      className="w-full flex justify-between items-center rounded-lg px-3 py-3 text-sm text-left"
                      style={{
                        background: selectedMonths.includes(mo) ? '#0a2a14' : '#1e293b',
                        color: selectedMonths.includes(mo) ? '#86efac' : '#94a3b8',
                        border: `1px solid ${selectedMonths.includes(mo) ? '#22c55e' : '#334155'}`,
                      }}>
                      <span>{monthLabel(mo)}</span>
                      <span style={{ fontSize: 12, color: '#64748b' }}>UGX {rate.toLocaleString()}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* running split */}
              {(selectedMonths.length > 0 || initChoice > 0) && (() => {
                const monthly = selectedMonths.length * rate
                const rem = amount - monthly
                return (
                  <div className="rounded-lg px-3 py-2 text-xs space-y-1" style={{ background: '#1e293b' }}>
                    {monthly > 0 && <div className="flex justify-between"><span style={{ color: '#94a3b8' }}>Monthly ({selectedMonths.length} mo)</span><span style={{ color: '#86efac', fontWeight: 600 }}>UGX {monthly.toLocaleString()}</span></div>}
                    {initChoice > 0 && <div className="flex justify-between"><span style={{ color: '#94a3b8' }}>Opening balance</span><span style={{ color: '#fbbf24', fontWeight: 600 }}>UGX {initChoice.toLocaleString()}</span></div>}
                    {rem > 0 && rem !== initChoice && <div className="flex justify-between"><span style={{ color: '#94a3b8' }}>Extra credit</span><span style={{ color: '#a5b4fc', fontWeight: 600 }}>UGX {(rem - initChoice).toLocaleString()}</span></div>}
                    <div className="flex justify-between pt-1" style={{ borderTop: '1px solid #334155' }}><span style={{ color: '#f1f5f9', fontWeight: 600 }}>Total</span><span style={{ color: '#f1f5f9', fontWeight: 600 }}>UGX {amount.toLocaleString()}</span></div>
                  </div>
                )
              })()}
            </>
          )}

          {/* ── STEP 3 — Review ── */}
          {step === 3 && preview && (() => {
            const fam = ledger.find(f => f.family_id === familyId)
            const famName = fam ? 'The ' + fam.family_name.charAt(0) + fam.family_name.slice(1).toLowerCase() : ''
            const row = (lbl: string, val: string, color = '#f1f5f9') => (
              <div key={lbl} className="flex justify-between py-1.5 text-sm" style={{ borderBottom: '1px solid #1e293b' }}>
                <span style={{ color: '#94a3b8' }}>{lbl}</span>
                <span style={{ color, fontWeight: 600 }}>{val}</span>
              </div>
            )
            const curBal3 = preview.current_balance
            const isArrears = curBal3 > 0 && amount < curBal3
            const newBal = preview.combined_balance - amount

            return (
              <div>
                <div className="rounded-xl p-4 space-y-0" style={{ background: '#1e293b' }}>
                  <div className="font-semibold text-sm mb-3" style={{ color: '#f1f5f9' }}>Payment Summary</div>
                  {row('Family', famName)}
                  {row('Amount', 'UGX ' + amount.toLocaleString())}
                  {ref && row('Reference', ref, '#a5b4fc')}
                  {isCase2 && <>
                    {row('Monthly arrears cleared', 'UGX ' + curBal3.toLocaleString(), '#86efac')}
                    {excessToInit > 0 && row('Opening balance', 'UGX ' + excessToInit.toLocaleString() + ' applied', '#fbbf24')}
                    {row('Future monthly credit', 'UGX ' + (excess - excessToInit).toLocaleString(), '#a5b4fc')}
                  </>}
                  {!isCase2 && selectedMonths.length > 0 && <>
                    {row('Monthly obligations', `UGX ${(selectedMonths.length * rate).toLocaleString()} (${selectedMonths.length} month${selectedMonths.length > 1 ? 's' : ''}, to ${monthLabel(selectedMonths[selectedMonths.length - 1])})`, '#86efac')}
                    {initChoice > 0 && row('Opening balance', 'UGX ' + initChoice.toLocaleString() + ' applied', '#fbbf24')}
                  </>}
                  {isArrears && <>
                    {newBal > 0 && row('Balance after', 'UGX ' + newBal.toLocaleString() + ' still owed', '#f87171')}
                    {newBal === 0 && row('Balance after', 'Fully cleared', '#22c55e')}
                    <div className="text-xs pt-1" style={{ color: '#475569' }}>Applied FIFO to oldest unpaid months first.</div>
                  </>}
                  {file && <div className="text-xs pt-2" style={{ color: '#64748b' }}>Receipt: {file.name}</div>}
                </div>
                <div className="mt-2 rounded-lg px-3 py-2 text-xs text-center" style={{ background: '#1e1b4b', color: '#a5b4fc' }}>
                  Pay to: ABSA Uganda 6004961127 (TUSIIME HELLEN)
                </div>
              </div>
            )
          })()}

          {/* success */}
          {success && (
            <div className="rounded-xl p-4 text-center" style={{ background: '#052e16', border: '1px solid #166534' }}>
              <div className="text-2xl mb-2">✓</div>
              <div style={{ color: '#4ade80', fontWeight: 700 }}>UGX {success.amount.toLocaleString()} submitted!</div>
              <div className="text-xs mt-1" style={{ color: '#64748b' }}>Payment #{success.paymentId} — awaiting Hellen's confirmation.</div>
            </div>
          )}

          {err && <p className="text-xs rounded-lg px-3 py-2" style={{ background: '#450a0a', color: '#fca5a5' }}>{err}</p>}
        </div>

        {/* footer buttons */}
        <div className="px-5 py-4 flex gap-2" style={{ borderTop: '1px solid #1e293b' }}>
          {success ? (
            <button onClick={onClose} className="flex-1 rounded-xl py-3 font-semibold text-sm" style={{ background: '#166534', color: '#fff' }}>Done</button>
          ) : (
            <>
              <button
                onClick={() => { setErr(''); step === 1 ? onClose() : setStep((step - 1) as Step) }}
                className="flex-1 rounded-xl py-3 text-sm"
                style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }}>
                {step === 1 ? 'Cancel' : '← Back'}
              </button>
              {step < 3 && (
                <button onClick={step === 1 ? goNext : goReview}
                  className="rounded-xl py-3 text-sm font-semibold"
                  style={{ flex: 2, background: '#1d4ed8', color: '#fff' }}>
                  Next →
                </button>
              )}
              {step === 3 && (
                <button onClick={doSubmit} disabled={busy}
                  className="rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
                  style={{ flex: 2, background: '#166534', color: '#fff' }}>
                  {busy ? 'Submitting...' : 'Confirm & Submit'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── My Submissions — member's own payment history ──────────────────────────
// API: GET /api/contributions/my-submissions
// Shows last 8 payments, status badges, rejected reason + Resubmit button.
interface Submission {
  id: number; period_month: string; amount_ugx: number; payment_reference: string | null
  status: 'pending' | 'confirmed' | 'rejected'; confirmation_note: string | null
  submitted_at: string; receipt_url: string | null; submitted_by_user_id: string | null
}
interface MySubsResponse { family_id: number | null; family_name: string | null; payments: Submission[] }

function MySubmissions() {
  const qc = useQueryClient()
  const { data } = useQuery<MySubsResponse>({
    queryKey: ['my-submissions'],
    queryFn: () => fetch('/api/contributions/my-submissions', { credentials: 'include' }).then(r => r.json()),
    staleTime: 30_000,
  })
  const payments = data?.payments ?? []
  const actionableRejected = payments.filter((p, i) =>
    p.status === 'rejected' && !payments.slice(0, i).some(q => q.status !== 'rejected')
  )

  if (!data?.family_id || payments.length === 0) return null

  const StatusBadge = ({ status }: { status: string }) => {
    const map: Record<string, [string, string]> = {
      confirmed: ['#14532d', '#4ade80'],
      rejected:  ['#450a0a', '#fca5a5'],
      pending:   ['#2d1b69', '#c4b5fd'],
    }
    const [bg, color] = map[status] ?? ['#1e293b', '#94a3b8']
    return <span style={{ background: bg, color, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{status}</span>
  }

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid #334155' }}>
      <h3 className="font-semibold mb-3 text-sm" style={{ color: '#f1f5f9' }}>
        My Submissions — {data.family_name ? 'The ' + data.family_name.charAt(0) + data.family_name.slice(1).toLowerCase() : ''}
      </h3>

      {actionableRejected.length > 0 && (
        <div className="rounded-lg px-3 py-2 mb-3 text-xs" style={{ background: '#450a0a', color: '#fca5a5' }}>
          ⚠ {actionableRejected.length} payment{actionableRejected.length > 1 ? 's' : ''} rejected. Review the reason and resubmit.
        </div>
      )}

      <div className="space-y-0">
        {payments.slice(0, 8).map((p, idx) => {
          const isActionableReject = p.status === 'rejected' && !payments.slice(0, idx).some(q => q.status !== 'rejected')
          return (
            <div key={p.id}
              style={{
                padding: '10px 0',
                borderBottom: idx < Math.min(payments.length, 8) - 1 ? '1px solid #1e293b' : 'none',
                borderLeft: isActionableReject ? '3px solid #f87171' : 'none',
                paddingLeft: isActionableReject ? 10 : 0,
                display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 6,
              }}
            >
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: 13, color: '#f1f5f9' }}>UGX {Math.abs(p.amount_ugx).toLocaleString()}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                  {p.submitted_at?.slice(0, 10)}{p.payment_reference ? ` · Ref: ${p.payment_reference}` : ''}
                </div>
                {p.confirmation_note && (
                  <div style={{ marginTop: 4, padding: '5px 8px', background: '#450a0a', borderLeft: '3px solid #f87171', borderRadius: '0 6px 6px 0', fontSize: 11, color: '#fca5a5' }}>
                    Reason: {p.confirmation_note}
                  </div>
                )}
                {isActionableReject && (
                  <button
                    onClick={() => qc.invalidateQueries({ queryKey: ['my-submissions'] })}
                    style={{ marginTop: 8, background: '#166534', color: '#4ade80', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Resubmit →
                  </button>
                )}
              </div>
              <StatusBadge status={p.status} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// POST /api/contributions/admin/bank-balance  { balance_ugx, note }
// Only admins (role=admin). Records the physical ABSA balance Hellen sees in the app.
function UpdateBankBalanceModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [amtRaw, setAmtRaw] = useState('')
  const [note, setNote]     = useState('')
  const [err, setErr]       = useState('')
  const [busy, setBusy]     = useState(false)

  const submit = async () => {
    const balance_ugx = parseInt(amtRaw.replace(/[^0-9]/g, '')) || 0
    if (!balance_ugx) return setErr('Enter the current ABSA balance.')
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/contributions/admin/bank-balance', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance_ugx, note: note.trim() || null }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        setErr(j.detail || 'Failed to update balance.')
        setBusy(false); return
      }
      onSaved()
    } catch { setErr('Network error.') }
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <div className="w-full max-w-md rounded-t-2xl p-5 space-y-3" style={{ background: '#0d1829', border: '1px solid #334155' }}>
        <div className="flex justify-between items-center">
          <div className="font-bold" style={{ color: '#f1f5f9' }}>Update Bank Balance</div>
          <button onClick={onClose} style={{ background: '#1e293b', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', color: '#64748b' }}>✕</button>
        </div>
        <p className="text-xs" style={{ color: '#94a3b8' }}>
          Enter the actual ABSA balance as shown in your banking app. This confirms the physical balance so the reconciliation gap is up to date.
        </p>
        <input type="text" inputMode="numeric" placeholder="ABSA balance (UGX)"
          value={amtRaw}
          onChange={e => { const d = e.target.value.replace(/[^0-9]/g, ''); setAmtRaw(d ? parseInt(d).toLocaleString() : '') }}
          className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
          style={{ background: '#0f172a', color: '#f1f5f9', border: '1px solid #334155' }}
        />
        <input type="text" placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)}
          className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
          style={{ background: '#0f172a', color: '#f1f5f9', border: '1px solid #334155' }}
        />
        {err && <p className="text-xs rounded-lg px-3 py-2" style={{ background: '#450a0a', color: '#fca5a5' }}>{err}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 rounded-xl py-3 text-sm"
            style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }}>Cancel</button>
          <button onClick={submit} disabled={busy}
            className="rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
            style={{ flex: 2, background: '#b45309', color: '#fff' }}>
            {busy ? 'Saving...' : 'Save Balance'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PendingConfirmations({ pending, onDone }: { pending: PendingPayment[]; onDone: () => void }) {
  const [busy, setBusy] = useState<number | null>(null)
  const [rejectId, setRejectId] = useState<number | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [err, setErr] = useState('')

  const review = async (id: number, action: 'confirm' | 'reject', note?: string) => {
    setBusy(id); setErr('')
    try {
      const r = await fetch(`/api/contributions/${id}/${action}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note || null }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        setErr(j.detail || `Failed to ${action}.`)
      } else {
        setRejectId(null); setRejectNote(''); onDone()
      }
    } catch { setErr('Network error.') }
    setBusy(null)
  }

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid #f59e0b' }}>
      <h3 className="font-semibold mb-3" style={{ color: '#f59e0b' }}>
        Pending Confirmations ({pending.length})
      </h3>
      {err && <p className="text-xs mb-2 rounded px-2 py-1" style={{ background: '#450a0a', color: '#fca5a5' }}>{err}</p>}
      <div className="space-y-3">
        {pending.map(p => (
          <div key={p.id} className="rounded-lg p-3" style={{ border: '1px solid #334155' }}>
            <div className="flex justify-between mb-1">
              <strong style={{ color: '#f1f5f9' }}>
                {'The ' + p.family_name.charAt(0) + p.family_name.slice(1).toLowerCase()}
              </strong>
              <span style={{ color: '#22c55e', fontWeight: 700 }}>{ugx(p.amount_ugx)}</span>
            </div>
            <div className="text-xs mb-2" style={{ color: '#94a3b8' }}>
              Period: {p.period_month}
              {p.submitted_by_user_id ? ` · Submitted by ${p.submitted_by_user_id}` : ''}
              {p.submitted_at ? ` on ${p.submitted_at.slice(0, 10)}` : ''}
              {p.payment_reference ? ` · Ref: ${p.payment_reference}` : ''}
            </div>
            {p.receipt_url && (
              <a href={p.receipt_url} target="_blank" rel="noreferrer"
                className="text-xs block mb-2" style={{ color: '#22c55e' }}>
                View receipt ↗
              </a>
            )}

            {/* reject reason input (shown when reject tapped) */}
            {rejectId === p.id && (
              <div className="mb-2">
                <input
                  autoFocus
                  type="text"
                  placeholder="Reason for rejection (optional)"
                  value={rejectNote}
                  onChange={e => setRejectNote(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none mb-1"
                  style={{ background: '#0f172a', color: '#f1f5f9', border: '1px solid #7f1d1d' }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => review(p.id, 'reject', rejectNote)}
                    disabled={busy === p.id}
                    className="flex-1 rounded-lg py-2 text-sm font-semibold disabled:opacity-50"
                    style={{ background: '#991b1b', color: '#fff' }}>
                    {busy === p.id ? 'Rejecting…' : 'Confirm Rejection'}
                  </button>
                  <button
                    onClick={() => { setRejectId(null); setRejectNote('') }}
                    className="rounded-lg py-2 px-4 text-sm"
                    style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {rejectId !== p.id && (
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => review(p.id, 'confirm')}
                  disabled={busy === p.id}
                  className="flex-1 rounded-lg py-2 text-sm font-semibold disabled:opacity-50"
                  style={{ background: '#166534', color: '#fff' }}>
                  {busy === p.id ? 'Confirming…' : '✓ Confirm'}
                </button>
                <button
                  onClick={() => { setRejectId(p.id); setRejectNote('') }}
                  disabled={busy === p.id}
                  className="flex-1 rounded-lg py-2 text-sm font-semibold disabled:opacity-50"
                  style={{ background: '#1e293b', color: '#f87171', border: '1px solid #7f1d1d' }}>
                  ✕ Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function FinancesPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const qc = useQueryClient()
  const isAdmin = user?.role === 'admin'
  const myFamilyName = user?.name ? MEMBER_FAMILY[user.name] ?? null : null
  const [showPayment, setShowPayment]         = useState(false)
  const [showBankBalance, setShowBankBalance] = useState(false)
  const [payTarget, setPayTarget] = useState<{ familyId: number; amount: number } | null>(null)

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
      <CrossLinks links={[{ to: '/equity', label: '⚖️ Equity' }, { to: '/loans', label: '🏦 Loans' }, { to: '/expenditure', label: '💸 Expenditure' }]} />

      {/* Admin: pending confirmations */}
      {isAdmin && pending && pending.length > 0 && (
        <PendingConfirmations pending={pending} onDone={() => {
          qc.invalidateQueries({ queryKey: ['contributions-pending'] })
          qc.invalidateQueries({ queryKey: ['contributions-summary'] })
          qc.invalidateQueries({ queryKey: ['contributions-ledger'] })
        }} />
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
          <div className="flex justify-between items-center mb-1">
            <div className="text-xs" style={{ color: '#64748b' }}>
              Confirmed {summary.confirmed_balance_date} · Hellen (Treasurer)
            </div>
            {isAdmin && (
              <button onClick={() => setShowBankBalance(true)}
                className="text-xs rounded-lg px-3 py-1 font-semibold"
                style={{ background: '#b45309', color: '#fff', border: 'none', cursor: 'pointer' }}>
                Update
              </button>
            )}
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
        <button
          data-tour="submit-payment"
          onClick={() => { setShowPayment(true); setPayTarget(null) }}
          className="w-full rounded-xl py-3 font-semibold text-sm"
          style={{ background: '#166534', color: '#fff' }}>
          {t('finances.submitPayment')}
        </button>
      </div>

      {/* My Submissions — member's own payment history */}
      <MySubmissions />

      {/* Family ledger */}
      {ledger && ledger.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)' }}>
          <h3 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
            {t('finances.family')} {t('finances.balance')}s
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {ledger.map(f => (
              <FamilyCard
                key={f.family_name}
                f={f}
                isMyFamily={myFamilyName !== null && f.family_name.toUpperCase() === myFamilyName}
                onOpen={() => {}}
                onPay={(fid, amt) => { setPayTarget({ familyId: fid, amount: amt }); setShowPayment(true) }} />
            ))}
          </div>
        </div>
      )}

      {/* Expenditure — also accessible via More → Expenditure */}
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)' }}>
        <ExpenditurePage />
      </div>

      {showPayment && (
        <SubmitPaymentModal
          onClose={() => { setShowPayment(false); setPayTarget(null) }}
          initFamilyId={payTarget?.familyId}
          initAmount={payTarget?.amount}
        />
      )}
      {showBankBalance && (
        <UpdateBankBalanceModal
          onClose={() => setShowBankBalance(false)}
          onSaved={() => { setShowBankBalance(false); qc.invalidateQueries({ queryKey: ['contributions-summary'] }) }}
        />
      )}
    </div>
  )
}
