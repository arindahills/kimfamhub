import { useState, useRef } from 'react'

type InputMode = 'audio' | 'paste' | 'file'

interface ExtractedAction {
  description: string
  assignees: string[]       // multi-assignee; "All Members" is a valid single entry
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

interface Props {
  meetingId: number
  meetingRef: string
  onClose: () => void
  onConfirmed: () => void
}

export default function MeetingProcessModal({ meetingId, meetingRef, onClose, onConfirmed }: Props) {
  const [mode, setMode]         = useState<InputMode>('audio')
  const [pasteText, setPasteText] = useState('')
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError]       = useState('')
  const [result, setResult]     = useState<ProcessResult | null>(null)
  const [edited, setEdited]     = useState<Extracted | null>(null)
  const [confirming, setConfirming] = useState(false)
  const audioRef = useRef<HTMLInputElement>(null)
  const fileRef  = useRef<HTMLInputElement>(null)

  const ext = edited ?? result?.extracted

  const submit = async () => {
    setError(''); setProcessing(true)
    try {
      const fd = new FormData()
      if (mode === 'audio' && audioFile)   fd.append('audio_file', audioFile)
      else if (mode === 'paste')           fd.append('transcript_text', pasteText)
      else if (mode === 'file' && uploadFile) fd.append('transcript_file', uploadFile)
      else { setError('Please provide a transcript.'); setProcessing(false); return }

      const res = await fetch(`/api/meetings/${meetingId}/process`, {
        method: 'POST', credentials: 'include', body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Processing failed')
      setResult(data)
      // Normalise: Claude may return {assignee: "Hillary"} — coerce to {assignees: ["Hillary"]}
      const normalised = {
        ...data.extracted,
        new_actions: (data.extracted.new_actions || []).map((a: any) => ({
          ...a,
          assignees: Array.isArray(a.assignees) ? a.assignees
            : a.assignee ? [a.assignee] : [],
          project_id: a.project_id ?? null,
        })),
      }
      setEdited(normalised)
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
      const res = await fetch(`/api/meetings/${meetingId}/confirm`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extracted: edited, meeting_ref: result.meeting_ref }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Confirm failed')
      onConfirmed()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setConfirming(false)
    }
  }

  const updateAction = (i: number, field: keyof ExtractedAction, val: string | string[] | null) => {
    if (!edited) return
    const actions = [...edited.new_actions]
    actions[i] = { ...actions[i], [field]: val }
    setEdited({ ...edited, new_actions: actions })
  }

  const toggleAssignee = (actionIdx: number, member: string) => {
    if (!edited) return
    const a = edited.new_actions[actionIdx]
    if (member === 'All Members') {
      updateAction(actionIdx, 'assignees', ['All Members'])
      return
    }
    const current = a.assignees.filter(x => x !== 'All Members')
    const next = current.includes(member)
      ? current.filter(x => x !== member)
      : [...current, member]
    updateAction(actionIdx, 'assignees', next.length ? next : ['Unknown'])
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
        description: '', assignees: [], deadline: null, priority: 'medium',
        project_id: null, matches_existing: null,
      }],
    })
  }

  const INDIVIDUAL_MEMBERS = ['Hillary', 'Hellen', 'Alex', 'Solomon', 'Viola', 'Max', 'James']
  const PRIORITIES = ['high', 'medium', 'low']
  const PRIORITY_COLOR: Record<string, string> = { high: '#f87171', medium: '#fbbf24', low: '#64748b' }
  const PROJECTS = [
    { id: 'chicken',     name: 'Free Range Chicken' },
    { id: 'washing_bay', name: 'Washing Bay' },
    { id: 'sheep',       name: 'Sheep (Dorper)' },
    { id: 'goats',       name: 'Goats' },
    { id: 'dairy',       name: 'Dairy (Cows)' },
    { id: 'mango',       name: 'Mango & Oranges' },
    { id: 'trees',       name: 'Tree Planting' },
    { id: 'bees',        name: 'Apiary (Bees)' },
    { id: 'rabbits',     name: 'Rabbits' },
    { id: 'irrigation',  name: 'Irrigation & Bananas' },
    { id: 'fortune_credit', name: 'Fortune Credit' },
    { id: 'kakoba',      name: 'Kakoba Land' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>

      <div className="w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col"
        style={{ background: '#121824', border: '1px solid #1e293b', maxHeight: '90vh' }}>

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid #1e293b' }}>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>Process Meeting</h2>
            <p className="text-[11px] mt-0.5" style={{ color: '#475569' }}>{meetingRef}</p>
          </div>
          <button onClick={onClose} className="text-lg leading-none" style={{ color: '#475569' }}>✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">

          {!result ? (
            <>
              {/* Input mode selector */}
              <div className="flex gap-2">
                {([
                  { key: 'audio', label: 'Audio file' },
                  { key: 'paste', label: 'Paste text' },
                  { key: 'file',  label: 'Upload .txt / .docx' },
                ] as { key: InputMode; label: string }[]).map(m => (
                  <button key={m.key} onClick={() => setMode(m.key)}
                    className="text-xs px-3 py-1.5 rounded-full transition-all"
                    style={{
                      background: mode === m.key ? '#1e3a5f' : '#1e293b',
                      color: mode === m.key ? '#93c5fd' : '#64748b',
                      border: mode === m.key ? '1px solid #3b82f655' : '1px solid #334155',
                    }}>
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Audio upload */}
              {mode === 'audio' && (
                <div>
                  <p className="text-[11px] mb-2" style={{ color: '#64748b' }}>
                    Supported: .mp3 .m4a .wav .ogg .webm (max 25MB)
                  </p>
                  <input ref={audioRef} type="file"
                    accept=".mp3,.m4a,.wav,.ogg,.webm,audio/*"
                    onChange={e => setAudioFile(e.target.files?.[0] ?? null)}
                    className="hidden" />
                  <button onClick={() => audioRef.current?.click()}
                    className="w-full py-6 rounded-xl text-sm border-dashed border-2 transition-colors"
                    style={{ borderColor: audioFile ? '#3b82f6' : '#334155', color: audioFile ? '#93c5fd' : '#475569' }}>
                    {audioFile ? `Selected: ${audioFile.name}` : 'Tap to select audio file'}
                  </button>
                </div>
              )}

              {/* Paste text */}
              {mode === 'paste' && (
                <textarea
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  placeholder="Paste meeting transcript or notes here…"
                  rows={10}
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none"
                  style={{ background: '#0d1829', color: '#e2e8f0', border: '1px solid #334155' }}
                />
              )}

              {/* File upload */}
              {mode === 'file' && (
                <div>
                  <p className="text-[11px] mb-2" style={{ color: '#64748b' }}>
                    .txt (plain text) or .docx (Word document)
                  </p>
                  <input ref={fileRef} type="file"
                    accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
                    className="hidden" />
                  <button onClick={() => fileRef.current?.click()}
                    className="w-full py-6 rounded-xl text-sm border-dashed border-2 transition-colors"
                    style={{ borderColor: uploadFile ? '#3b82f6' : '#334155', color: uploadFile ? '#93c5fd' : '#475569' }}>
                    {uploadFile ? `Selected: ${uploadFile.name}` : 'Tap to select .txt or .docx'}
                  </button>
                </div>
              )}

              {error && <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>}

              <button onClick={submit} disabled={processing}
                className="w-full py-3 rounded-xl text-sm font-semibold disabled:opacity-40 transition-opacity"
                style={{ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #3b82f655' }}>
                {processing ? 'Transcribing + extracting…' : 'Extract actions and decisions →'}
              </button>
            </>
          ) : (
            /* Review screen */
            <>
              {/* Transcript preview */}
              <div className="rounded-lg px-3 py-2" style={{ background: '#0d1829', border: '1px solid #1e293b' }}>
                <p className="text-[10px] mb-1" style={{ color: '#475569' }}>Transcript preview</p>
                <p className="text-[11px]" style={{ color: '#64748b' }}>{result.transcript_preview}</p>
              </div>

              {/* Summary + decisions */}
              {ext && (
                <>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#475569' }}>Summary</p>
                    <p className="text-sm" style={{ color: '#94a3b8' }}>{ext.summary}</p>
                  </div>

                  {ext.key_decisions.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#475569' }}>Decisions ({ext.key_decisions.length})</p>
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

                          {/* Description */}
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

                          {/* Assignee pills + All Members toggle */}
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
                                      color: active ? '#93c5fd' : '#475569',
                                      border: active ? '1px solid #3b82f655' : '1px solid #334155',
                                    }}>
                                    {m}
                                  </button>
                                )
                              })}
                              <button onClick={() => toggleAssignee(i, 'All Members')}
                                className="text-[10px] px-2 py-0.5 rounded-full transition-all"
                                style={{
                                  background: a.assignees.includes('All Members') ? '#14532d' : '#1e293b',
                                  color: a.assignees.includes('All Members') ? '#4ade80' : '#475569',
                                  border: a.assignees.includes('All Members') ? '1px solid #16683455' : '1px solid #334155',
                                }}>
                                All Members
                              </button>
                            </div>
                          </div>

                          {/* Deadline + priority + project */}
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
                              ↑ Carried over from {a.matches_existing}
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
                </>
              )}

              {error && <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>}
            </>
          )}
        </div>

        {/* Footer */}
        {result && (
          <div className="px-5 py-4 flex gap-3" style={{ borderTop: '1px solid #1e293b' }}>
            <button onClick={() => { setResult(null); setEdited(null); setError('') }}
              className="text-xs px-4 py-2 rounded-xl"
              style={{ background: '#1e293b', color: '#64748b', border: '1px solid #334155' }}>
              ← Re-upload
            </button>
            <button onClick={confirm} disabled={confirming}
              className="flex-1 py-2 rounded-xl text-sm font-semibold disabled:opacity-40"
              style={{ background: '#14532d', color: '#4ade80', border: '1px solid #16683455' }}>
              {confirming ? 'Saving…' : 'Confirm and save to DB →'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
