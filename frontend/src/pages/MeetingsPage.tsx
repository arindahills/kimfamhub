import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import MeetingProcessModal from '../components/MeetingProcessModal'
import MeetingConductor from '../components/MeetingConductor'

const ADMIN_USERS = ['Hillary', 'Hellen']

interface Meeting {
  db_id: number
  id: number
  meeting_number: string
  meeting_ref: string
  meeting_date: string
  start_time_eat: string | null
  location: string | null
  key_topics: string | null
  key_decisions: string | null
  next_actions: string | null
  summary: string | null
  attendance: string[]
  minutes_url: string | null
  action_count: number
  action_done_count: number
  conductor_active: boolean
  conductor_ended: boolean
}

// ── Minutes viewer ────────────────────────────────────────────────────────────
function MinutesModal({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const viewUrl = url.endsWith('/view') ? url : `${url}/view`
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#0d1829', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>{title}</div>
          <div style={{ fontSize: 11, color: '#475569' }}>Meeting Minutes</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href={url} download style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, background: '#1e3a5f', color: '#93c5fd', textDecoration: 'none' }}>↓ Download</a>
          <button onClick={onClose} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: '#94a3b8', fontSize: 16 }}>✕</button>
        </div>
      </div>
      <iframe src={viewUrl} style={{ flex: 1, border: 'none', background: '#fff' }} title={title} />
    </div>
  )
}

// ── New Meeting modal ─────────────────────────────────────────────────────────
function NewMeetingModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const nextSunday = (() => {
    const d = new Date()
    const day = d.getDay() // 0 = Sunday
    if (day !== 0) d.setDate(d.getDate() + (7 - day))
    return d.toISOString().slice(0, 10)
  })()
  const [nextRef, setNextRef]     = useState('')
  const [date, setDate]           = useState(nextSunday)
  const [venue, setVenue]         = useState('Google Meet')
  const [startTime, setStart]     = useState('16:30')
  const [topics, setTopics]       = useState('')
  const [saving, setSaving]       = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(true)

  // Fetch next-ref on open
  useState(() => {
    fetch('/api/meetings/next-ref', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setNextRef(d.next_ref || ''); setLoading(false) })
      .catch(() => setLoading(false))
  })

  const suggestAgenda = async () => {
    setSuggesting(true)
    try {
      const res = await fetch('/api/meetings/suggest-agenda', { credentials: 'include' })
      const d = await res.json()
      if (d.suggestion) setTopics(d.suggestion)
    } catch {/* ignore */} finally {
      setSuggesting(false)
    }
  }

  const save = async () => {
    setError(''); setSaving(true)
    try {
      const res = await fetch('/api/meetings', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, venue, start_time: startTime, key_topics: topics }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail || 'Failed to create meeting')
      onCreated()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-sm rounded-2xl p-5 space-y-4"
        style={{ background: '#121824', border: '1px solid #1e293b' }}>

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>New Meeting</h2>
            {nextRef && (
              <div className="text-[11px] font-mono mt-0.5" style={{ color: '#3b82f6' }}>{nextRef}</div>
            )}
          </div>
          <button onClick={onClose} style={{ color: '#475569' }}>✕</button>
        </div>

        {loading ? (
          <p className="text-xs text-center py-4" style={{ color: '#475569' }}>Loading…</p>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider mb-1 block" style={{ color: '#475569' }}>Meeting date</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={{ background: '#0d1829', color: '#e2e8f0', border: '1px solid #334155' }} />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[10px] uppercase tracking-wider mb-1 block" style={{ color: '#475569' }}>Start time (EAT)</label>
                  <input type="time" value={startTime} onChange={e => setStart(e.target.value)}
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                    style={{ background: '#0d1829', color: '#e2e8f0', border: '1px solid #334155' }} />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] uppercase tracking-wider mb-1 block" style={{ color: '#475569' }}>Venue</label>
                  <input value={venue} onChange={e => setVenue(e.target.value)}
                    placeholder="Google Meet"
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                    style={{ background: '#0d1829', color: '#e2e8f0', border: '1px solid #334155' }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] uppercase tracking-wider" style={{ color: '#475569' }}>Main agenda topics</label>
                  <button onClick={suggestAgenda} disabled={suggesting}
                    className="text-[10px] px-2 py-0.5 rounded-md disabled:opacity-40"
                    style={{ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #3b82f655' }}>
                    {suggesting ? 'Thinking…' : '✦ AI suggest'}
                  </button>
                </div>
                <textarea value={topics} onChange={e => setTopics(e.target.value)}
                  rows={3} placeholder="e.g. Equity model vote; Washing bay Phase 2; Solar update"
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
                  style={{ background: '#0d1829', color: '#e2e8f0', border: '1px solid #334155' }} />
                <p className="text-[10px] mt-1" style={{ color: '#334155' }}>
                  Separate items with semicolons. Fixed items (prayer, attendance, etc.) are added automatically.
                </p>
              </div>
            </div>

            {error && <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>}

            <button onClick={save} disabled={saving || !date}
              className="w-full py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
              style={{ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #3b82f655' }}>
              {saving ? 'Creating…' : 'Create meeting'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Collapsible section ───────────────────────────────────────────────────────
function Collapsible({ title, body }: { title: string; body: string | null }) {
  const [open, setOpen] = useState(false)
  if (!body) return null
  return (
    <div>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs font-semibold mb-1 w-full text-left"
        style={{ color: '#94a3b8' }}>
        <span style={{ transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>▶</span>
        {title}
      </button>
      {open && <p className="text-xs leading-relaxed pl-4" style={{ color: '#cbd5e1' }}>{body}</p>}
    </div>
  )
}

// ── Meeting card ──────────────────────────────────────────────────────────────
function MeetingCard({ m, isAdmin, onProcess, onConduct }: {
  m: Meeting; isAdmin: boolean
  onProcess: (m: Meeting) => void
  onConduct: (m: Meeting) => void
}) {
  const progress = m.action_count > 0 ? Math.round((m.action_done_count / m.action_count) * 100) : 0
  const [viewMinutes, setViewMinutes] = useState(false)

  // Conduct is only relevant for meetings that haven't happened yet (today or future),
  // or ones currently live. Past meetings get no Conduct button.
  const todayStr = new Date().toISOString().slice(0, 10)
  const isConductable = m.conductor_active || m.meeting_date >= todayStr

  return (
    <>
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)' }}>
        {/* Header */}
        <div className="flex justify-between items-start mb-2">
          <div>
            <div className="font-semibold text-sm" style={{ color: '#f1f5f9' }}>
              KIM {m.meeting_number}
            </div>
            <div className="text-xs" style={{ color: '#64748b' }}>
              {m.meeting_date}{m.start_time_eat ? ` · ${m.start_time_eat.slice(0, 5)} EAT` : ''}{m.location ? ` · ${m.location}` : ''}
            </div>
          </div>
          <div className="flex gap-1.5 flex-wrap justify-end">
            {isAdmin && isConductable && (
              <button onClick={() => onConduct(m)}
                className="text-[11px] px-2 py-1 rounded-lg font-semibold"
                style={{
                  background: m.conductor_active ? '#1e3a5f' : '#0f2a4a',
                  color:      m.conductor_active ? '#93c5fd' : '#475569',
                  border:     m.conductor_active ? '1px solid #3b82f6' : '1px solid #1e3a5f',
                }}>
                {m.conductor_active ? '● Live' : 'Conduct'}
              </button>
            )}
            {isAdmin && m.conductor_ended && (
              <button onClick={() => onProcess(m)}
                className="text-[11px] px-2 py-1 rounded-lg"
                style={{ background: '#4c1d9533', color: '#a78bfa', border: '1px solid #4c1d9555' }}>
                Process
              </button>
            )}
            {m.minutes_url && (
              <>
                <button onClick={() => setViewMinutes(true)}
                  className="text-[11px] px-2 py-1 rounded-lg"
                  style={{ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #1e40af', cursor: 'pointer' }}>
                  📄 Read
                </button>
                <a href={m.minutes_url} download
                  className="text-[11px] px-2 py-1 rounded-lg"
                  style={{ background: '#1e293b', color: '#64748b', border: '1px solid #334155', textDecoration: 'none' }}>
                  ↓
                </a>
              </>
            )}
          </div>
        </div>

        {/* Action progress bar */}
        {m.action_count > 0 && (
          <div className="mb-3">
            <div className="flex justify-between text-[10px] mb-1" style={{ color: '#64748b' }}>
              <span>Action items</span>
              <span>{m.action_done_count}/{m.action_count} done</span>
            </div>
            <div className="rounded-full h-1.5 overflow-hidden" style={{ background: '#1e293b' }}>
              <div className="h-full rounded-full transition-all"
                style={{ width: `${progress}%`, background: progress === 100 ? '#22c55e' : '#3b82f6' }} />
            </div>
          </div>
        )}

        {/* Summary (if processed) */}
        {m.summary && (
          <p className="text-xs mb-2 leading-relaxed" style={{ color: '#94a3b8' }}>{m.summary}</p>
        )}

        <div className="space-y-1.5">
          <Collapsible title="Key Topics"    body={m.key_topics} />
          <Collapsible title="Key Decisions" body={m.key_decisions} />
          <Collapsible title="Next Actions"  body={m.next_actions} />
        </div>
      </div>

      {viewMinutes && m.minutes_url && (
        <MinutesModal
          url={m.minutes_url}
          title={`KIM ${m.meeting_number} — ${m.meeting_date}`}
          onClose={() => setViewMinutes(false)}
        />
      )}
    </>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function MeetingsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const qc = useQueryClient()
  const isAdmin = ADMIN_USERS.includes(user?.name || '')

  const [showNew, setShowNew]           = useState(false)
  const [processMeeting, setProcess]    = useState<Meeting | null>(null)
  const [conductMeeting, setConduct]    = useState<Meeting | null>(null)

  const { data: meetings = [], isLoading } = useQuery<Meeting[]>({
    queryKey: ['meetings'],
    queryFn: () => fetch('/api/meetings', { credentials: 'include' }).then(r => r.json()),
  })

  const sorted = [...meetings].sort((a, b) =>
    new Date(b.meeting_date).getTime() - new Date(a.meeting_date).getTime()
  )

  return (
    <div className="max-w-2xl md:max-w-5xl mx-auto space-y-3">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
          {t('meetings.title')} ({meetings.length})
        </h2>
        {isAdmin && (
          <button onClick={() => setShowNew(true)}
            className="text-xs px-3 py-1.5 rounded-full font-medium"
            style={{ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #3b82f655' }}>
            + New meeting
          </button>
        )}
      </div>

      {isLoading && (
        <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</p>
      )}

      {!isLoading && sorted.length === 0 && (
        <p className="text-xs text-center py-10" style={{ color: 'var(--text-muted)' }}>
          No meetings yet.{isAdmin ? ' Tap + New meeting to create the first one.' : ''}
        </p>
      )}

      {sorted.map(m => (
        <MeetingCard key={m.db_id} m={m} isAdmin={isAdmin} onProcess={setProcess} onConduct={setConduct} />
      ))}

      {/* New Meeting modal */}
      {showNew && (
        <NewMeetingModal
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); qc.invalidateQueries({ queryKey: ['meetings'] }) }}
        />
      )}

      {/* Conduct Meeting — full screen */}
      {conductMeeting && (
        <MeetingConductor
          meetingId={conductMeeting.db_id}
          meetingRef={conductMeeting.meeting_ref}
          isAdmin={isAdmin}
          onClose={() => { setConduct(null); qc.invalidateQueries({ queryKey: ['meetings'] }) }}
          onMeetingProcessed={() => {
            setConduct(null)
            qc.invalidateQueries({ queryKey: ['meetings'] })
            qc.invalidateQueries({ queryKey: ['actions'] })
          }}
        />
      )}

      {/* Process Meeting modal */}
      {processMeeting && (
        <MeetingProcessModal
          meetingId={processMeeting.db_id}
          meetingRef={processMeeting.meeting_ref}
          onClose={() => setProcess(null)}
          onConfirmed={() => {
            setProcess(null)
            qc.invalidateQueries({ queryKey: ['meetings'] })
            qc.invalidateQueries({ queryKey: ['actions'] })
          }}
        />
      )}
    </div>
  )
}
