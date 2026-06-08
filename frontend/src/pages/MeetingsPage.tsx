import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

interface Meeting {
  id: number
  meeting_number: string
  meeting_date: string
  location: string | null
  agenda: string | null
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

  return (
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
          <a href={m.minutes_url} target="_blank" rel="noreferrer"
            className="text-[11px] px-2 py-1 rounded-lg"
            style={{ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #1e40af' }}>
            Minutes ↗
          </a>
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
        <Collapsible title="Agenda" body={m.agenda} />
        <Collapsible title="Key Decisions" body={m.key_decisions} />
        <Collapsible title="Key Topics" body={m.key_topics} />
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
