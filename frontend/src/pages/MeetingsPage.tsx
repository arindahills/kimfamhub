import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import MeetingProcessModal from '../components/MeetingProcessModal'
import MeetingConductor from '../components/MeetingConductor'
import RetrospectiveView from '../components/RetrospectiveView'
import type { Retrospective } from '../components/RetrospectiveView'
import MeetingAnalytics from '../components/MeetingAnalytics'
import { useToast } from '../components/Toast'

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

// ── Review (retrospective) modal — visible to all members ─────────────────────
function ReviewModal({ meetingId, title, isAdmin, onClose }: {
  meetingId: number; title: string; isAdmin: boolean; onClose: () => void
}) {
  const [retro, setRetro] = useState<Retrospective | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const toast = useToast()

  const load = () => {
    setLoading(true)
    fetch(`/api/meetings/${meetingId}/retrospective`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => setRetro(d?.retrospective ?? null))
      .catch(() => setRetro(null))
      .finally(() => setLoading(false))
  }
  useState(() => { load() })

  const generate = async () => {
    setGenerating(true)
    try {
      const r = await fetch(`/api/meetings/${meetingId}/retrospective`, { method: 'POST', credentials: 'include' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.detail || 'Generation failed')
      setRetro(d.retrospective)
      toast.success('Meeting review generated')
    } catch (e: any) {
      toast.error(`Could not generate review: ${e.message}`)
    } finally { setGenerating(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-2xl p-5 space-y-3 max-h-[85vh] overflow-y-auto"
        style={{ background: '#121824', border: '1px solid #1e293b' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>Meeting Review</h2>
            <p className="text-[11px]" style={{ color: '#64748b' }}>{title}</p>
          </div>
          <button onClick={onClose} style={{ color: '#475569' }}>✕</button>
        </div>
        {loading ? (
          <p className="text-xs text-center py-6" style={{ color: '#475569' }}>Loading…</p>
        ) : retro ? (
          <RetrospectiveView retro={retro} />
        ) : (
          <div className="text-center py-6 space-y-3">
            <p className="text-xs" style={{ color: '#64748b' }}>
              No review yet. It is generated automatically when a meeting's minutes are processed
              {isAdmin ? ', or you can generate it now.' : '.'}
            </p>
            {isAdmin && (
              <button onClick={generate} disabled={generating}
                className="text-xs px-4 py-2 rounded-lg disabled:opacity-40"
                style={{ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #3b82f655' }}>
                {generating ? 'Generating…' : 'Generate review'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── New Meeting modal ─────────────────────────────────────────────────────────
// ── Edit Meeting modal — agenda/date editable until the meeting is conducted ───
function EditMeetingModal({ m, onClose, onSaved }: { m: Meeting; onClose: () => void; onSaved: () => void }) {
  const [date, setDate]       = useState(m.meeting_date)
  const [venue, setVenue]     = useState(m.location || 'Google Meet')
  const [startTime, setStart] = useState((m.start_time_eat || '16:30').slice(0, 5))
  const [topics, setTopics]   = useState(m.key_topics || '')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const toast = useToast()

  const save = async () => {
    setError(''); setSaving(true)
    try {
      const res = await fetch(`/api/meetings/${m.db_id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, venue, start_time: startTime, key_topics: topics }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.detail || 'Failed to save')
      toast.success(`${m.meeting_ref} updated`)
      onSaved()
    } catch (e: any) { setError(e.message); toast.error(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-sm rounded-2xl p-5 space-y-4" style={{ background: '#121824', border: '1px solid #1e293b' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>Edit Meeting</h2>
            <div className="text-[11px] font-mono mt-0.5" style={{ color: '#3b82f6' }}>{m.meeting_ref}</div>
          </div>
          <button onClick={onClose} style={{ color: '#475569' }}>✕</button>
        </div>
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
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: '#0d1829', color: '#e2e8f0', border: '1px solid #334155' }} />
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider mb-1 block" style={{ color: '#475569' }}>Main agenda topics</label>
            <textarea value={topics} onChange={e => setTopics(e.target.value)} rows={3}
              placeholder="Separate items with semicolons"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
              style={{ background: '#0d1829', color: '#e2e8f0', border: '1px solid #334155' }} />
            <p className="text-[10px] mt-1" style={{ color: '#334155' }}>Editable until the meeting is conducted. Fixed items (prayer, attendance, etc.) stay automatic.</p>
          </div>
        </div>
        {error && <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>}
        <button onClick={save} disabled={saving || !date}
          className="w-full py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
          style={{ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #3b82f655' }}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}

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
  const [viewReview, setViewReview]   = useState(false)
  const [editing, setEditing]         = useState(false)
  const cardQc = useQueryClient()
  const notConducted = !m.conductor_active && !m.conductor_ended

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
                className="text-[11px] px-2.5 py-1 rounded-lg font-semibold cursor-pointer transition-all hover:brightness-110"
                style={{
                  background: m.conductor_active ? '#15803d' : '#1e3a5f',
                  color:      m.conductor_active ? '#dcfce7' : '#bfdbfe',
                  border:     m.conductor_active ? '1px solid #22c55e' : '1px solid #3b82f6',
                }}>
                {m.conductor_active ? '● Live' : 'Conduct'}
              </button>
            )}
            {isAdmin && notConducted && (
              <button onClick={() => setEditing(true)}
                className="text-[11px] px-2 py-1 rounded-lg"
                style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }}>
                ✎ Edit
              </button>
            )}
            {isAdmin && m.conductor_ended && (
              <button onClick={() => onProcess(m)}
                className="text-[11px] px-2 py-1 rounded-lg"
                style={{ background: '#4c1d9533', color: '#a78bfa', border: '1px solid #4c1d9555' }}>
                Process
              </button>
            )}
            {m.conductor_ended && (
              <button onClick={() => setViewReview(true)}
                className="text-[11px] px-2 py-1 rounded-lg"
                style={{ background: '#0f766e33', color: '#5eead4', border: '1px solid #0f766e55' }}>
                📊 Review
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

      {viewReview && (
        <ReviewModal
          meetingId={m.db_id}
          title={`KIM ${m.meeting_number} — ${m.meeting_date}`}
          isAdmin={isAdmin}
          onClose={() => setViewReview(false)}
        />
      )}

      {editing && (
        <EditMeetingModal
          m={m}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); cardQc.invalidateQueries({ queryKey: ['meetings'] }) }}
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
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [processMeeting, setProcess]    = useState<Meeting | null>(null)
  const [conductMeeting, setConduct]    = useState<Meeting | null>(null)

  const { data: meetings = [], isLoading } = useQuery<Meeting[]>({
    queryKey: ['meetings'],
    queryFn: () => fetch('/api/meetings', { credentials: 'include' }).then(r => r.json()),
  })

  const refNum = (m: Meeting) => {
    const mm = /KIM\s*(\d+)/i.exec(m.meeting_ref || m.meeting_number || '')
    return mm ? parseInt(mm[1], 10) : 0
  }
  const sorted = [...meetings].sort((a, b) => {
    const d = new Date(b.meeting_date).getTime() - new Date(a.meeting_date).getTime()
    return d !== 0 ? d : refNum(b) - refNum(a)   // same date → highest meeting number first
  })

  return (
    <div className="max-w-2xl md:max-w-5xl mx-auto space-y-3">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
          {t('meetings.title')} ({meetings.length})
        </h2>
        <div className="flex items-center gap-2">
          <Link to="/actions"
            className="text-xs px-3 py-1.5 rounded-full font-medium"
            style={{ background: '#14532d33', color: '#86efac', border: '1px solid #16683455', textDecoration: 'none' }}>
            ✅ Action Points
          </Link>
          <button onClick={() => setShowAnalytics(true)}
            className="text-xs px-3 py-1.5 rounded-full font-medium"
            style={{ background: '#0f766e33', color: '#5eead4', border: '1px solid #0f766e55' }}>
            📈 Analytics
          </button>
          {isAdmin && (
            <button onClick={() => setShowNew(true)}
              className="text-xs px-3 py-1.5 rounded-full font-medium"
              style={{ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #3b82f655' }}>
              + New meeting
            </button>
          )}
        </div>
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

      {showAnalytics && <MeetingAnalytics onClose={() => setShowAnalytics(false)} />}

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
