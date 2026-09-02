import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { LoadingRow } from '@/components/ui/spinner'
import { TrendingUp, TriangleAlert, Users, Info } from 'lucide-react'
import { ugx } from '@/lib/utils'

/** Projects that have a structured investment projection (mirrors investment.py INVESTMENT_TERMS). */
export const PROJECTABLE = new Set(['fortune_credit'])

interface MatrixRow {
  month: number; date: string
  return_cash_this_month: number; return_cash_cumulative: number
  lender_interest_accrued: number; principal_settled: boolean
  bank_if_invested: number; bank_if_nothing: number; net_vs_nothing: number
}
interface Summary {
  name: string; start_date: string; end_date: string; term_months: number
  own_capital: number; borrowed_capital: number; total_capital: number
  monthly_return_pct: number; member_lend_rate_pct: number; bank_now: number
  external_return_total_simple: number; external_return_total_compound: number
  lender_interest_total: number; club_net_gain: number; club_end_position: number
  vs_nothing_delta: number; downside_own_lost: number
  downside_still_owed_to_lenders: number; downside_max_loss: number
  downside_shortfall_vs_bank: number; committed: boolean
  currency_note: string; risk_flags: string[]
}
interface Lender {
  principal: number; term_months: number; monthly_interest: number
  total_interest: number; principal_returned_at: string
  total_received: number; effective_return_pct: number
}
interface Projection {
  summary: Summary; rows: MatrixRow[]; lender_examples: Lender[]
  terms: { term_months_options: number[]; min_investment_ugx: number; max_investment_ugx: number }
}

const fmtMonth = (iso: string) => {
  const [y, m] = iso.split('-')
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]
  return `${mo} ${y}`
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'muted' }) {
  const fg = tone === 'good' ? '#4ade80' : tone === 'bad' ? '#f87171' : 'white'
  return (
    <div className="rounded-[10px] border border-[var(--border)] bg-[var(--card-inset)] p-3">
      <div className="text-[10px] uppercase tracking-wide text-[var(--muted-2)]">{label}</div>
      <div className="mt-1 text-[15px] font-bold tabular-nums" style={{ color: fg }}>{value}</div>
    </div>
  )
}

export function ViabilityModal({
  projectId, projectName, icon, open, onOpenChange,
}: { projectId: string; projectName: string; icon: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [term, setTerm] = useState<number | null>(null)
  const [capital, setCapital] = useState<number | null>(null)
  const [own, setOwn] = useState<number>(0)

  const qs = new URLSearchParams()
  if (term) qs.set('term', String(term))
  if (capital != null) qs.set('capital', String(capital))
  qs.set('own', String(own))

  const { data, isLoading, isError } = useQuery<Projection>({
    queryKey: ['projection', projectId, term, capital, own],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/projection?${qs}`, { credentials: 'include' })
      if (!r.ok) throw new Error(`projection failed (${r.status})`)
      return r.json()
    },
    enabled: open,
    retry: 1,
  })

  const s = data?.summary
  const termOptions = data?.terms?.term_months_options ?? [3, 6]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[22px]">{icon}</span>
          <div>
            <div className="text-[16px] font-bold text-white">{projectName}</div>
            <div className="text-[11px] text-[var(--muted-2)]">Viability Matrix</div>
          </div>
        </div>

        {/* Illustrative banner — Fortune Credit is due-diligence / uncommitted */}
        {s && !s.committed && (
          <div className="mb-3 flex items-start gap-2 rounded-[10px] border border-[rgba(234,179,8,0.3)] bg-[rgba(234,179,8,0.10)] p-3 text-[12px] text-[#fcd34d]">
            <Info size={15} className="mt-0.5 shrink-0" />
            <span><b>Illustrative only.</b> No funds are committed. Figures assume the investment terms are honoured and are subject to due-diligence verification.</span>
          </div>
        )}

        {/* Controls */}
        <div className="mb-4 space-y-3 rounded-[12px] bg-[var(--card-inset)] p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-[var(--muted)]">Term</span>
            <div className="flex gap-2">
              {termOptions.map(t => (
                <button key={t} onClick={() => setTerm(t)}
                  className="rounded-[8px] px-3 py-1.5 text-[12px] font-semibold transition-colors"
                  style={{
                    background: (term ?? s?.term_months) === t ? 'var(--primary)' : 'var(--card)',
                    color: (term ?? s?.term_months) === t ? '#0b1220' : 'var(--muted)',
                    border: '1px solid var(--border)',
                  }}>{t} months</button>
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-[var(--muted)]">Amount invested (UGX)</span>
            <input type="number" key={s?.total_capital ?? 'init'} defaultValue={s?.total_capital}
              onBlur={e => setCapital(Math.max(0, Number(e.target.value) || 0))}
              className="w-36 rounded-[8px] border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-right text-[13px] tabular-nums text-white" />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-[var(--muted)]">…of which club's own money</span>
            <input type="number" value={own}
              onChange={e => setOwn(Math.max(0, Number(e.target.value) || 0))}
              className="w-36 rounded-[8px] border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-right text-[13px] tabular-nums text-white" />
          </label>
          {s && (
            <div className="text-[11px] text-[var(--muted-2)]">
              Borrowed from members: <b className="text-[#fcd34d]">{ugx(s.borrowed_capital)}</b> @ {s.member_lend_rate_pct}%/mo ·
              Own: <b className="text-white">{ugx(s.own_capital)}</b> · Bank now: {ugx(s.bank_now)}
            </div>
          )}
          {s && data && (s.total_capital < data.terms.min_investment_ugx || s.total_capital > data.terms.max_investment_ugx) && (
            <div className="text-[11px] text-[#fcd34d]">
              ⚠ {s.total_capital < data.terms.min_investment_ugx
                ? `Below Fortune Credit's ${ugx(data.terms.min_investment_ugx)} minimum`
                : `Above the ${ugx(data.terms.max_investment_ugx)} stated range`} — figures shown are still illustrative.
            </div>
          )}
        </div>

        {isError ? (
          <div className="rounded-[10px] border border-[rgba(248,113,113,0.3)] bg-[rgba(248,113,113,0.08)] p-4 text-[13px] text-[#fca5a5]">
            Couldn't load the projection right now. Your session may have expired — reload the page and try again.
          </div>
        ) : isLoading || !s ? <LoadingRow /> : (
          <>
            {/* Headline stats */}
            <div className="mb-3 grid grid-cols-2 gap-2">
              <Stat label="Club net gain" value={ugx(s.club_net_gain)} tone="good" />
              <Stat label="Club end position" value={ugx(s.club_end_position)} tone="good" />
              <Stat label={`vs doing nothing`} value={`+${ugx(s.vs_nothing_delta)}`} tone="good" />
              <Stat label={`Total return (${s.monthly_return_pct}%/mo)`} value={ugx(s.external_return_total_simple)} />
            </div>
            <div className="mb-3 -mt-1 text-[10px] text-[var(--muted-2)]">
              Total return is simple interest ({s.monthly_return_pct}%/mo × {s.term_months} months). Compounded, it would be {ugx(s.external_return_total_compound)}.
            </div>

            {/* Downside — mandatory: KimFam is the borrower */}
            <div className="mb-4 rounded-[12px] border border-[rgba(248,113,113,0.3)] bg-[rgba(248,113,113,0.08)] p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-[#f87171]">
                <TriangleAlert size={14} /> If Fortune Credit does not repay
              </div>
              <div className="space-y-1.5 text-[12px] text-[#fca5a5]">
                <div className="flex justify-between"><span>Club still owes its lenders</span><b className="tabular-nums text-white">{ugx(s.downside_still_owed_to_lenders)}</b></div>
                <div className="flex justify-between"><span>Own money lost</span><b className="tabular-nums text-white">{ugx(s.downside_own_lost)}</b></div>
                <div className="flex justify-between"><span>Maximum loss</span><b className="tabular-nums text-[#f87171]">{ugx(s.downside_max_loss)}</b></div>
                {s.downside_shortfall_vs_bank > 0 && (
                  <div className="flex justify-between border-t border-[rgba(248,113,113,0.2)] pt-1.5"><span>Shortfall vs current bank</span><b className="tabular-nums text-[#f87171]">{ugx(s.downside_shortfall_vs_bank)}</b></div>
                )}
              </div>
            </div>

            {/* Month-by-month */}
            <div className="mb-4">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                <TrendingUp size={13} /> Month by month
              </div>
              <div className="overflow-x-auto rounded-[10px] border border-[var(--border)]">
                <table className="w-full text-[11px] tabular-nums">
                  <thead>
                    <tr className="bg-[var(--card-inset)] text-[var(--muted-2)]">
                      <th className="px-2 py-1.5 text-left font-medium">Month</th>
                      <th className="px-2 py-1.5 text-right font-medium">Cash in</th>
                      <th className="px-2 py-1.5 text-right font-medium">Lender due*</th>
                      <th className="px-2 py-1.5 text-right font-medium">Bank if invested</th>
                      <th className="px-2 py-1.5 text-right font-medium">If nothing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.rows.map(r => (
                      <tr key={r.month} className="border-t border-[var(--border)]">
                        <td className="px-2 py-1.5 text-left text-[var(--muted)]">{fmtMonth(r.date)}{r.principal_settled ? ' ▸' : ''}</td>
                        <td className="px-2 py-1.5 text-right text-[#4ade80]">{ugx(r.return_cash_cumulative)}</td>
                        <td className="px-2 py-1.5 text-right text-[#fcd34d]">{ugx(r.lender_interest_accrued)}</td>
                        <td className="px-2 py-1.5 text-right font-semibold text-white">{ugx(r.bank_if_invested)}</td>
                        <td className="px-2 py-1.5 text-right text-[var(--muted-2)]">{ugx(r.bank_if_nothing)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-1 text-[10px] text-[var(--muted-2)]">▸ term end: principal returned & lenders repaid. *Lender interest accrues monthly, paid with principal at term end.</div>
            </div>

            {/* Member lender payout */}
            <div className="mb-4">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                <Users size={13} /> If a member lends KimFam ({s.member_lend_rate_pct}%/mo, {s.term_months} months)
              </div>
              <div className="overflow-x-auto rounded-[10px] border border-[var(--border)]">
                <table className="w-full text-[11px] tabular-nums">
                  <thead>
                    <tr className="bg-[var(--card-inset)] text-[var(--muted-2)]">
                      <th className="px-2 py-1.5 text-left font-medium">Lends</th>
                      <th className="px-2 py-1.5 text-right font-medium">Accrues/mo</th>
                      <th className="px-2 py-1.5 text-right font-medium">Total interest</th>
                      <th className="px-2 py-1.5 text-right font-medium">Gets back at end</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.lender_examples.map(l => (
                      <tr key={l.principal} className="border-t border-[var(--border)]">
                        <td className="px-2 py-1.5 text-left text-white">{ugx(l.principal)}</td>
                        <td className="px-2 py-1.5 text-right text-[#fcd34d]">{ugx(l.monthly_interest)}</td>
                        <td className="px-2 py-1.5 text-right text-[#4ade80]">{ugx(l.total_interest)}</td>
                        <td className="px-2 py-1.5 text-right font-semibold text-white">{ugx(l.total_received)} <span className="text-[var(--muted-2)]">(+{l.effective_return_pct}%)</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-1 text-[10px] text-[var(--muted-2)]">Interest accrues monthly; principal and all interest are paid together at term end — members are not paid out each month.</div>
            </div>

            {/* Risk flags */}
            {s.risk_flags?.length > 0 && (
              <div className="rounded-[10px] bg-[var(--card-inset)] p-3">
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">Before committing</div>
                <ul className="space-y-1">
                  {s.risk_flags.map((f, i) => (
                    <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-[var(--muted)]"><span className="text-[var(--muted-2)]">·</span>{f}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
