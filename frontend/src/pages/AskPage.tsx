// AskPage — uses /api/ask/stream (SSE) for live thinking stages + marked for markdown rendering
import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { marked } from 'marked'

// Configure marked: tables, line breaks, safe HTML
marked.setOptions({ breaks: true, gfm: true } as any)

interface Turn {
  role: 'user' | 'assistant'
  content: string
}

interface RawTurn { role?: string; content?: string; question?: string; answer?: string }

function normaliseHistory(rows: RawTurn[]): Turn[] {
  const out: Turn[] = []
  for (const r of rows || []) {
    if (r.role && typeof r.content === 'string') {
      out.push({ role: r.role === 'user' ? 'user' : 'assistant', content: r.content })
    } else {
      if (r.question) out.push({ role: 'user', content: r.question })
      if (r.answer) out.push({ role: 'assistant', content: r.answer })
    }
  }
  return out.filter(t => t.content?.trim())
}

// Render markdown as HTML — used for assistant messages
function MarkdownBubble({ content }: { content: string }) {
  const html = marked.parse(content) as string
  return (
    <div
      className="ask-md"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

// Animated thinking stages display
function ThinkingBubble({ stages }: { stages: string[] }) {
  const latest = stages[stages.length - 1] ?? 'Thinking...'
  return (
    <div style={{
      background: 'var(--bg-card)',
      borderRadius: '18px 18px 18px 4px',
      padding: '12px 16px',
      maxWidth: '85%',
    }}>
      {/* Scrollable log of past stages */}
      {stages.length > 1 && (
        <div style={{ marginBottom: 6 }}>
          {stages.slice(0, -1).map((s, i) => (
            <div key={i} style={{ fontSize: 10, color: '#334155', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
              <span style={{ color: '#22c55e', fontSize: 10 }}>✓</span>
              <span>{s}</span>
            </div>
          ))}
        </div>
      )}
      {/* Current active stage */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ display: 'flex', gap: 3 }}>
          {[0, 1, 2].map(i => (
            <span key={i} style={{
              width: 6, height: 6, borderRadius: '50%',
              background: '#4f6ef7',
              animation: `askDot 1.2s ease-in-out ${i * 0.2}s infinite`,
            }} />
          ))}
        </span>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{latest}</span>
      </div>
    </div>
  )
}

const SUGGESTIONS = [
  'What is the current bank balance?',
  'Who has outstanding payments?',
  'What were the key decisions from the last meeting?',
  'What is the status of the chicken project?',
]

export default function AskPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [input, setInput] = useState('')
  const [localTurns, setLocalTurns] = useState<Turn[]>([])
  const [stages, setStages] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const { data: history } = useQuery<{ turns: RawTurn[] }>({
    queryKey: ['ask-history'],
    queryFn: () => fetch('/api/ask/history', { credentials: 'include' }).then(r => r.json()),
    staleTime: 60_000,
  })

  const historyTurns = normaliseHistory(history?.turns || [])
  const allTurns = [...historyTurns, ...localTurns]

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [allTurns.length, stages.length, busy])

  const send = async () => {
    const q = input.trim()
    if (!q || busy) return
    setInput('')
    setBusy(true)
    setErr('')
    setStages([])
    setLocalTurns(t => [...t, { role: 'user', content: q }])

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await fetch('/api/ask/stream', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, session_id: user?.name || 'guest' }),
        signal: ctrl.signal,
      })

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No stream')
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'step') {
              setStages(s => [...s, ev.msg])
            } else if (ev.type === 'result') {
              setLocalTurns(t => [...t, { role: 'assistant', content: ev.answer }])
              qc.invalidateQueries({ queryKey: ['ask-history'] })
            } else if (ev.type === 'error') {
              setErr(ev.msg || 'The assistant encountered an error.')
            }
          } catch { /* malformed SSE line — skip */ }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setErr('Network error. Try again.')
        setLocalTurns(t => t.slice(0, -1))
      }
    } finally {
      setBusy(false)
      setStages([])
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <>
      {/* Keyframes injected once */}
      <style>{`
        @keyframes askDot {
          0%,80%,100% { transform: scale(0.6); opacity:0.4; }
          40%          { transform: scale(1);   opacity:1;   }
        }
        .ask-md { font-size: 13px; line-height: 1.65; color: #e2e8f0; }
        .ask-md p  { margin: 0 0 0.5em; }
        .ask-md p:last-child { margin-bottom: 0; }
        .ask-md strong { color: #f1f5f9; font-weight: 700; }
        .ask-md em { color: #cbd5e1; font-style: italic; }
        .ask-md ul, .ask-md ol { padding-left: 1.3em; margin: 0.4em 0; }
        .ask-md li { margin-bottom: 0.2em; }
        .ask-md table {
          border-collapse: collapse; width: 100%;
          margin: 0.6em 0; font-size: 11px;
        }
        .ask-md th {
          background: #1e3a5f; color: #93c5fd;
          padding: 5px 8px; text-align: left;
          border: 1px solid #334155;
        }
        .ask-md td {
          padding: 5px 8px; border: 1px solid #1e293b;
          color: #cbd5e1;
        }
        .ask-md tr:nth-child(even) td { background: #0f172a33; }
        .ask-md h1,.ask-md h2,.ask-md h3 {
          color: #f1f5f9; font-weight: 700;
          margin: 0.6em 0 0.3em;
        }
        .ask-md h3 { font-size: 13px; }
        .ask-md code {
          background: #1e293b; color: #a5b4fc;
          padding: 1px 5px; border-radius: 4px;
          font-size: 11px;
        }
        .ask-md blockquote {
          border-left: 3px solid #334155;
          padding-left: 10px; color: #64748b;
          margin: 0.4em 0;
        }
        .ask-md hr { border: none; border-top: 1px solid #1e293b; margin: 0.6em 0; }
      `}</style>

      <div className="max-w-2xl md:max-w-5xl mx-auto flex flex-col h-full" style={{ minHeight: '70vh' }}>
        {/* Header */}
        <div className="rounded-xl p-4 mb-4" style={{ background: 'var(--bg-card)' }}>
          <div className="flex items-center gap-2.5 mb-1">
            <span className="flex h-9 w-9 items-center justify-center rounded-full"
              style={{ background: 'linear-gradient(135deg,#6366f1,#a78bfa)', boxShadow: '0 4px 14px rgba(99,102,241,.45)' }}>
              <Bot size={20} color="#fff" />
            </span>
            <span className="font-semibold text-[15px]" style={{ color: '#f1f5f9' }}>Ask KimFam</span>
          </div>
          <p className="text-xs" style={{ color: '#64748b' }}>
            Ask anything about KimFam Investment Club — finances, meeting decisions, project updates, governance, constitution.
          </p>
        </div>

        {/* Messages */}
        <div className="flex-1 space-y-3 mb-4" style={{ overflowY: 'auto' }}>
          {allTurns.length === 0 && !busy && (
            <div className="space-y-2">
              {SUGGESTIONS.map(q => (
                <button key={q} onClick={() => setInput(q)}
                  className="w-full text-left rounded-xl px-4 py-3 text-sm"
                  style={{ background: 'var(--bg-card)', color: '#94a3b8', border: '1px solid var(--border)' }}>
                  {q}
                </button>
              ))}
            </div>
          )}

          {allTurns.map((t, i) => (
            <div key={i} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {t.role === 'user' ? (
                <div style={{
                  maxWidth: '85%', background: '#1e40af', color: '#fff',
                  borderRadius: '18px 18px 4px 18px', padding: '10px 14px', fontSize: 13, lineHeight: 1.5,
                }}>
                  {t.content}
                </div>
              ) : (
                <div style={{
                  maxWidth: '92%', background: 'var(--bg-card)',
                  borderRadius: '18px 18px 18px 4px', padding: '12px 16px',
                }}>
                  <MarkdownBubble content={t.content} />
                </div>
              )}
            </div>
          ))}

          {/* Live thinking stages */}
          {busy && (
            <div className="flex justify-start">
              <ThinkingBubble stages={stages.length ? stages : ['Connecting...']} />
            </div>
          )}

          {err && <p className="text-xs text-center" style={{ color: '#f87171' }}>{err}</p>}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="flex gap-2 sticky bottom-20 md:bottom-4">
          <textarea
            value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey}
            placeholder="Ask anything about KimFam..."
            rows={1}
            className="flex-1 rounded-xl px-4 py-3 text-sm outline-none resize-none"
            style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', maxHeight: '120px' }}
          />
          <button onClick={send} disabled={!input.trim() || busy}
            className="rounded-xl px-4 py-3 font-semibold text-sm disabled:opacity-40"
            style={{ background: '#1e40af', color: '#fff' }}>
            ↑
          </button>
        </div>
      </div>
    </>
  )
}
