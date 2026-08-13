import { useEffect, useState, useCallback } from 'react'

const API = (p: string) => p

interface Member {
  id: number; slug: string; display_name: string; is_active: boolean
  total_contributed: number; total_received: number; net: number
  times_received: number; missed_count: number; offset_count: number
}
interface Contribution {
  id: number; slug: string; display_name: string; is_active: boolean
  amount: number; status: string; paid_date: string | null
  offset_reason: string | null; notes: string | null
}
interface Cycle {
  id: number; year: number; month: number; month_label: string
  due_date: string | null; beneficiary_name: string | null
  beneficiary_slug: string | null; total_collected: number
  acknowledged_at: string | null; acknowledged_by: string | null
  contributions: Contribution[]
}
interface Overview {
  current_cycle: Cycle | null; next_cycle: { bene_name: string; bene_slug: string } | null
  member_stats: Member[]; recent_cycles: any[]
}

const fmt = (n: number) => 'UGX ' + n.toLocaleString()

const STATUS_PILL: Record<string, { label: string; bg: string; color: string }> = {
  paid:    { label: 'Paid',     bg: '#1a3326', color: '#4ade80' },
  missed:  { label: 'Missed',   bg: '#3a1818', color: '#f87171' },
  offset:  { label: 'Offset',   bg: '#2d2a14', color: '#facc15' },
  pending: { label: 'Pending',  bg: '#1e2536', color: '#94a3b8' },
  na:      { label: 'N/A',      bg: '#1e2536', color: '#64748b' },
}

function Pill({ status }: { status: string }) {
  const s = STATUS_PILL[status] || STATUS_PILL.pending
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12,
      background: s.bg, color: s.color, letterSpacing: '0.03em',
    }}>{s.label}</span>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: '#1E293B', borderRadius: 12, padding: '20px 24px',
      border: '1px solid #334155', ...style
    }}>{children}</div>
  )
}

function PayModal({ cycle, onClose, onDone }: {
  cycle: Cycle; onClose: () => void; onDone: () => void
}) {
  const [amount, setAmount] = useState('300,000')
  const [notes, setNotes]   = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const rawAmount = parseInt(amount.replace(/,/g, ''), 10) || 0

  async function submit() {
    setLoading(true); setErr('')
    try {
      const r = await fetch(API('/api/klafam/contributions/pay'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cycle_id: cycle.id, amount: rawAmount, notes }),
        credentials: 'include',
      })
      if (!r.ok) throw new Error((await r.json()).detail || 'Error')
      onDone()
    } catch (e: any) { setErr(e.message) }
    setLoading(false)
  }

  async function submitOffset() {
    const reason = prompt('Why are you offsetting? (who owes you, and from which month)')
    if (!reason) return
    setLoading(true); setErr('')
    try {
      const r = await fetch(API('/api/klafam/contributions/offset'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cycle_id: cycle.id, reason }),
        credentials: 'include',
      })
      if (!r.ok) throw new Error((await r.json()).detail || 'Error')
      onDone()
    } catch (e: any) { setErr(e.message) }
    setLoading(false)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: '#1E293B', borderRadius: 16, padding: 28, width: 340,
        border: '1px solid #334155', display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#f8fafc' }}>
          Record Contribution — {cycle.month_label}
        </div>
        <div>
          <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
            Amount (UGX)
          </label>
          <input
            type="text" inputMode="numeric"
            value={amount}
            onChange={e => {
              const raw = e.target.value.replace(/,/g, '').replace(/\D/g, '')
              setAmount(raw ? parseInt(raw).toLocaleString() : '')
            }}
            style={{
              width: '100%', background: '#0f172a', border: '1px solid #334155',
              borderRadius: 8, padding: '10px 12px', color: '#f8fafc', fontSize: 15,
              boxSizing: 'border-box',
            }}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6 }}>Notes (optional)</label>
          <input
            type="text" value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="e.g. paid via MTN MoMo"
            style={{
              width: '100%', background: '#0f172a', border: '1px solid #334155',
              borderRadius: 8, padding: '10px 12px', color: '#f8fafc', fontSize: 14,
              boxSizing: 'border-box',
            }}
          />
        </div>
        {err && <div style={{ color: '#f87171', fontSize: 13 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={submit} disabled={loading || rawAmount === 0} style={{
            flex: 1, background: '#2563eb', color: '#fff', border: 'none',
            borderRadius: 8, padding: '10px 16px', fontSize: 14, fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer', opacity: rawAmount === 0 ? 0.5 : 1,
          }}>{loading ? 'Saving...' : 'Mark Paid'}</button>
          <button onClick={submitOffset} disabled={loading} style={{
            flex: 1, background: '#2d2a14', color: '#facc15', border: '1px solid #facc15',
            borderRadius: 8, padding: '10px 16px', fontSize: 14, fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer',
          }}>Mark Offset</button>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: '#64748b', fontSize: 13,
          cursor: 'pointer', textAlign: 'center',
        }}>Cancel</button>
      </div>
    </div>
  )
}

export default function KlaFamPage() {
  const [data, setData]           = useState<Overview | null>(null)
  const [mySlug, setMySlug]       = useState<string | null>(null)
  const [loading, setLoading]     = useState(true)
  const [showPay, setShowPay]     = useState(false)
  const [ackLoading, setAckLoading] = useState(false)
  const [err, setErr]             = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ov, me] = await Promise.all([
        fetch(API('/api/klafam/overview'), { credentials: 'include' }).then(r => r.json()),
        fetch(API('/api/klafam/me'),       { credentials: 'include' }).then(r => r.json()),
      ])
      setData(ov)
      setMySlug(me.slug)
    } catch (e: any) { setErr(e.message) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function acknowledge(cycleId: number) {
    setAckLoading(true)
    try {
      const r = await fetch(API(`/api/klafam/cycles/${cycleId}/acknowledge`), {
        method: 'POST', credentials: 'include',
      })
      if (!r.ok) throw new Error((await r.json()).detail)
      await load()
    } catch (e: any) { alert(e.message) }
    setAckLoading(false)
  }

  if (loading) return (
    <div style={{ padding: 32, color: '#94a3b8' }}>Loading KlaFam...</div>
  )
  if (err) return (
    <div style={{ padding: 32, color: '#f87171' }}>Error: {err}</div>
  )
  if (!data) return null
  if (!mySlug) return (
    <div style={{ padding: 32, color: '#94a3b8' }}>
      This section is only accessible to KlaFam members.
    </div>
  )

  const { current_cycle: cur, next_cycle: next, member_stats: stats, recent_cycles: recent } = data
  const myContrib = cur?.contributions.find(c => c.slug === mySlug)
  const isBeneficiary = cur?.beneficiary_slug === mySlug

  // Sort stats: active members first, then historical
  const activeStats = stats.filter(m => m.is_active)
  const histStats   = stats.filter(m => !m.is_active)

  return (
    <div style={{ padding: '24px 20px', maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Header */}
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f8fafc', margin: 0 }}>KlaFam Tanda</h1>
        <p style={{ color: '#64748b', fontSize: 14, margin: '4px 0 0' }}>
          Rotating savings group. UGX 300,000/month per member.
        </p>
      </div>

      {/* Current cycle */}
      {cur && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>Current cycle</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#f8fafc' }}>{cur.month_label}</div>
              {cur.due_date && (
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  Due {new Date(cur.due_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>Beneficiary</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#60a5fa' }}>
                {cur.beneficiary_name || 'TBC'}
              </div>
              {cur.acknowledged_at ? (
                <div style={{ fontSize: 12, color: '#4ade80' }}>Acknowledged</div>
              ) : isBeneficiary ? (
                <button
                  onClick={() => acknowledge(cur.id)}
                  disabled={ackLoading}
                  style={{
                    marginTop: 6, fontSize: 12, fontWeight: 600,
                    background: '#1a3326', color: '#4ade80', border: '1px solid #4ade80',
                    borderRadius: 8, padding: '4px 12px', cursor: 'pointer',
                  }}
                >{ackLoading ? '...' : 'Acknowledge receipt'}</button>
              ) : null}
            </div>
          </div>

          {/* Contributions grid */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {cur.contributions.map(c => (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: '#0f172a', borderRadius: 8, padding: '10px 14px',
                border: c.slug === mySlug ? '1px solid #334155' : '1px solid transparent',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 14, color: '#e2e8f0', fontWeight: c.slug === mySlug ? 600 : 400 }}>
                    {c.display_name}{c.slug === mySlug ? ' (you)' : ''}
                  </span>
                  <Pill status={c.status} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {c.amount > 0 && (
                    <span style={{ fontSize: 13, color: '#94a3b8' }}>
                      {fmt(c.amount)}
                    </span>
                  )}
                  {c.offset_reason && (
                    <span style={{ fontSize: 11, color: '#facc15', maxWidth: 160, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {c.offset_reason}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Total collected */}
          <div style={{
            marginTop: 16, display: 'flex', justifyContent: 'space-between',
            borderTop: '1px solid #334155', paddingTop: 14,
          }}>
            <span style={{ color: '#94a3b8', fontSize: 14 }}>Total collected</span>
            <span style={{ color: '#f8fafc', fontWeight: 700, fontSize: 15 }}>{fmt(cur.total_collected)}</span>
          </div>

          {/* My action button */}
          {myContrib && myContrib.status !== 'paid' && !isBeneficiary && (
            <button onClick={() => setShowPay(true)} style={{
              marginTop: 16, width: '100%', background: '#2563eb', color: '#fff',
              border: 'none', borderRadius: 8, padding: '12px', fontSize: 15,
              fontWeight: 600, cursor: 'pointer',
            }}>
              {myContrib.status === 'offset' ? 'Edit contribution' : 'Record my contribution'}
            </button>
          )}
          {myContrib?.status === 'paid' && (
            <div style={{
              marginTop: 14, textAlign: 'center', fontSize: 13, color: '#4ade80',
            }}>
              Your contribution for {cur.month_label} is recorded.
            </div>
          )}
        </Card>
      )}

      {/* Next cycle preview */}
      {next && (
        <div style={{
          background: '#1a2433', borderRadius: 10, padding: '14px 20px',
          border: '1px solid #2d3748', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ color: '#64748b', fontSize: 13 }}>Next month's beneficiary</span>
          <span style={{ color: '#93c5fd', fontWeight: 600, fontSize: 15 }}>{next.bene_name}</span>
        </div>
      )}

      {/* Member summary */}
      <Card>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc', marginBottom: 16 }}>Member Totals</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#64748b', borderBottom: '1px solid #334155' }}>
                <th style={{ textAlign: 'left',  padding: '6px 8px' }}>Member</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>Contributed</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>Received</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>Net</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>Missed</th>
              </tr>
            </thead>
            <tbody>
              {activeStats.map(m => (
                <tr key={m.slug} style={{
                  borderBottom: '1px solid #1e293b',
                  background: m.slug === mySlug ? '#1e2a3a' : 'transparent',
                }}>
                  <td style={{ padding: '10px 8px', color: '#e2e8f0', fontWeight: m.slug === mySlug ? 600 : 400 }}>
                    {m.display_name}{m.slug === mySlug ? ' *' : ''}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: '#94a3b8' }}>
                    {m.total_contributed.toLocaleString()}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: '#94a3b8' }}>
                    {m.total_received.toLocaleString()}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 600,
                    color: m.net >= 0 ? '#4ade80' : '#f87171' }}>
                    {m.net >= 0 ? '+' : ''}{m.net.toLocaleString()}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'right',
                    color: m.missed_count > 0 ? '#f87171' : '#4ade80' }}>
                    {m.missed_count}
                  </td>
                </tr>
              ))}
              {histStats.length > 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: '14px 8px 4px', color: '#475569', fontSize: 11, fontWeight: 600 }}>
                    HISTORICAL (INACTIVE)
                  </td>
                </tr>
              )}
              {histStats.map(m => (
                <tr key={m.slug} style={{ borderBottom: '1px solid #1e293b', opacity: 0.6 }}>
                  <td style={{ padding: '8px 8px', color: '#94a3b8' }}>{m.display_name}</td>
                  <td style={{ padding: '8px 8px', textAlign: 'right', color: '#64748b' }}>{m.total_contributed.toLocaleString()}</td>
                  <td style={{ padding: '8px 8px', textAlign: 'right', color: '#64748b' }}>{m.total_received.toLocaleString()}</td>
                  <td style={{ padding: '8px 8px', textAlign: 'right', color: m.net >= 0 ? '#4ade80' : '#f87171' }}>
                    {m.net >= 0 ? '+' : ''}{m.net.toLocaleString()}
                  </td>
                  <td style={{ padding: '8px 8px', textAlign: 'right', color: '#64748b' }}>{m.missed_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Recent history */}
      <Card>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc', marginBottom: 16 }}>History</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {recent.map((r: any) => (
            <div key={r.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: '#0f172a', borderRadius: 8, padding: '10px 14px',
            }}>
              <div>
                <span style={{ fontSize: 14, color: '#e2e8f0', fontWeight: 500 }}>{r.month_label}</span>
                {r.beneficiary_name && (
                  <span style={{ fontSize: 12, color: '#60a5fa', marginLeft: 10 }}>
                    {r.beneficiary_name}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 13, color: '#94a3b8' }}>{r.total_collected.toLocaleString()}</span>
                {r.acknowledged ? (
                  <span style={{ fontSize: 11, color: '#4ade80' }}>Acked</span>
                ) : (
                  <span style={{ fontSize: 11, color: '#475569' }}>Pending ack</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {showPay && cur && (
        <PayModal
          cycle={cur}
          onClose={() => setShowPay(false)}
          onDone={() => { setShowPay(false); load() }}
        />
      )}
    </div>
  )
}
