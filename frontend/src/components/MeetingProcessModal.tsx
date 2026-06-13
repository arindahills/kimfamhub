import { useState, useRef } from 'react'

type TextMode = 'paste' | 'file'
type Stage    = 'input' | 'review' | 'doc'

interface ExtractedAction {
  description: string
  assignees: string[]
  deadline: string | null
  priority: string
  project_id: string | null
  matches_existing: string | null
}

interface ExistingUpdate {
  ref: string
  note: string
  new_status: string | null
}

interface Extracted {
  summary: string
  key_topics: string
  key_decisions: string[]
  new_actions: ExtractedAction[]
  updates_to_existing: ExistingUpdate[]
}

interface ProcessResult {
  ok: boolean
  meeting_ref: string
  transcript_preview: string
  extracted: Extracted
}

interface MinutesData {
  meeting_ref: string
  date: string
  venue: string
  start_time_eat: string
  summary: string
  key_topics: string
  key_decisions: string[]
  actions: { ref: string; description: string; assignees: string[]; deadline: string; priority: string }[]
}

interface ConfirmResult {
  ok: boolean
  created: string[]
  updated: number
  draft_url: string
  minutes_data: MinutesData
}

interface Props {
  meetingId: number
  meetingRef: string
  onClose: () => void
  onConfirmed: () => void
}

const INDIVIDUAL_MEMBERS = ['Hillary', 'Hellen', 'Alex', 'Solomon', 'Viola', 'Max', 'James']
const PRIORITIES = ['high', 'medium', 'low']
const PRIORITY_COLOR: Record<string, string> = { high: '#f87171', medium: '#fbbf24', low: '#64748b' }
const PROJECTS = [
  { id: 'chicken',        name: 'Free Range Chicken' },
  { id: 'washing_bay',   name: 'Washing Bay' },
  { id: 'sheep',         name: 'Sheep (Dorper)' },
  { id: 'goats',         name: 'Goats' },
  { id: 'dairy',         name: 'Dairy (Cows)' },
  { id: 'mango',         name: 'Mango & Oranges' },
  { id: 'trees',         name: 'Tree Planting' },
  { id: 'bees',          name: 'Apiary (Bees)' },
  { id: 'rabbits',       name: 'Rabbits' },
  { id: 'irrigation',    name: 'Irrigation & Bananas' },
  { id: 'fortune_credit',name: 'Fortune Credit' },
  { id: 'kakoba',        name: 'Kakoba Land' },
]

export default function MeetingProcessModal({ meetingId, meetingRef, onClose, onConfirmed }: Props) {
  // ── Input stage ─────────────────────────────────────────────────────────────
  const [textMode, setTextMode]     = useState<TextMode>('paste')
  const [pasteText, setPasteText]   = useState('')
  const [audioFile, setAudioFile]   = useState<File | null>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const audioRef = useRef<HTMLInputElement>(null)
  const fileRef  = useRef<HTMLInputElement>(null)

  // ── Stage + shared state ────────────────────────────────────────────────────
  const [stage, setStage]     = useState<Stage>('input')
  const [processing, setProcessing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError]     = useState('')

  // ── Review stage ────────────────────────────────────────────────────────────
  const [result, setResult]   = useState<ProcessResult | null>(null)
  const [edited, setEdited]   = useState<Extracted | null>(null)
  const ext = edited ?? result?.extracted

  // ── Doc stage ───────────────────────────────────────────────────────────────
  const [confirmResult, setConfirmResult] = useState<ConfirmResult | null>(null)
  const [minutesData, setMinutesData]     = useState<MinutesData | null>(null)
  const [editInstruction, setEditInstruction] = useState('')
  const [applying, setApplying]           = useState(false)

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const hasAudio = !!audioFile
  const hasText  = textMode === 'paste' ? pasteText.trim().length > 0
                                        : !!uploadFile

  const submit = async () => {
    if (!hasAudio && !hasText) {
      setError('Please provide at least one source — audio or text.')
      return
    }
    setError(''); setProcessing(true)
    try {
      const fd = new FormData()
      if (audioFile) fd.append('audio_file', audioFile)
      if (textMode === 'paste' && pasteText.trim()) {
        fd.append('transcript_text', pasteText)
      } else if (textMode === 'file' && uploadFile) {
        fd.append('transcript_file', uploadFile)
      }

      const res  = await fetch(`/api/meetings/${meetingId}/process`, {
        method: 'POST', credentials: 'include', body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Processing failed')

      setResult(data)
      const normalised: Extracted = {
        ...data.extracted,
        new_actions: (data.extracted.new_actions || []).map((a: any) => ({
          ...a,
          assignees: Array.isArray(a.assignees) ? a.assignees
            : a.assignee ? [a.assignee] : [],
          project_id: a.project_id ?? null,
        })),
      }
      setEdited(normalised)
      setStage('review')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setProcessing(false)
    }
  }

  const confirm = async () => {
    if (!result || !edited) return
    setConfirming(true); setError('')
    try {
      const res  = await fetch(`/api/meetings/${meetingId}/confirm`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extracted: edited, meeting_ref: result.meeting_ref }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Confirm failed')
      setConfirmResult(data)
      setMinutesData(data.minutes_data ?? null)
      setStage('doc')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setConfirming(false)
    }
  }

  const applyEdit = async () => {
    const instr = editInstruction.trim()
    if (!instr) return
    setApplying(true); setError('')
    try {
      const res  = await fetch(`/api/meetings/${meetingId}/minutes/edit`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: instr }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Edit failed')
      setMinutesData(data.minutes_data)
      setEditInstruction('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setApplying(false)
    }
  }

  const publish = async () => {
    setPublishing(true); setError('')
    try {
      const res  = await fetch(`/api/meetings/${meetingId}/publish`, {
        method: 'POST', credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Publish failed')
      onConfirmed()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setPublishing(false)
    }
  }

  // ── Action editors ───────────────────────────────────────────────────────────
  const updateAction = (i: number, field: keyof ExtractedAction, val: string | string[] | null) => {
    if (!edited) return
    const actions = [...edited.new_actions]
    actions[i] = { ...actions[i], [field]: val }
    setEdited({ ...edited, new_actions: actions })
  }

  const toggleAssignee = (idx: number, member: string) => {
    if (!edited) return
    const a = edited.new_actions[idx]
    if (member === 'All Members') {
      updateAction(idx, 'assignees', ['All Members'])
      return
    }
    const current = a.assignees.filter(x => x !== 'All Members')
    const next = current.includes(member)
      ? current.filter(x => x !== member)
      : [...current, member]
    updateAction(idx, 'assignees', next.length ? next : ['Unknown'])
  }

  const removeAction = (i: number) => {
    if (!edited) return
    setEdited({ ...edited, new_actions: edited.new_actions.filter((_, idx) => idx !== i) })
  }

  const addAction = () => {
    if (!edited) return
    setEdited({
      ...edited,
      new_actions: [...edited.new_actions, {
        description: '', assignees: [], deadline: null,
        priority: 'medium', project_id: null, matches_existing: null,
      }],
    })
  }

  // ── Source indicator chips ───────────────────────────────────────────────────
  function SourceChip({ active, label }: { active: boolean; label: string }) {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full"
        style={{
          background: active ? '#14532d33' : '#1e293b',
          color:      active ? '#4ade80'   : '#475569',
          border:     active ? '1px solid #166834' : '1px solid #334155',
        }}>
        {active ? '✓ ' : ''}{label}
      </span>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>

      <div className="w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col"
        style={{ background: '#121824', border: '1px solid #1e293b', maxHeight: '90vh' }}>

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between flex-shrink-0"
          style={{ borderBottom: '1px solid #1e293b' }}>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>Process Meeting</h2>
            <p className="text-[11px] mt-0.5" style={{ color: '#475569' }}>{meetingRef}</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Stage breadcrumb */}
            <div className="hidden sm:flex items-center gap-1 text-[10px]" style={{ color: '#334155' }}>
              <span style={{ color: stage === 'input'  ? '#93c5fd' : '#475569' }}>1 Source</span>
              <span>›</span>
              <span style={{ color: stage === 'review' ? '#93c5fd' : '#475569' }}>2 Review</span>
              <span>›</span>
              <span style={{ color: stage === 'doc'    ? '#93c5fd' : '#475569' }}>3 Approve</span>
            </div>
            <button onClick={onClose} className="text-lg leading-none" style={{ color: '#475569' }}>✕</button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">

          {/* ═══════════════════════════════ STAGE 1: INPUT ══════════════════════════════ */}
          {stage === 'input' && (
            <>
              <p className="text-[11px]" style={{ color: '#64748b' }}>
                Provide one or both sources. If you upload both, the AI will reconcile them automatically.
              </p>

              {/* Audio source */}
              <div className="rounded-xl p-4 space-y-3"
                style={{ background: '#0d1829', border: `1px solid ${hasAudio ? '#3b82f6' : '#1e293b'}` }}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold" style={{ color: '#93c5fd' }}>Audio recording</p>
                  <SourceChip active={hasAudio} label="audio" />
                </div>
                <p className="text-[10px]" style={{ color: '#475569' }}>
                  Voice Memo, Tactiq export, phone recording — .mp3 .m4a .wav .ogg .webm (max 25 MB)
                </p>
                <input ref={audioRef} type="file"
                  accept=".mp3,.m4a,.wav,.ogg,.webm,audio/*"
                  onChange={e => setAudioFile(e.target.files?.[0] ?? null)}
                  className="hidden" />
                <button onClick={() => audioRef.current?.click()}
                  className="w-full py-4 rounded-xl text-sm border-dashed border-2 transition-colors"
                  style={{ borderColor: hasAudio ? '#3b82f6' : '#334155', color: hasAudio ? '#93c5fd' : '#475569' }}>
                  {hasAudio ? `✓ ${audioFile!.name}` : 'Tap to select audio file'}
                </button>
                {hasAudio && (
                  <button onClick={() => setAudioFile(null)}
                    className="text-[10px]" style={{ color: '#475569' }}>
                    Remove
                  </button>
                )}
              </div>

              {/* Text source */}
              <div className="rounded-xl p-4 space-y-3"
                style={{ background: '#0d1829', border: `1px solid ${hasText ? '#3b82f6' : '#1e293b'}` }}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold" style={{ color: '#93c5fd' }}>Text transcript</p>
                  <SourceChip active={hasText} label="text" />
                </div>

                {/* Sub-mode toggle */}
                <div className="flex gap-2">
                  {(['paste', 'file'] as TextMode[]).map(m => (
                    <button key={m} onClick={() => setTextMode(m)}
                      className="text-[10px] px-3 py-1 rounded-full transition-all"
                      style={{
                        background: textMode === m ? '#1e3a5f' : '#1e293b',
                        color:      textMode === m ? '#93c5fd' : '#64748b',
                        border:     textMode === m ? '1px solid #3b82f655' : '1px solid #334155',
                      }}>
                      {m === 'paste' ? 'Paste text' : 'Upload .txt / .docx'}
                    </button>
                  ))}
                </div>

                {textMode === 'paste' ? (
                  <textarea
                    value={pasteText}
                    onChange={e => setPasteText(e.target.value)}
                    placeholder="Paste Tactiq export, notes, or a typed summary here…"
                    rows={8}
                    className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none"
                    style={{ background: '#121824', color: '#e2e8f0', border: '1px solid #334155' }}
                  />
                ) : (
                  <>
                    <input ref={fileRef} type="file"
                      accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
                      className="hidden" />
                    <button onClick={() => fileRef.current?.click()}
                      className="w-full py-4 rounded-xl text-sm border-dashed border-2 transition-colors"
                      style={{ borderColor: uploadFile ? '#3b82f6' : '#334155', color: uploadFile ? '#93c5fd' : '#475569' }}>
                      {uploadFile ? `✓ ${uploadFile.name}` : 'Tap to select .txt or .docx'}
                    </button>
                    {uploadFile && (
                      <button onClick={() => setUploadFile(null)}
                        className="text-[10px]" style={{ color: '#475569' }}>
                        Remove
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Active sources summary */}
              {(hasAudio || hasText) && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px]" style={{ color: '#475569' }}>Will use:</span>
                  {hasAudio && <SourceChip active label={audioFile!.name} />}
                  {hasText && textMode === 'paste' && <SourceChip active label="pasted text" />}
                  {hasText && textMode === 'file' && <SourceChip active label={uploadFile!.name} />}
                  {hasAudio && hasText && (
                    <span className="text-[10px]" style={{ color: '#64748b' }}>— sources will be combined</span>
                  )}
                </div>
              )}

              {error && <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>}

              <button onClick={submit} disabled={processing || (!hasAudio && !hasText)}
                className="w-full py-3 rounded-xl text-sm font-semibold disabled:opacity-40 transition-opacity"
                style={{ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #3b82f655' }}>
                {processing ? 'Transcribing + extracting…' : 'Extract actions and decisions →'}
              </button>
            </>
          )}

          {/* ═══════════════════════════════ STAGE 2: REVIEW ════════════════════════════ */}
          {stage === 'review' && result && ext && (
            <>
              {/* Transcript preview */}
              <div className="rounded-lg px-3 py-2" style={{ background: '#0d1829', border: '1px solid #1e293b' }}>
                <p className="text-[10px] mb-1" style={{ color: '#475569' }}>Transcript preview</p>
                <p className="text-[11px]" style={{ color: '#64748b' }}>{result.transcript_preview}</p>
              </div>

              {/* Summary */}
              <div>
                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#475569' }}>Summary</p>
                <p className="text-sm" style={{ color: '#94a3b8' }}>{ext.summary}</p>
              </div>

              {/* Key decisions */}
              {ext.key_decisions.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#475569' }}>
                    Decisions ({ext.key_decisions.length})
                  </p>
                  <ul className="space-y-1">
                    {ext.key_decisions.map((d, i) => (
                      <li key={i} className="text-[11px] flex gap-2" style={{ color: '#94a3b8' }}>
                        <span style={{ color: '#4ade80' }}>✓</span>{d}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* New actions (editable) */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: '#475569' }}>
                    New actions ({ext.new_actions.length})
                  </p>
                  <button onClick={addAction}
                    className="text-[10px] px-2 py-0.5 rounded"
                    style={{ color: '#60a5fa', background: '#1e3a5f44', border: '1px solid #3b82f633' }}>
                    + Add missed
                  </button>
                </div>
                <div className="space-y-2">
                  {ext.new_actions.map((a, i) => (
                    <div key={i} className="rounded-lg p-3 space-y-2"
                      style={{ background: '#0d1829', border: '1px solid #1e293b' }}>

                      <div className="flex items-start gap-2">
                        <input
                          value={a.description}
                          onChange={e => updateAction(i, 'description', e.target.value)}
                          className="flex-1 bg-transparent text-sm outline-none"
                          style={{ color: '#e2e8f0' }}
                          placeholder="Action description"
                        />
                        <button onClick={() => removeAction(i)}
                          className="text-[10px] shrink-0 mt-0.5" style={{ color: '#ef4444' }}>✕</button>
                      </div>

                      <div>
                        <p className="text-[10px] mb-1" style={{ color: '#475569' }}>Assigned to</p>
                        <div className="flex flex-wrap gap-1.5">
                          {INDIVIDUAL_MEMBERS.map(m => {
                            const active = a.assignees.includes(m) && !a.assignees.includes('All Members')
                            return (
                              <button key={m} onClick={() => toggleAssignee(i, m)}
                                className="text-[10px] px-2 py-0.5 rounded-full transition-all"
                                style={{
                                  background: active ? '#1e3a5f' : '#1e293b',
                                  color:      active ? '#93c5fd' : '#475569',
                                  border:     active ? '1px solid #3b82f655' : '1px solid #334155',
                                }}>
                                {m}
                              </button>
                            )
                          })}
                          <button onClick={() => toggleAssignee(i, 'All Members')}
                            className="text-[10px] px-2 py-0.5 rounded-full transition-all"
                            style={{
                              background: a.assignees.includes('All Members') ? '#14532d' : '#1e293b',
                              color:      a.assignees.includes('All Members') ? '#4ade80' : '#475569',
                              border:     a.assignees.includes('All Members') ? '1px solid #16683455' : '1px solid #334155',
                            }}>
                            All Members
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <input type="date" value={a.deadline ?? ''}
                          onChange={e => updateAction(i, 'deadline', e.target.value || null)}
                          className="text-[11px] rounded px-2 py-0.5 outline-none"
                          style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }} />
                        <select value={a.priority}
                          onChange={e => updateAction(i, 'priority', e.target.value)}
                          className="text-[11px] rounded px-2 py-0.5 outline-none"
                          style={{ background: '#1e293b', color: PRIORITY_COLOR[a.priority] ?? '#94a3b8', border: '1px solid #334155' }}>
                          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <select value={a.project_id ?? ''}
                          onChange={e => updateAction(i, 'project_id', e.target.value || null)}
                          className="text-[11px] rounded px-2 py-0.5 outline-none"
                          style={{ background: '#1e293b', color: a.project_id ? '#38bdf8' : '#475569', border: '1px solid #334155' }}>
                          <option value="">No project</option>
                          {PROJECTS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>

                      {a.matches_existing && (
                        <p className="text-[10px]" style={{ color: '#a78bfa' }}>
                          Carried over from {a.matches_existing}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Updates to existing */}
              {ext.updates_to_existing.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: '#475569' }}>
                    Updates to existing actions ({ext.updates_to_existing.length})
                  </p>
                  <div className="space-y-1.5">
                    {ext.updates_to_existing.map((u, i) => (
                      <div key={i} className="rounded-lg px-3 py-2 flex items-start gap-2"
                        style={{ background: '#0d1829', border: '1px solid #1e293b' }}>
                        <span className="text-[10px] font-mono shrink-0 mt-0.5" style={{ color: '#475569' }}>{u.ref}</span>
                        <span className="text-[11px] flex-1" style={{ color: '#64748b' }}>{u.note}</span>
                        {u.new_status && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                            style={{ color: '#60a5fa', background: '#1e3a5f44' }}>{u.new_status}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>}
            </>
          )}

          {/* ═══════════════════════════════ STAGE 3: DOC REVIEW ════════════════════════ */}
          {stage === 'doc' && confirmResult && (
            <div className="space-y-4">

              {/* Saved banner */}
              <div className="rounded-xl px-4 py-3 flex items-center gap-3"
                style={{ background: '#14532d33', border: '1px solid #16683444' }}>
                <span style={{ fontSize: 18 }}>✓</span>
                <p className="text-sm font-semibold" style={{ color: '#4ade80' }}>
                  {confirmResult.created.length} action{confirmResult.created.length !== 1 ? 's' : ''} saved to DB
                  {confirmResult.updated > 0 ? `, ${confirmResult.updated} existing updated` : ''}
                </p>
              </div>

              {/* Document content — rendered in app */}
              {minutesData && (
                <div className="rounded-xl p-4 space-y-4"
                  style={{ background: '#0d1829', border: '1px solid #1e293b' }}>

                  {/* Header */}
                  <div>
                    <p className="text-xs font-bold text-center" style={{ color: '#e2e8f0' }}>
                      KIMFAM INVESTMENT CLUB — MEETING MINUTES
                    </p>
                    <p className="text-[10px] text-center mt-0.5" style={{ color: '#475569' }}>
                      {minutesData.meeting_ref}
                      {minutesData.date ? ` · ${minutesData.date}` : ''}
                      {minutesData.start_time_eat ? ` · ${minutesData.start_time_eat} EAT` : ''}
                      {minutesData.venue ? ` · ${minutesData.venue}` : ''}
                    </p>
                  </div>

                  {/* Summary */}
                  <div>
                    <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#475569' }}>Summary</p>
                    <p className="text-[12px] leading-relaxed" style={{ color: '#94a3b8' }}>{minutesData.summary}</p>
                  </div>

                  {/* Key topics */}
                  {minutesData.key_topics && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#475569' }}>Key Topics</p>
                      <p className="text-[11px]" style={{ color: '#64748b' }}>{minutesData.key_topics}</p>
                    </div>
                  )}

                  {/* Decisions */}
                  {minutesData.key_decisions.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#475569' }}>
                        Key Decisions ({minutesData.key_decisions.length})
                      </p>
                      <ol className="space-y-1 list-decimal list-inside">
                        {minutesData.key_decisions.map((d, i) => (
                          <li key={i} className="text-[11px]" style={{ color: '#94a3b8' }}>{d}</li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {/* Action points */}
                  {minutesData.actions.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: '#475569' }}>
                        Action Points ({minutesData.actions.length})
                      </p>
                      <div className="space-y-1.5">
                        {minutesData.actions.map((a, i) => (
                          <div key={i} className="rounded-lg px-3 py-2 flex flex-wrap items-start gap-x-3 gap-y-0.5"
                            style={{ background: '#121824', border: '1px solid #1e293b' }}>
                            <span className="text-[10px] font-mono shrink-0" style={{ color: '#475569' }}>{a.ref}</span>
                            <span className="text-[11px] flex-1 min-w-0" style={{ color: '#e2e8f0' }}>{a.description}</span>
                            <span className="text-[10px] shrink-0" style={{ color: '#64748b' }}>
                              {Array.isArray(a.assignees) ? a.assignees.join(', ') : a.assignees}
                            </span>
                            {a.deadline && (
                              <span className="text-[10px] shrink-0" style={{ color: '#475569' }}>{a.deadline}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Edit instruction box */}
              <div className="rounded-xl p-4 space-y-2"
                style={{ background: '#0d1829', border: '1px solid #3b82f633' }}>
                <p className="text-[10px] uppercase tracking-wider" style={{ color: '#475569' }}>
                  Request a change
                </p>
                <textarea
                  value={editInstruction}
                  onChange={e => setEditInstruction(e.target.value)}
                  placeholder={'e.g. "Change the summary to focus on the chicken project decision" or "Remove action KIM/09/26-3" or "Fix the spelling of Viola\'s name in action 2"'}
                  rows={3}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
                  style={{ background: '#121824', color: '#e2e8f0', border: '1px solid #334155' }}
                />
                <button
                  onClick={applyEdit}
                  disabled={applying || !editInstruction.trim()}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
                  style={{ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #3b82f655' }}>
                  {applying ? 'Applying change…' : 'Apply change →'}
                </button>
              </div>

              {error && <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>}

              {/* Download + Approve */}
              <div className="space-y-2">
                <a
                  href={`/api/meetings/${meetingId}/minutes/draft`}
                  download={`KimFam_${meetingRef.replace(/\s+/g, '_')}_Minutes.docx`}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm"
                  style={{ background: '#1e293b', color: '#64748b', border: '1px solid #334155', textDecoration: 'none' }}>
                  ↓ Download .docx
                </a>
                <button onClick={publish} disabled={publishing}
                  className="w-full py-3 rounded-xl text-sm font-semibold disabled:opacity-40"
                  style={{ background: '#4c1d9544', color: '#a78bfa', border: '1px solid #4c1d9555' }}>
                  {publishing ? 'Uploading + notifying…' : 'Approve & Send to group →'}
                </button>
                <button onClick={onConfirmed}
                  className="w-full py-1.5 rounded-xl text-xs"
                  style={{ background: 'transparent', color: '#334155', border: '1px solid #1e293b' }}>
                  Save without sending
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer buttons */}
        {stage === 'review' && (
          <div className="px-5 py-4 flex gap-3 flex-shrink-0" style={{ borderTop: '1px solid #1e293b' }}>
            <button onClick={() => { setStage('input'); setResult(null); setEdited(null); setError('') }}
              className="text-xs px-4 py-2 rounded-xl"
              style={{ background: '#1e293b', color: '#64748b', border: '1px solid #334155' }}>
              ← Re-upload
            </button>
            <button onClick={confirm} disabled={confirming}
              className="flex-1 py-2 rounded-xl text-sm font-semibold disabled:opacity-40"
              style={{ background: '#14532d', color: '#4ade80', border: '1px solid #16683455' }}>
              {confirming ? 'Saving + generating minutes…' : 'Confirm and save →'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
