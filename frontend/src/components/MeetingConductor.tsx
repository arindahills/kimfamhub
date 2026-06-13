import { useState, useEffect, useRef, useCallback } from 'react'
import MeetingProcessModal from './MeetingProcessModal'

interface AgendaItem {
  label: string
  presenter: string
  duration_min: number
  type: 'fixed' | 'project' | 'agenda' | 'section'
  project_id?: string
  is_section_header?: boolean
  is_section_child?: boolean
  children?: AgendaItem[]
}

interface ConductorState {
  meeting_ref: string
  date: string
  venue: string
  agenda: AgendaItem[]
  current_item: number | null
  started: boolean
  ended: boolean
  recording: boolean
  item_elapsed_s: number | null
  total_elapsed_s: number | null
  notes?: string
  recording_present?: boolean
  timings?: Record<string, { label: string; planned_min: number; actual_s: number }>
  attendance?: Record<string, { status: 'present' | 'apology' | 'absent' | ''; comment: string }>
  members?: string[]
}

interface Props {
  meetingId: number
  meetingRef: string
  isAdmin: boolean
  onClose: () => void
  onMeetingProcessed: () => void
}

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

type RollEntry = { status: 'present' | 'apology' | 'absent' | ''; comment: string }

function RollCall({ members, attendance, onStatus, onComment }: {
  members: string[]
  attendance: Record<string, RollEntry>
  onStatus: (m: string, s: RollEntry['status']) => void
  onComment: (m: string, c: string) => void
}) {
  const STATUSES: { key: RollEntry['status']; label: string; color: string; bg: string }[] = [
    { key: 'present', label: 'Present', color: '#86efac', bg: '#14532d55' },
    { key: 'apology', label: 'Apology', color: '#fcd34d', bg: '#78350f55' },
    { key: 'absent',  label: 'Absent',  color: '#fca5a5', bg: '#7f1d1d55' },
  ]
  const present = members.filter(m => attendance[m]?.status === 'present').length
  const apology = members.filter(m => attendance[m]?.status === 'apology').length
  const absent  = members.filter(m => attendance[m]?.status === 'absent').length
  return (
    <div className="rounded-xl p-3 text-left space-y-2" style={{ background: '#0d1829', border: '1px solid #1e293b' }}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#c4b5fd' }}>Roll call</p>
        <p className="text-[10px]" style={{ color: '#64748b' }}>
          {present} present · {apology} apology · {absent} absent
        </p>
      </div>
      <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: '44vh' }}>
        {members.map(m => {
          const e = attendance[m] ?? { status: '', comment: '' }
          return (
            <div key={m} className="rounded-lg px-2.5 py-2" style={{ background: '#121824', border: '1px solid #1e293b' }}>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-sm truncate" style={{ color: '#e2e8f0' }}>{m}</span>
                <div className="flex gap-1">
                  {STATUSES.map(s => {
                    const active = e.status === s.key
                    return (
                      <button key={s.key} onClick={() => onStatus(m, s.key)}
                        className="text-[10px] px-2 py-1 rounded-md font-semibold transition-all"
                        style={{
                          background: active ? s.bg : '#1e293b',
                          color:      active ? s.color : '#64748b',
                          border:     active ? `1px solid ${s.color}66` : '1px solid #334155',
                        }}>
                        {s.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              {(e.status === 'apology' || e.status === 'absent' || e.comment) && (
                <input
                  value={e.comment}
                  onChange={ev => onComment(m, ev.target.value)}
                  placeholder={e.status === 'present' ? 'Note (e.g. joined late at 5:15)' : 'Reason / note'}
                  className="w-full mt-1.5 rounded-md px-2 py-1 text-xs outline-none"
                  style={{ background: '#0d1829', color: '#cbd5e1', border: '1px solid #334155' }}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DurationRow({ label, value, onChange, indent }: {
  label: string; value: number; onChange: (v: number) => void; indent?: boolean
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-2"
      style={{ background: '#0d1829', border: '1px solid #1e293b', marginLeft: indent ? 12 : 0 }}>
      <span className="flex-1 text-sm truncate" style={{ color: '#e2e8f0' }}>{label}</span>
      <input type="number" min={0} max={120} value={value}
        onChange={e => onChange(Math.max(0, parseInt(e.target.value || '0', 10)))}
        className="w-14 rounded-md px-2 py-1 text-sm text-right outline-none"
        style={{ background: '#121824', color: '#93c5fd', border: '1px solid #334155' }} />
      <span className="text-[11px]" style={{ color: '#475569' }}>min</span>
    </div>
  )
}

// Map an agenda item to the in-app module it relates to (opened in a new tab so
// the conductor keeps recording). Keeps the presenter in the meeting flow while
// giving quick access to the live data for that item.
function moduleLinkFor(item: AgendaItem): { label: string; path: string } | null {
  const l = (item.label || '').toLowerCase()
  if (item.type === 'project' || item.project_id) return { label: 'Projects', path: '/projects' }
  if (/treasurer|finance|contribution|payment/.test(l)) return { label: 'Finances', path: '/finances' }
  if (/action review|action point|review action/.test(l)) return { label: 'Action Points', path: '/actions' }
  if (/equity/.test(l)) return { label: 'Equity', path: '/equity' }
  if (/loan/.test(l)) return { label: 'Loans', path: '/loans' }
  if (/expenditure|expense/.test(l)) return { label: 'Expenditure', path: '/expenditure' }
  return null
}

function flatten(agenda: AgendaItem[]): AgendaItem[] {
  const flat: AgendaItem[] = []
  for (const item of agenda) {
    if (item.type === 'section') {
      flat.push({ ...item, is_section_header: true })
      for (const child of item.children ?? []) {
        flat.push({ ...child, is_section_child: true })
      }
    } else {
      flat.push(item)
    }
  }
  return flat
}

export default function MeetingConductor({ meetingId, meetingRef, isAdmin, onClose, onMeetingProcessed }: Props) {
  const [state, setState]           = useState<ConductorState | null>(null)
  const [loading, setLoading]       = useState(true)
  const [acting, setActing]         = useState(false)
  const [showProcess, setShowProcess]     = useState(false)
  const [showTranscriptPrompt, setShowTranscriptPrompt] = useState(false)
  const [localElapsed, setLocalElapsed] = useState(0)
  const [localItemElapsed, setLocalItemElapsed] = useState(0)
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Audio recorder — starts automatically when admin clicks Start Meeting ───
  const [recording, setRecording]     = useState(false)
  const [uploading, setUploading]     = useState(false)
  const [uploadedAudio, setUploadedAudio] = useState(false)
  const [recError, setRecError]       = useState('')
  const mediaRef   = useRef<MediaRecorder | null>(null)
  const chunksRef  = useRef<Blob[]>([])

  // ── Live secretary notes — typed throughout the meeting ─────────────────────
  const [notes, setNotes]           = useState('')
  const notesLoadedRef = useRef(false)
  const [notesSaved, setNotesSaved] = useState(true)
  const notesSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastItemRef  = useRef<number | null>(null)

  const saveNotes = useCallback(async (text: string) => {
    try {
      await fetch(`/api/meetings/${meetingId}/conductor/notes`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: text }),
      })
      setNotesSaved(true)
    } catch { /* will retry on next edit */ }
  }, [meetingId])

  const onNotesChange = (text: string) => {
    setNotes(text)
    setNotesSaved(false)
    if (notesSaveRef.current) clearTimeout(notesSaveRef.current)
    notesSaveRef.current = setTimeout(() => saveNotes(text), 1200)
  }

  // ── Editable agenda durations (before the meeting starts) ───────────────────
  const [editingTimes, setEditingTimes]   = useState(false)
  const [draftAgenda, setDraftAgenda]     = useState<AgendaItem[] | null>(null)
  const [savingAgenda, setSavingAgenda]   = useState(false)

  const openTimeEditor = () => {
    setDraftAgenda(JSON.parse(JSON.stringify(state?.agenda ?? [])))
    setEditingTimes(true)
  }

  const setItemDuration = (topIdx: number, childIdx: number | null, val: number) => {
    setDraftAgenda(prev => {
      if (!prev) return prev
      const copy: AgendaItem[] = JSON.parse(JSON.stringify(prev))
      if (childIdx === null) copy[topIdx].duration_min = val
      else if (copy[topIdx].children) copy[topIdx].children![childIdx].duration_min = val
      return copy
    })
  }

  const saveAgenda = async () => {
    if (!draftAgenda) return
    setSavingAgenda(true)
    try {
      await fetch(`/api/meetings/${meetingId}/agenda`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agenda: draftAgenda }),
      })
      await fetchState()
      setEditingTimes(false)
    } finally { setSavingAgenda(false) }
  }

  // ── Roll call attendance ────────────────────────────────────────────────────
  type AttEntry = { status: 'present' | 'apology' | 'absent' | ''; comment: string }
  const [attendance, setAttendance] = useState<Record<string, AttEntry>>({})
  const attLoadedRef = useRef(false)
  const attSaveRef   = useRef<ReturnType<typeof setTimeout> | null>(null)

  const queueAttSave = (att: Record<string, AttEntry>) => {
    if (attSaveRef.current) clearTimeout(attSaveRef.current)
    attSaveRef.current = setTimeout(() => {
      fetch(`/api/meetings/${meetingId}/attendance`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendance: att }),
      }).catch(() => {})
    }, 800)
  }

  const setMemberStatus = (member: string, status: AttEntry['status']) => {
    setAttendance(prev => {
      const cur = prev[member] ?? { status: '', comment: '' }
      // tapping the active status again clears it
      const next = { ...prev, [member]: { ...cur, status: cur.status === status ? '' : status } }
      queueAttSave(next)
      return next
    })
  }

  const setMemberComment = (member: string, comment: string) => {
    setAttendance(prev => {
      const cur = prev[member] ?? { status: '', comment: '' }
      const next = { ...prev, [member]: { ...cur, comment } }
      queueAttSave(next)
      return next
    })
  }

  // Upload a recording blob directly (called automatically when recording stops)
  const uploadBlob = async (blob: Blob) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('audio_file', blob, 'meeting_recording.webm')
      const res = await fetch(`/api/meetings/${meetingId}/recording`, {
        method: 'POST', credentials: 'include', body: fd,
      })
      if (res.ok) setUploadedAudio(true)
    } catch { /* non-blocking */ }
    finally { setUploading(false) }
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        stream.getTracks().forEach(t => t.stop())
        // Auto-upload immediately so the Process modal already has the recording
        uploadBlob(blob)
      }
      mr.start()
      mediaRef.current = mr
      setRecording(true)
      setRecError('')
    } catch {
      // Mic blocked/unavailable — the meeting still runs but NO audio is captured.
      // Make this loud so nobody assumes a recording exists.
      setRecError('Microphone is blocked, so this meeting is NOT being recorded. Allow microphone access in your browser and reopen the conductor, or rely on a Tactiq transcript / your typed notes for the minutes.')
    }
  }

  const stopRecording = () => {
    mediaRef.current?.stop()
    setRecording(false)
  }

  // ── Polling ──────────────────────────────────────────────────────────────
  const fetchState = useCallback(async () => {
    try {
      const res  = await fetch(`/api/meetings/${meetingId}/conductor`, { credentials: 'include' })
      const data = await res.json()
      if (res.ok) {
        setState(data)
        setLocalElapsed(data.total_elapsed_s ?? 0)
        setLocalItemElapsed(data.item_elapsed_s ?? 0)
        // Load saved notes once (don't clobber what the secretary is typing)
        if (!notesLoadedRef.current) {
          setNotes(data.notes ?? '')
          notesLoadedRef.current = true
        }
        if (!attLoadedRef.current) {
          setAttendance(data.attendance ?? {})
          attLoadedRef.current = true
        }
        if (data.recording_present) setUploadedAudio(true)
      }
    } finally {
      setLoading(false)
    }
  }, [meetingId])

  useEffect(() => {
    fetchState()
    pollRef.current = setInterval(fetchState, 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchState])

  // Local tick between polls
  useEffect(() => {
    tickRef.current = setInterval(() => {
      if (state?.started && !state.ended) {
        setLocalElapsed(e => e + 1)
        setLocalItemElapsed(e => e + 1)
      }
    }, 1000)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [state?.started, state?.ended])

  // When the secretary advances to a new agenda item, drop a section header into
  // the notes so what's typed stays organised by item. Only fires on an actual
  // advance during this session (not on initial load), so notes are never clobbered.
  useEffect(() => {
    const ci = state?.current_item ?? null
    if (ci == null || ci < 0 || !state?.started || state.ended) return
    if (lastItemRef.current === null) { lastItemRef.current = ci; return }
    if (lastItemRef.current === ci) return
    lastItemRef.current = ci
    const label = flatten(state.agenda)[ci]?.label
    if (!label) return
    setNotes(prev => {
      const next = (prev.replace(/\s+$/, '') + (prev.trim() ? '\n\n' : '')) + `— ${label} —\n`
      setNotesSaved(false)
      if (notesSaveRef.current) clearTimeout(notesSaveRef.current)
      notesSaveRef.current = setTimeout(() => saveNotes(next), 1200)
      return next
    })
  }, [state?.current_item, state?.started, state?.ended])

  // ── Admin actions ────────────────────────────────────────────────────────
  const act = async (path: string, body?: object) => {
    setActing(true)
    try {
      await fetch(`/api/meetings/${meetingId}/conductor/${path}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      await fetchState()
    } finally { setActing(false) }
  }

  const goto = async (index: number) => {
    setActing(true)
    try {
      await fetch(`/api/meetings/${meetingId}/conductor/goto`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index }),
      })
      await fetchState()
    } finally { setActing(false) }
  }

  const startMeeting = async () => {
    await startRecording()   // always record — error is non-blocking
    await act('start')
  }

  const endMeeting = async () => {
    if (recording) stopRecording()
    await act('end')
    setTimeout(() => setShowTranscriptPrompt(true), 600)
  }

  if (loading) return (
    <div className="fixed inset-0 z-60 flex items-center justify-center"
      style={{ background: '#050d1a' }}>
      <p className="text-sm" style={{ color: '#475569' }}>Loading conductor…</p>
    </div>
  )

  if (!state) return (
    <div className="fixed inset-0 z-60 flex flex-col items-center justify-center gap-3 p-6"
      style={{ background: '#050d1a' }}>
      <p className="text-sm text-center" style={{ color: '#f87171' }}>
        Couldn't load the meeting conductor. Please try again.
      </p>
      <button onClick={onClose}
        className="text-xs px-4 py-2 rounded-lg"
        style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }}>
        Close
      </button>
    </div>
  )

  const flat       = flatten(state.agenda)
  const current    = state.current_item ?? -1
  const currentItem = flat[current] ?? null
  const nextItem   = flat[current + 1] ?? null
  const budgetSecs = (currentItem?.duration_min ?? 0) * 60
  const overTime   = budgetSecs > 0 && localItemElapsed > budgetSecs
  const plannedMin = flat.reduce((s, i) => s + (i.duration_min || 0), 0)
  const fmtMins    = (mins: number) => mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`

  // ── Transcript prompt (shown immediately after meeting ends) ────────────────
  if (showTranscriptPrompt) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: '#050d1a' }}>
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center space-y-2">
          <p className="text-2xl font-bold" style={{ color: '#4ade80' }}>Meeting ended</p>
          {localElapsed > 0 && (
            <p className="text-sm" style={{ color: '#475569' }}>Duration: {fmtTime(localElapsed)}</p>
          )}
        </div>

        {/* Recording is uploaded automatically when the meeting ends */}
        {uploading && (
          <p className="text-xs text-center" style={{ color: '#64748b' }}>Uploading recording…</p>
        )}
        {uploadedAudio && (
          <p className="text-xs text-center" style={{ color: '#4ade80' }}>✓ Meeting recording captured — it'll be used automatically</p>
        )}

        <div className="rounded-xl p-4 space-y-3" style={{ background: '#0d1829', border: '1px solid #1e293b' }}>
          <p className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>
            Do you have a Tactiq transcript?
          </p>
          <p className="text-[11px]" style={{ color: '#475569' }}>
            If yes, paste or upload it now to combine with any recording. You can also skip and process later.
          </p>
          <div className="space-y-2">
            <button onClick={() => { setShowTranscriptPrompt(false); setShowProcess(true) }}
              className="w-full py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #3b82f655' }}>
              Yes, paste / upload transcript →
            </button>
            <button onClick={() => { setShowTranscriptPrompt(false); setShowProcess(true) }}
              className="w-full py-2.5 rounded-xl text-sm font-medium"
              style={{ background: '#14532d33', color: '#4ade80', border: '1px solid #16683444' }}>
              No — process with recording only →
            </button>
            <button onClick={() => { setShowTranscriptPrompt(false); onClose() }}
              className="w-full py-2 rounded-xl text-xs"
              style={{ background: 'transparent', color: '#334155', border: '1px solid #1e293b' }}>
              Skip for now — I'll process later
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  if (showProcess) return (
    <MeetingProcessModal
      meetingId={meetingId}
      meetingRef={meetingRef}
      initialNotes={notes}
      recordingCaptured={uploadedAudio}
      onClose={() => { setShowProcess(false); onClose() }}
      onConfirmed={() => { setShowProcess(false); onMeetingProcessed() }}
    />
  )

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#050d1a' }}>

      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid #1e293b' }}>
        <div>
          <p className="text-xs font-semibold" style={{ color: '#93c5fd' }}>{state.meeting_ref}</p>
          <p className="text-[10px]" style={{ color: '#334155' }}>{state.date} · {state.venue}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Total elapsed */}
          {state.started && !state.ended && (
            <div className="text-center">
              <p className="text-lg font-mono font-bold" style={{ color: '#475569' }}>
                {fmtTime(localElapsed)}
              </p>
              <p className="text-[9px]" style={{ color: '#334155' }}>total</p>
            </div>
          )}
          {/* REC badge — shown to ALL participants when recording. On the admin's own
              device, suppress it if the mic was blocked (recError) to avoid a false REC. */}
          {state?.recording && !(isAdmin && recError) && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
              style={{ background: '#7f1d1d55', border: '1px solid #ef444466' }}>
              <div className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: '#ef4444', boxShadow: '0 0 6px #ef4444', animation: 'pulse 1.2s ease-in-out infinite' }} />
              <span className="text-[11px] font-semibold" style={{ color: '#fca5a5' }}>REC</span>
            </div>
          )}
          {isAdmin && recError && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
              style={{ background: '#78350f55', border: '1px solid #f59e0b66' }}>
              <span className="text-[11px] font-semibold" style={{ color: '#fcd34d' }}>⚠ NOT recording</span>
            </div>
          )}
          <button onClick={onClose} style={{ color: '#475569', fontSize: 18 }}>✕</button>
        </div>
      </div>

      {/* Recording-failure banner — loud so nobody assumes audio exists */}
      {isAdmin && recError && (
        <div className="px-4 py-2 text-xs text-center" style={{ background: '#78350f', color: '#fde68a' }}>
          {recError}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-4 overflow-hidden">

        {!state.started && !editingTimes && (
          <div className="text-center space-y-6 max-w-sm">
            <p className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>Ready to start</p>
            <p className="text-sm" style={{ color: '#475569' }}>
              {flat.length} agenda items · est. {fmtMins(plannedMin)} · tap to begin
            </p>
            {isAdmin && (
              <>
                <button onClick={startMeeting} disabled={acting}
                  className="w-full py-4 rounded-2xl text-lg font-bold disabled:opacity-40"
                  style={{ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #3b82f655' }}>
                  {acting ? 'Starting…' : 'Start Meeting →'}
                </button>
                <button onClick={openTimeEditor}
                  className="text-xs underline"
                  style={{ color: '#64748b' }}>
                  Adjust time per agenda item
                </button>
              </>
            )}
            {!isAdmin && (
              <p className="text-sm text-center" style={{ color: '#334155' }}>
                Waiting for admin to start the meeting…
              </p>
            )}
          </div>
        )}

        {!state.started && editingTimes && draftAgenda && (
          <div className="w-full max-w-md space-y-3 overflow-y-auto" style={{ maxHeight: '70vh' }}>
            <p className="text-base font-bold text-center" style={{ color: '#e2e8f0' }}>Set time per item</p>
            <p className="text-sm text-center font-semibold" style={{ color: '#93c5fd' }}>
              Total meeting budget: {fmtMins(flatten(draftAgenda).reduce((s, i) => s + (i.duration_min || 0), 0))}
            </p>
            <p className="text-[11px] text-center" style={{ color: '#64748b' }}>
              These are just budgets — nothing auto-advances. The clock turns red when an item runs over.
            </p>
            <div className="space-y-1.5">
              {draftAgenda.map((item, ti) => (
                item.type === 'section' ? (
                  <div key={ti} className="pt-2">
                    <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#475569' }}>{item.label}</p>
                    {(item.children ?? []).map((child, ci) => (
                      <DurationRow key={ci} label={child.label} value={child.duration_min}
                        onChange={v => setItemDuration(ti, ci, v)} indent />
                    ))}
                  </div>
                ) : (
                  <DurationRow key={ti} label={item.label} value={item.duration_min}
                    onChange={v => setItemDuration(ti, null, v)} />
                )
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setEditingTimes(false)}
                className="flex-1 py-2.5 rounded-xl text-sm"
                style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }}>
                Cancel
              </button>
              <button onClick={saveAgenda} disabled={savingAgenda}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
                style={{ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #3b82f655' }}>
                {savingAgenda ? 'Saving…' : 'Save times'}
              </button>
            </div>
          </div>
        )}

        {state.started && !state.ended && currentItem && (
          <div className="w-full max-w-lg text-center space-y-6">

            {/* Item timer */}
            <div>
              <p className={`text-5xl font-mono font-bold ${overTime ? 'animate-pulse' : ''}`}
                style={{ color: overTime ? '#f87171' : '#e2e8f0' }}>
                {fmtTime(localItemElapsed)}
              </p>
              {budgetSecs > 0 && (
                <p className="text-xs mt-1" style={{ color: overTime ? '#ef444488' : '#334155' }}>
                  {overTime ? 'over time' : `of ${currentItem.duration_min} min`}
                </p>
              )}
            </div>

            {/* Current item */}
            <div className="space-y-2">
              {currentItem.is_section_child && (
                <p className="text-xs uppercase tracking-widest" style={{ color: '#334155' }}>
                  {flat.find(f => f.is_section_header && !f.is_section_child && flat.indexOf(f) < current)?.label}
                </p>
              )}
              <p className="text-3xl font-bold leading-tight" style={{ color: '#f1f5f9' }}>
                {currentItem.label}
              </p>
              {currentItem.presenter && (
                <p className="text-base" style={{ color: '#60a5fa' }}>
                  {currentItem.presenter}
                </p>
              )}
              {moduleLinkFor(currentItem) && (
                <a href={moduleLinkFor(currentItem)!.path} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg mt-1"
                  style={{ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #3b82f655' }}>
                  ↗ Open {moduleLinkFor(currentItem)!.label}
                </a>
              )}
            </div>

            {/* Next item preview */}
            {nextItem && (
              <div className="rounded-xl px-4 py-3" style={{ background: '#0d1829', border: '1px solid #1e293b' }}>
                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#334155' }}>Next</p>
                <p className="text-sm" style={{ color: '#475569' }}>{nextItem.label}</p>
                {nextItem.presenter && (
                  <p className="text-[11px] mt-0.5" style={{ color: '#334155' }}>{nextItem.presenter}</p>
                )}
              </div>
            )}

            {/* Roll call — shown when the current item is the attendance item */}
            {isAdmin && /attendance/i.test(currentItem.label) && state.members && (
              <RollCall members={state.members} attendance={attendance}
                onStatus={setMemberStatus} onComment={setMemberComment} />
            )}

            {/* Admin controls */}
            {isAdmin && (
              <div className="flex gap-3">
                <button
                  onClick={endMeeting}
                  disabled={acting}
                  className="px-5 py-3 rounded-xl text-sm font-semibold disabled:opacity-40"
                  style={{ background: '#7f1d1d33', color: '#fca5a5', border: '1px solid #ef444433' }}>
                  End meeting
                </button>
                <button
                  onClick={() => act('next')}
                  disabled={acting || current >= flat.length - 1}
                  className="flex-1 py-3 rounded-xl text-base font-bold disabled:opacity-40"
                  style={{ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #3b82f655' }}>
                  {acting ? '…' : current >= flat.length - 1 ? 'Last item' : 'Next →'}
                </button>
              </div>
            )}

            {/* Live secretary notes — typed throughout the meeting */}
            {isAdmin && (
              <div className="rounded-xl p-3 space-y-2" style={{ background: '#0d1829', border: '1px solid #1e293b' }}>
                <div className="flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#c4b5fd' }}>
                    Meeting notes
                  </p>
                  <span className="text-[10px]" style={{ color: notesSaved ? '#4ade80' : '#64748b' }}>
                    {notesSaved ? '✓ saved' : 'saving…'}
                  </span>
                </div>
                <textarea
                  value={notes}
                  onChange={e => onNotesChange(e.target.value)}
                  placeholder="Type minutes as the meeting goes — decisions, who said what, amounts. Headers are added automatically as you advance items."
                  rows={5}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-y"
                  style={{ background: '#121824', color: '#e2e8f0', border: '1px solid #334155' }}
                />
              </div>
            )}
          </div>
        )}

        {state.ended && (
          <div className="text-center space-y-4 max-w-md w-full overflow-y-auto" style={{ maxHeight: '78vh' }}>
            <p className="text-2xl font-bold" style={{ color: '#4ade80' }}>Meeting ended</p>
            <p className="text-sm" style={{ color: '#475569' }}>
              Duration: {fmtTime(localElapsed)}
            </p>
            {uploading && (
              <p className="text-sm" style={{ color: '#64748b' }}>Uploading recording…</p>
            )}
            {uploadedAudio && (
              <p className="text-sm" style={{ color: '#4ade80' }}>✓ Recording captured</p>
            )}

            {/* Finalize attendance — late arrivals can be corrected here */}
            {isAdmin && state.members && (
              <RollCall members={state.members} attendance={attendance}
                onStatus={setMemberStatus} onComment={setMemberComment} />
            )}

            {/* Time audit — which items ran over their budget */}
            {state.timings && Object.keys(state.timings).length > 0 && (
              <div className="rounded-xl p-3 text-left" style={{ background: '#0d1829', border: '1px solid #1e293b' }}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#94a3b8' }}>
                    Time per item (planned → actual)
                  </p>
                  {(() => {
                    const actualTot = Object.values(state.timings).reduce((s, t) => s + (t.actual_s || 0), 0)
                    const over = actualTot > plannedMin * 60
                    return (
                      <span className="text-[11px] font-semibold" style={{ color: over ? '#f87171' : '#4ade80' }}>
                        {fmtMins(plannedMin)} → {fmtTime(actualTot)}
                      </span>
                    )
                  })()}
                </div>
                <div className="space-y-1">
                  {Object.entries(state.timings)
                    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                    .map(([k, t]) => {
                      const plannedS = (t.planned_min || 0) * 60
                      const over = plannedS > 0 && t.actual_s > plannedS
                      return (
                        <div key={k} className="flex items-center justify-between text-xs">
                          <span className="truncate flex-1" style={{ color: '#cbd5e1' }}>{t.label}</span>
                          <span className="ml-2" style={{ color: over ? '#f87171' : '#64748b' }}>
                            {t.planned_min}m → {fmtTime(t.actual_s)}{over ? ' ⚠' : ''}
                          </span>
                        </div>
                      )
                    })}
                </div>
              </div>
            )}
            {isAdmin && (
              <button onClick={() => setShowTranscriptPrompt(true)}
                className="w-full py-3 rounded-xl text-sm font-semibold"
                style={{ background: '#4c1d9544', color: '#a78bfa', border: '1px solid #4c1d9555' }}>
                Process minutes →
              </button>
            )}
            <button onClick={onClose}
              className="w-full py-2 rounded-xl text-xs"
              style={{ background: 'transparent', color: '#334155', border: '1px solid #1e293b' }}>
              Close
            </button>
          </div>
        )}
      </div>

      {/* Agenda list — scrollable bottom panel */}
      <div className="flex-shrink-0 overflow-x-auto"
        style={{ borderTop: '1px solid #334155', background: '#0b1220', maxHeight: '28vh' }}>
        <div className="flex gap-2 px-4 py-3 min-w-max">
          {flat.map((item, i) => {
            const isDone    = state.started && i < current
            const isCurrent = state.started && i === current
            const isHeader  = item.is_section_header
            return (
              <button
                key={i}
                onClick={() => isAdmin && state.started && goto(i)}
                disabled={!isAdmin || !state.started || acting}
                className="flex-shrink-0 rounded-lg px-3 py-2 text-left transition-all"
                style={{
                  minWidth: isHeader ? 100 : 120,
                  background: isCurrent ? '#1e3a5f'
                            : isDone    ? '#14532d55'
                            : '#1e293b',
                  border: isCurrent ? '1px solid #3b82f6'
                        : isDone    ? '1px solid #22c55e88'
                        : '1px solid #475569',
                  opacity: isHeader ? 0.85 : 1,
                }}>
                <p className="text-[10px] font-semibold truncate max-w-[110px]"
                  style={{ color: isCurrent ? '#bfdbfe' : isDone ? '#86efac' : '#e2e8f0' }}>
                  {item.is_section_child ? '  └ ' : ''}{item.label}
                </p>
                {item.presenter && (
                  <p className="text-[9px] truncate max-w-[110px]" style={{ color: isCurrent ? '#93c5fd' : '#94a3b8' }}>{item.presenter}</p>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
