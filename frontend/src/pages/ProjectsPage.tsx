import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

interface ProjectData {
  label: string
  value: string
}

interface ProjectUpdate {
  date: string
  author: string
  text: string
  images: string[]
  videos: string[]
}

interface Project {
  id: string
  name: string
  icon: string
  category: string
  status: string
  lead: string
  headline: string
  live?: boolean
  data: ProjectData[]
  update?: ProjectUpdate
}

const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  Operational: { color: '#4ade80', bg: '#14532d33' },
  Active:      { color: '#60a5fa', bg: '#1e3a5f33' },
  Planning:    { color: '#fbbf24', bg: '#78350f33' },
  Research:    { color: '#a78bfa', bg: '#4c1d9533' },
  'Under Review': { color: '#f87171', bg: '#7f1d1d33' },
  'Due Diligence': { color: '#fb923c', bg: '#7c2d1233' },
  'Early Planning': { color: '#fbbf24', bg: '#78350f33' },
}

function ProjectCard({ p }: { p: Project }) {
  const [open, setOpen] = useState(false)
  const s = STATUS_STYLE[p.status] || { color: '#94a3b8', bg: '#1e293b' }

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-card)' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full text-left p-4">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{p.icon}</span>
            <div>
              <div className="font-semibold text-sm" style={{ color: '#f1f5f9' }}>{p.name}</div>
              <div className="text-[11px]" style={{ color: '#64748b' }}>{p.headline}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
              style={{ color: s.color, background: s.bg }}>
              {p.status}
            </span>
            <span style={{ color: '#475569', transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s', fontSize: 12 }}>▶</span>
          </div>
        </div>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <div className="px-4 py-3">
            <div className="text-[10px] mb-2" style={{ color: '#475569' }}>Lead: {p.lead} · {p.category}</div>

            {/* Latest update photos */}
            {p.update?.images && p.update.images.length > 0 && (
              <div className="flex gap-2 overflow-x-auto mb-3 pb-1">
                {p.update.images.map((src, i) => (
                  <img key={i} src={src} className="h-36 rounded-lg object-cover shrink-0 cursor-pointer"
                    onClick={() => window.open(src, '_blank')} alt="" />
                ))}
              </div>
            )}
            {p.update?.videos && p.update.videos.length > 0 && (
              <div className="flex gap-2 overflow-x-auto mb-3 pb-1">
                {p.update.videos.map((src, i) => (
                  <video key={i} src={src} controls className="h-36 rounded-lg shrink-0" />
                ))}
              </div>
            )}

            {/* Latest update text */}
            {p.update && (
              <div className="rounded-lg p-3 mb-3" style={{ background: '#0f172a', border: '1px solid var(--border)' }}>
                <div className="text-[10px] mb-1" style={{ color: '#475569' }}>
                  Latest — {p.update.date} · {p.update.author}
                </div>
                <p className="text-xs leading-relaxed" style={{ color: '#cbd5e1' }}>{p.update.text}</p>
              </div>
            )}

            {/* Data points */}
            <div className="space-y-1.5">
              {p.data.map(d => (
                <div key={d.label} className="flex gap-2 text-xs">
                  <span className="shrink-0" style={{ color: '#475569', minWidth: 140 }}>{d.label}</span>
                  <span style={{ color: '#cbd5e1' }}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const CATEGORIES = ['All', 'Farming & Agriculture', 'Business Ventures', 'Unit Trusts', 'Real Estate']

export default function ProjectsPage() {
  const [cat, setCat] = useState('All')

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['projects-all'],
    queryFn: () => fetch('/api/projects/all', { credentials: 'include' }).then(r => r.json()),
    staleTime: 120_000,
  })

  const visible = cat === 'All' ? projects : projects.filter(p => p.category === cat)

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      <div className="flex gap-1.5 flex-wrap">
        {CATEGORIES.map(c => (
          <button key={c} onClick={() => setCat(c)}
            className="px-3 py-1.5 rounded-full text-xs font-medium"
            style={{
              background: cat === c ? '#1e40af' : '#1e293b',
              color: cat === c ? '#fff' : '#64748b',
              border: cat === c ? '1px solid #3b82f6' : '1px solid #334155',
            }}>
            {c === 'All' ? `All (${projects.length})` : c}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>Loading...</p>}

      {visible.map(p => <ProjectCard key={p.id} p={p} />)}
    </div>
  )
}
