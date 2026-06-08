import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'

interface Turn {
  role: 'user' | 'assistant'
  content: string
}

interface HistoryResponse {
  turns: Turn[]
}

export default function AskPage() {
  const { user } = useAuth()
  const [input, setInput] = useState('')
  const [localTurns, setLocalTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const { data: history } = useQuery<HistoryResponse>({
    queryKey: ['ask-history'],
    queryFn: () => fetch('/api/ask/history', { credentials: 'include' }).then(r => r.json()),
    staleTime: 60_000,
  })

  const historyTurns: Turn[] = history?.turns || []
  const allTurns = [...historyTurns, ...localTurns]

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [allTurns.length, busy])

  const send = async () => {
    const q = input.trim()
    if (!q || busy) return
    setInput('')
    setBusy(true)
    setErr('')
    setLocalTurns(t => [...t, { role: 'user', content: q }])
    try {
      const r = await fetch('/api/ask', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, session_id: user?.name || 'guest' }),
      })
      const j = await r.json()
      const answer = j.answer || j.response || j.text || JSON.stringify(j)
      setLocalTurns(t => [...t, { role: 'assistant', content: answer }])
    } catch {
      setErr('Network error. Try again.')
      setLocalTurns(t => t.slice(0, -1))
    } finally {
      setBusy(false)
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col h-full" style={{ minHeight: '70vh' }}>
      {/* Header */}
      <div className="rounded-xl p-4 mb-4" style={{ background: 'var(--bg-card)' }}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">🤖</span>
          <span className="font-semibold" style={{ color: '#f1f5f9' }}>Ask KimFam</span>
        </div>
        <p className="text-xs" style={{ color: '#64748b' }}>
          Ask anything about KimFam Investment Club — finances, meeting decisions, project updates, governance, constitution.
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 mb-4" style={{ overflowY: 'auto' }}>
        {allTurns.length === 0 && !busy && (
          <div className="space-y-2">
            {[
              'What is the current bank balance?',
              'Who has outstanding payments?',
              'What were the key decisions from the last meeting?',
              'What is the status of the chicken project?',
            ].map(q => (
              <button key={q} onClick={() => { setInput(q); }}
                className="w-full text-left rounded-xl px-4 py-3 text-sm"
                style={{ background: 'var(--bg-card)', color: '#94a3b8', border: '1px solid var(--border)' }}>
                {q}
              </button>
            ))}
          </div>
        )}

        {allTurns.map((t, i) => (
          <div key={i} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed`}
              style={{
                background: t.role === 'user' ? '#1e40af' : 'var(--bg-card)',
                color: t.role === 'user' ? '#fff' : '#e2e8f0',
                borderRadius: t.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              }}>
              {t.content}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: 'var(--bg-card)', color: '#64748b', borderRadius: '18px 18px 18px 4px' }}>
              <span className="animate-pulse">Thinking...</span>
            </div>
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
  )
}
