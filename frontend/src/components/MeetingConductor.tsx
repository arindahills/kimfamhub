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
  item_elapsed_s: number | null
  total_elapsed_s: number | null
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

  // ── Audio recorder ───────────────────────────────────────────────────────
  const [recording, setRecording]     = useState(false)
  const [audioBlob, setAudioBlob]     = useState<Blob | null>(null)
  const [uploading, setUploading]     = useState(false)
  const [uploadedAudio, setUploadedAudio] = useState(false)
  const mediaRef   = useRef<MediaRecorder | null>(null)
  const chunksRef  = useRef<Blob[]>([])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setAudioBlob(blob)
        stream.getTracks().forEach(t => t.stop())
      }
      mr.start()
      mediaRef.current = mr
      setRecording(true)
    } catch {
      alert('Microphone access denied. Please allow microphone to record.')
    }
  }

  const stopRecording = () => {
    mediaRef.current?.stop()
    setRecording(false)
  }

  const uploadAudio = async () => {
    if (!audioBlob) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('audio_file', audioBlob, 'meeting_recording.webm')
      // Store it server-side so Process modal can pick it up
      const res = await fetch(`/api/meetings/${meetingId}/recording`, {
        method: 'POST', credentials: 'include', body: fd,
      })
      if (res.ok) setUploadedAudio(true)
    } catch { /* non-blocking */ }
    finally { setUploading(false) }
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

  if (!state) return null

  const flat       = flatten(state.agenda)
  const current    = state.current_item ?? -1
  const currentItem = flat[current] ?? null
  const nextItem   = flat[current + 1] ?? null
  const budgetSecs = (currentItem?.duration_min ?? 0) * 60
  const overTime   = budgetSecs > 0 && localItemElapsed > budgetSecs

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

        {/* Upload recording if captured */}
        {audioBlob && !uploadedAudio && (
          <button onClick={uploadAudio} disabled={uploading}
            className="w-full py-2.5 rounded-xl text-sm font-medium disabled:opacity-40"
            style={{ background: '#1e293b', color: '#64748b', border: '1px solid #334155' }}>
            {uploading ? 'Uploading recording…' : '↑ Upload recording first'}
          </button>
        )}
        {uploadedAudio && (
          <p className="text-xs text-center" style={{ color: '#4ade80' }}>✓ Recording uploaded</p>
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
          {/* Audio indicator */}
          {recording && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full"
              style={{ background: '#7f1d1d44', border: '1px solid #ef4444' }}>
              <div className="w-2 h-2 rounded-full" style={{ background: '#ef4444', animation: 'pulse 1s infinite' }} />
              <span className="text-[10px]" style={{ color: '#fca5a5' }}>REC</span>
            </div>
          )}
          <button onClick={onClose} style={{ color: '#475569', fontSize: 18 }}>✕</button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-4 overflow-hidden">

        {!state.started && (
          <div className="text-center space-y-6 max-w-sm">
            <p className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>Ready to start</p>
            <p className="text-sm" style={{ color: '#475569' }}>
              {flat.length} agenda items · tap to begin
            </p>
            {/* Recording option */}
            <div className="rounded-xl p-4" style={{ background: '#0d1829', border: '1px solid #1e293b' }}>
              <p className="text-[11px] mb-3" style={{ color: '#64748b' }}>
                Record audio alongside Google Meet? (optional)
              </p>
              <button
                onClick={recording ? stopRecording : startRecording}
                className="w-full py-2 rounded-lg text-sm font-medium"
                style={{
                  background: recording ? '#7f1d1d33' : '#1e293b',
                  color:      recording ? '#fca5a5'   : '#64748b',
                  border:     recording ? '1px solid #ef444444' : '1px solid #334155',
                }}>
                {recording ? '⏹ Stop recording' : '🎙 Start recording'}
              </button>
            </div>
            {isAdmin && (
              <button onClick={() => act('start')} disabled={acting}
                className="w-full py-4 rounded-2xl text-lg font-bold disabled:opacity-40"
                style={{ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #3b82f655' }}>
                Start Meeting →
              </button>
            )}
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
          </div>
        )}

        {state.ended && (
          <div className="text-center space-y-4 max-w-sm">
            <p className="text-2xl font-bold" style={{ color: '#4ade80' }}>Meeting ended</p>
            <p className="text-sm" style={{ color: '#475569' }}>
              Duration: {fmtTime(localElapsed)}
            </p>
            {audioBlob && !uploadedAudio && (
              <button onClick={uploadAudio} disabled={uploading}
                className="w-full py-3 rounded-xl text-sm font-semibold disabled:opacity-40"
                style={{ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #3b82f655' }}>
                {uploading ? 'Uploading recording…' : '↑ Upload recording'}
              </button>
            )}
            {uploadedAudio && (
              <p className="text-sm" style={{ color: '#4ade80' }}>✓ Recording uploaded</p>
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
        style={{ borderTop: '1px solid #0f172a', maxHeight: '28vh' }}>
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
                            : isDone    ? '#14532d33'
                            : '#0d1829',
                  border: isCurrent ? '1px solid #3b82f6'
                        : isDone    ? '1px solid #16683444'
                        : '1px solid #1e293b',
                  opacity: isHeader ? 0.7 : 1,
                }}>
                <p className="text-[10px] font-semibold truncate max-w-[110px]"
                  style={{ color: isCurrent ? '#93c5fd' : isDone ? '#4ade80' : '#475569' }}>
                  {item.is_section_child ? '  └ ' : ''}{item.label}
                </p>
                {item.presenter && (
                  <p className="text-[9px] truncate max-w-[110px]" style={{ color: '#334155' }}>{item.presenter}</p>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
