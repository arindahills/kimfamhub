import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

// Inline minutes viewer — uses /docs/minutes/{file}/view which renders DOCX → HTML
function MinutesModal({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  // Build view URL: replace /docs/.../file with /docs/.../file/view
  const viewUrl = url.endsWith('/view') ? url : `${url}/view`
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#0d1829', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>{title}</div>
          <div style={{ fontSize: 11, color: '#475569' }}>Meeting Minutes</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href={url} download style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, background: '#1e3a5f', color: '#93c5fd', textDecoration: 'none' }}>
            ↓ Download
          </a>
          <button onClick={onClose} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: '#94a3b8', fontSize: 16 }}>✕</button>
        </div>
      </div>
      {/* iframe — the view endpoint renders DOCX as styled HTML */}
      <iframe
        src={viewUrl}
        style={{ flex: 1, border: 'none', background: '#fff' }}
        title={title}
      />
    </div>
  )
}

interface Meeting {
  id: number
  meeting_number: string
  meeting_date: string
  location: string | null
  agenda: string | null
  next_actions: string | null
  key_decisions: string | null
  key_topics: string | null
  attendance: string[] | null
  minutes_url: string | null
  action_count: number
  action_done_count: number
}

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
      {open && (
        <p className="text-xs leading-relaxed pl-4" style={{ color: '#cbd5e1' }}>
          {body}
        </p>
      )}
    </div>
  )
}

function MeetingCard({ m }: { m: Meeting }) {
  const progress = m.action_count > 0 ? Math.round((m.action_done_count / m.action_count) * 100) : 0
  const [viewMinutes, setViewMinutes] = useState(false)

  return (
    <>
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)' }}>
      <div className="flex justify-between items-start mb-2">
        <div>
          <div className="font-semibold text-sm" style={{ color: '#f1f5f9' }}>
            KIM {m.meeting_number}
          </div>
          <div className="text-xs" style={{ color: '#64748b' }}>
            {m.meeting_date}{m.location ? ` · ${m.location}` : ''}
          </div>
        </div>
        {m.minutes_url && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setViewMinutes(true)}
              className="text-[11px] px-2 py-1 rounded-lg"
              style={{ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #1e40af', cursor: 'pointer' }}>
              📄 Read
            </button>
            <a href={m.minutes_url} download
              className="text-[11px] px-2 py-1 rounded-lg"
              style={{ background: '#1e293b', color: '#64748b', border: '1px solid #334155', textDecoration: 'none' }}>
              ↓
            </a>
          </div>
        )}
      </div>

      {m.action_count > 0 && (
        <div className="mb-3">
          <div className="flex justify-between text-[10px] mb-1" style={{ color: '#64748b' }}>
            <span>Action items</span>
            <span>{m.action_done_count}/{m.action_count} done</span>
          </div>
          <div className="rounded-full h-1.5 overflow-hidden" style={{ background: '#1e293b' }}>
            <div className="h-full rounded-full" style={{ width: `${progress}%`, background: progress === 100 ? '#22c55e' : '#3b82f6' }} />
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Collapsible title="Key Topics" body={m.key_topics} />
        <Collapsible title="Key Decisions" body={m.key_decisions} />
        <Collapsible title="Next Actions" body={m.next_actions} />
        <Collapsible title="Agenda" body={m.agenda} />
      </div>

      {m.attendance && m.attendance.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {m.attendance.map(name => (
            <span key={name} className="text-[10px] px-2 py-0.5 rounded-full"
              style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }}>
              {name}
            </span>
          ))}
        </div>
      )}
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

export default function MeetingsPage() {
  const { t } = useTranslation()

  const { data: meetings = [], isLoading } = useQuery<Meeting[]>({
    queryKey: ['meetings'],
    queryFn: () => fetch('/api/meetings', { credentials: 'include' }).then(r => r.json()),
  })

  const sorted = [...meetings].sort((a, b) =>
    new Date(b.meeting_date).getTime() - new Date(a.meeting_date).getTime()
  )

  return (
    <div className="max-w-2xl md:max-w-5xl mx-auto space-y-3">
      <h2 className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
        {t('meetings.title')} ({meetings.length})
      </h2>

      {isLoading && (
        <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</p>
      )}

      {sorted.map(m => <MeetingCard key={m.id} m={m} />)}
    </div>
  )
}
