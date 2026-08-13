import { useState, useEffect } from 'react'

interface KlaFamCycle {
  start_date: string
  end_date: string
  beneficiary: string
  members: KlaFamMember[]
  total_collected: number
}

interface KlaFamMember {
  name: string
  status: 'Paid' | 'Pending' | 'Offset'
  amount?: number
}

interface MemberTotal {
  name: string
  total_contributed: number
  total_received: number
  balance: number
}

export default function KlaFamPage() {
  const [cycle, setCycle] = useState<KlaFamCycle | null>(null)
  const [memberTotals, setMemberTotals] = useState<MemberTotal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showRecordModal, setShowRecordModal] = useState(false)
  const [recordFor, setRecordFor] = useState<'self' | 'member'>('self')

  useEffect(() => {
    fetchCycleData()
  }, [])

  async function fetchCycleData() {
    try {
      setLoading(true)
      const res = await fetch('/api/klafam/current-cycle')
      if (!res.ok) throw new Error('Failed to fetch cycle data')
      const data = await res.json()
      setCycle(data.cycle)
      setMemberTotals(data.member_totals)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading...
      </div>
    )
  }

  if (error || !cycle) {
    return (
      <div style={{ padding: '2rem', color: 'var(--error)' }}>
        {error || 'No cycle data available'}
      </div>
    )
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'Paid':
        return '#10b981'
      case 'Pending':
        return '#f59e0b'
      case 'Offset':
        return '#f97316'
      default:
        return 'var(--text-muted)'
    }
  }

  return (
    <div style={{ padding: '1.5rem' }}>
      <h1 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1.75rem' }}>KlaFam Tanda</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', fontSize: '0.95rem' }}>
        Rotating savings group. UGX 300,000/month per member.
      </p>

      {/* Current Cycle Card */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '0.75rem',
          padding: '1.5rem',
          marginBottom: '1.5rem',
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
              Current cycle
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>
              {new Date(cycle.start_date).toLocaleDateString('en-US', {
                month: 'short',
                day: '2-digit',
              })}{' '}
              –{' '}
              {new Date(cycle.end_date).toLocaleDateString('en-US', {
                month: 'short',
                day: '2-digit',
              })}{' '}
              {new Date(cycle.end_date).getFullYear()}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Due {new Date(cycle.end_date).toLocaleDateString('en-US', {
                month: 'short',
                day: '2-digit',
              })} {new Date(cycle.end_date).getFullYear()}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
              Beneficiary
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#3b82f6' }}>
              {cycle.beneficiary}
            </div>
          </div>
        </div>

        {/* Members List */}
        <div style={{ marginTop: '1rem' }}>
          {cycle.members.map((member, idx) => (
            <div
              key={idx}
              style={{
                background: 'var(--bg-secondary)',
                padding: '1rem',
                borderRadius: '0.5rem',
                marginBottom: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontWeight: 500 }}>{member.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span
                  style={{
                    padding: '0.25rem 0.75rem',
                    borderRadius: '0.25rem',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    color: statusColor(member.status),
                    background: `${statusColor(member.status)}20`,
                  }}
                >
                  {member.status}
                </span>
                {member.amount && (
                  <span style={{ fontSize: '0.95rem', minWidth: '120px', textAlign: 'right' }}>
                    UGX {member.amount.toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: '1.5rem',
            paddingTop: '1rem',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>Total collected</span>
          <span style={{ fontSize: '1.25rem', fontWeight: 700 }}>
            UGX {cycle.total_collected.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <button
          onClick={() => {
            setRecordFor('self')
            setShowRecordModal(true)
          }}
          style={{
            padding: '1rem',
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '0.5rem',
            fontWeight: 600,
            fontSize: '1rem',
            cursor: 'pointer',
          }}
        >
          Record my contribution
        </button>
        <button
          onClick={() => {
            setRecordFor('member')
            setShowRecordModal(true)
          }}
          style={{
            padding: '1rem',
            background: 'transparent',
            color: '#8b5cf6',
            border: '2px solid #8b5cf6',
            borderRadius: '0.5rem',
            fontWeight: 600,
            fontSize: '1rem',
            cursor: 'pointer',
          }}
        >
          Record for a member
        </button>
      </div>

      {/* Member Totals */}
      {memberTotals.length > 0 && (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '0.75rem',
            padding: '1.5rem',
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.1rem' }}>Member Totals</h3>
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.95rem',
              }}
            >
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '0.75rem 0', fontWeight: 600, color: 'var(--text-muted)' }}>
                    Member
                  </th>
                  <th style={{ textAlign: 'right', padding: '0.75rem 0', fontWeight: 600, color: 'var(--text-muted)' }}>
                    Contributed
                  </th>
                  <th style={{ textAlign: 'right', padding: '0.75rem 0', fontWeight: 600, color: 'var(--text-muted)' }}>
                    Received
                  </th>
                  <th style={{ textAlign: 'right', padding: '0.75rem 0', fontWeight: 600, color: 'var(--text-muted)' }}>
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {memberTotals.map((member, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem 0' }}>{member.name}</td>
                    <td style={{ textAlign: 'right', padding: '0.75rem 0' }}>
                      UGX {member.total_contributed.toLocaleString()}
                    </td>
                    <td style={{ textAlign: 'right', padding: '0.75rem 0' }}>
                      UGX {member.total_received.toLocaleString()}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        padding: '0.75rem 0',
                        color: member.balance >= 0 ? '#10b981' : '#ef4444',
                        fontWeight: 500,
                      }}
                    >
                      UGX {member.balance.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Record Contribution Modal (placeholder) */}
      {showRecordModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
          onClick={() => setShowRecordModal(false)}
        >
          <div
            style={{
              background: 'var(--bg-card)',
              borderRadius: '0.75rem',
              padding: '2rem',
              maxWidth: '400px',
              width: '90%',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: '1rem' }}>
              {recordFor === 'self' ? 'Record my contribution' : 'Record for a member'}
            </h2>
            <p style={{ color: 'var(--text-muted)' }}>Coming soon</p>
            <button
              onClick={() => setShowRecordModal(false)}
              style={{
                marginTop: '1rem',
                padding: '0.75rem 1rem',
                background: 'var(--bg-secondary)',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
