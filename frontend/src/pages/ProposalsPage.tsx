import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from '../components/Toast'
import { BusyButton, Spinner } from '../components/Spinner'
import { streamAi } from '../lib/aiStream'

interface Criterion { name: string; weight: number; score: number; rationale: string }
interface Readiness { status?: string; assessment?: string; blocking?: string[] }
interface Proposal {
  id: number; title: string; owner: string; submitted_by: string
  file_url: string | null; overall_score: number | null; verdict: string | null
  scored: boolean; criteria: Criterion[]; strengths: string[]; gaps: string[]
  improvements: string[]; summary: string | null; created_at: string
  support_requested: string; readiness: Readiness; version: number; is_current: boolean
  uploaded_at: string
}

const OWNERS = [
  'KimFam (club-wide)',
  'the Arindas', 'the Arungas', 'the Tuhimbises', 'the Kofunas', 'the Turamyes',
  'Dad', 'Mum', 'Hillary', 'Hellen', 'Alex', 'Israel', 'Simon', 'Esther',
  'Janet', 'Lawi', 'Max', 'Priscilla', 'Solomon', 'Viola',
]

function fmtDate(s: string): string {
  if (!s) return ''
  const t = Date.parse(s.replace(' ', 'T'))
  if (!t) return ''
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function verdictColor(v: string | null): { bg: string; fg: string } {
  switch (v) {
    case 'Strong': return { bg: '#0f3d22', fg: '#86efac' }
    case 'Viable with conditions': return { bg: '#1e3a5f', fg: '#93c5fd' }
    case 'Needs work': return { bg: '#3d2f0f', fg: '#fcd34d' }
    default: return { bg: '#3f1d1d', fg: '#fca5a5' }
  }
}

export default function ProposalsPage() {
  const toast = useToast()
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [owner, setOwner] = useState('')
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState<number | null>(null)
  const [scoringId, setScoringId] = useState<number | null>(null)

  const { data, isLoading } = useQuery<{ proposals: Proposal[] }>({
    queryKey: ['proposals'],
    queryFn: () => fetch('/api/proposals', { credentials: 'include' }).then(r => r.json()),
  })

  const submit = async () => {
    if (!file) { toast.error('Choose a proposal file first'); return }
    if (!owner) { toast.error('Choose whose proposal this is'); return }
    setBusy(true)
    const tid = toast.loading('Uploading the proposal…')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('title', title || file.name.replace(/\.[^.]+$/, ''))
      fd.append('owner', owner)
      const ev = await streamAi('/api/proposals', { method: 'POST', body: fd },
        msg => toast.update(tid, msg, 'loading'))
      const d = ev.proposal
      toast.update(tid, `Scored: ${d.overall_score ?? '?'} / 100 (${d.verdict})`, 'success')
      setFile(null); setTitle(''); setOwner('')
      setOpenId(d.id)
      qc.invalidateQueries({ queryKey: ['proposals'] })
    } catch (e: any) {
      toast.update(tid, e.message, 'error')
    } finally { setBusy(false) }
  }

  const score = async (id: number) => {
    setScoringId(id)
    const tid = toast.loading('Scoring with Claude…')
    try {
      const ev = await streamAi(`/api/proposals/${id}/score`, { method: 'POST' },
        msg => toast.update(tid, msg, 'loading'))
      const d = ev.proposal
      toast.update(tid, `Scored: ${d.overall_score} / 100 (${d.verdict})`, 'success')
      setOpenId(id)
      qc.invalidateQueries({ queryKey: ['proposals'] })
    } catch (e: any) {
      toast.update(tid, e.message, 'error')
    } finally { setScoringId(null) }
  }

  const proposals = data?.proposals || []

  return (
    <div className="max-w-2xl md:max-w-4xl mx-auto space-y-3 pb-10">
      {/* Submit */}
      <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Submit a proposal</div>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Upload a project proposal (Word, PDF, or PowerPoint). It is scored by Claude against the
          KimFam project-management framework and reward guidelines.
        </p>
        <label className="block w-full text-center text-sm px-3 py-3 rounded-lg cursor-pointer"
          style={{ background: '#0d1829', border: '1px dashed #334155', color: file ? '#cbd5e1' : '#64748b' }}>
          {file ? file.name : 'Tap to choose a proposal file'}
          <input type="file" accept=".docx,.pdf,.pptx,.doc,.ppt" hidden
            onChange={e => { const f = e.target.files?.[0] || null; setFile(f); if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, '')) }} />
        </label>
        <input type="text" placeholder="Proposal title" value={title} onChange={e => setTitle(e.target.value)}
          className="w-full text-sm px-3 py-2 rounded-lg"
          style={{ background: '#0d1829', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
        <select value={owner} onChange={e => setOwner(e.target.value)}
          className="w-full text-sm px-3 py-2 rounded-lg"
          style={{ background: '#0d1829', border: '1px solid var(--border)', color: owner ? 'var(--text-primary)' : '#64748b' }}>
          <option value="">Whose proposal is this? (owner)</option>
          {OWNERS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <BusyButton busy={busy} busyLabel="Scoring…" onClick={submit}
          className="w-full text-sm py-2.5 rounded-lg font-semibold"
          style={{ background: '#7c3aed', color: '#fff', border: 'none' }}>
          Submit & score →
        </BusyButton>
      </div>

      {/* List */}
      {isLoading ? (
        <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : proposals.length === 0 ? (
        <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>No proposals yet.</p>
      ) : proposals.map(p => {
        const vc = verdictColor(p.verdict)
        const isOpen = openId === p.id
        return (
          <div key={p.id} className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <button onClick={() => setOpenId(isOpen ? null : p.id)} className="w-full flex items-center justify-between px-4 py-3 gap-3">
              <div className="flex-1 min-w-0 text-left">
                <div className="text-sm font-semibold truncate flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                  <span className="truncate">{p.title}</span>
                  {p.version > 1 && <span className="text-[9px] px-1 py-0.5 rounded shrink-0" style={{ background: '#1e293b', color: '#94a3b8' }}>v{p.version}</span>}
                </div>
                <div className="text-[11px]" style={{ color: '#7c93b3' }}>
                  {p.owner} · submitted by {p.submitted_by}{p.uploaded_at ? ` · ${fmtDate(p.uploaded_at)}` : ''}
                </div>
              </div>
              {p.scored ? (
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-bold" style={{ color: vc.fg }}>{p.overall_score}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: vc.bg, color: vc.fg }}>{p.verdict}</span>
                </div>
              ) : (
                <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0" style={{ background: '#1e293b', color: '#64748b' }}>Not scored</span>
              )}
            </button>

            {isOpen && (
              <div className="px-4 pb-4 space-y-3" style={{ borderTop: '1px solid var(--border)' }}>
                <div className="flex gap-2 pt-3">
                  {p.file_url && (
                    <>
                      <a href={`${p.file_url}/view`} target="_blank" rel="noreferrer" className="text-[11px] px-2 py-1 rounded" style={{ background: '#1e3a5f', color: '#93c5fd' }}>View doc</a>
                      <a href={p.file_url} download className="text-[11px] px-2 py-1 rounded" style={{ background: '#1e293b', color: '#64748b' }}>↓ Download</a>
                    </>
                  )}
                  {!p.scored && (
                    <button onClick={() => score(p.id)} disabled={scoringId === p.id}
                      className="text-[11px] px-2 py-1 rounded inline-flex items-center gap-1" style={{ background: '#7c3aed', color: '#fff' }}>
                      {scoringId === p.id && <Spinner size={11} color="#fff" />} Score with AI
                    </button>
                  )}
                </div>

                {p.scored && (
                  <>
                    {p.summary && <p className="text-xs" style={{ color: '#cbd5e1' }}>{p.summary}</p>}

                    {/* Support requested + readiness to grant it */}
                    {(p.support_requested || p.readiness?.assessment) && (
                      <div className="rounded-lg p-2.5" style={{ background: '#0d1829', border: '1px solid var(--border)' }}>
                        {p.support_requested && (
                          <div className="text-[11px] mb-1" style={{ color: '#cbd5e1' }}>
                            <span style={{ color: '#7c93b3' }}>Support requested: </span>{p.support_requested}
                          </div>
                        )}
                        {p.readiness?.status && (
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] uppercase tracking-wide" style={{ color: '#7c93b3' }}>Ready for support?</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full" style={{
                              background: p.readiness.status === 'ready' ? '#0f3d22' : p.readiness.status === 'partly' ? '#3d2f0f' : '#3f1d1d',
                              color: p.readiness.status === 'ready' ? '#86efac' : p.readiness.status === 'partly' ? '#fcd34d' : '#fca5a5',
                            }}>{p.readiness.status.replace('_', ' ')}</span>
                          </div>
                        )}
                        {p.readiness?.assessment && <div className="text-[11px]" style={{ color: '#94a3b8' }}>{p.readiness.assessment}</div>}
                        {(p.readiness?.blocking?.length ?? 0) > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {p.readiness!.blocking!.map((b, i) => <li key={i} className="text-[11px] flex gap-1.5" style={{ color: '#fca5a5' }}><span>⛔</span><span>{b}</span></li>)}
                          </ul>
                        )}
                      </div>
                    )}
                    <div className="space-y-1.5">
                      {p.criteria.map(c => (
                        <div key={c.name}>
                          <div className="flex justify-between text-[11px]" style={{ color: '#94a3b8' }}>
                            <span>{c.name} <span style={{ color: '#475569' }}>({c.weight})</span></span>
                            <span style={{ color: '#cbd5e1' }}>{c.score}/5</span>
                          </div>
                          <div style={{ height: 5, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${(c.score / 5) * 100}%`, height: '100%', background: c.score >= 4 ? '#16a34a' : c.score >= 3 ? '#3b82f6' : c.score >= 2 ? '#d97706' : '#dc2626' }} />
                          </div>
                          {c.rationale && <div className="text-[10px] mt-0.5" style={{ color: '#64748b' }}>{c.rationale}</div>}
                        </div>
                      ))}
                    </div>
                    {p.strengths?.length > 0 && <ScoreList title="Strengths" items={p.strengths} color="#86efac" />}
                    {p.gaps?.length > 0 && <ScoreList title="Gaps" items={p.gaps} color="#fcd34d" />}
                    {p.improvements?.length > 0 && <ScoreList title="Suggested improvements" items={p.improvements} color="#93c5fd" />}
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ScoreList({ title, items, color }: { title: string; items: string[]; color: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color }}>{title}</div>
      <ul className="space-y-0.5">
        {items.map((s, i) => <li key={i} className="text-[11px] flex gap-1.5" style={{ color: '#cbd5e1' }}><span style={{ color }}>•</span><span>{s}</span></li>)}
      </ul>
    </div>
  )
}
