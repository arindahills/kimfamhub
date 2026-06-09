import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'

const ADMIN_USERS = ['Hillary', 'Hellen']

interface Update {
  id: number
  project_id: string
  project_name: string
  author: string
  text: string
  media: string[]
  created_at: string
}

const PROJECT_COLORS: Record<string, string> = {
  chicken: '#f59e0b', washing_bay: '#06b6d4', sheep: '#a78bfa',
  goats: '#34d399', banana: '#f97316', bees: '#fbbf24', trees: '#22c55e',
  dairy: '#60a5fa', irrigation: '#4ade80', mango: '#fb923c',
  fortune_credit: '#f472b6', kakoba: '#94a3b8', rabbits: '#fb7185',
}

const ALL_PROJECTS = [
  { id: 'chicken', name: 'Chicken' }, { id: 'washing_bay', name: 'Washing Bay' },
  { id: 'sheep', name: 'Sheep' }, { id: 'goats', name: 'Goats' },
  { id: 'dairy', name: 'Dairy' }, { id: 'trees', name: 'Trees' },
  { id: 'bees', name: 'Bees' }, { id: 'irrigation', name: 'Irrigation' },
  { id: 'mango', name: 'Mango' }, { id: 'rabbits', name: 'Rabbits' },
  { id: 'fortune_credit', name: 'Fortune Credit' }, { id: 'kakoba', name: 'Kakoba' },
]

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function UpdateCard({ u, isAdmin, onDelete }: { u: Update; isAdmin: boolean; onDelete: (id: number) => void }) {
  const col = PROJECT_COLORS[u.project_id] || '#94a3b8'
  const images = u.media.filter(m => !m.match(/\.(mp4|mov|webm)$/i))
  const videos = u.media.filter(m => m.match(/\.(mp4|mov|webm)$/i))

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)' }}>
      <div className="flex justify-between items-start mb-2">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ color: col, background: col + '22' }}>
          {(u.project_name || '').toUpperCase()}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[11px]" style={{ color: '#475569' }}>{timeAgo(u.created_at)}</span>
          {isAdmin && (
            <button onClick={() => onDelete(u.id)} className="text-[11px] px-2 py-0.5 rounded"
              style={{ color: '#f87171', background: '#7f1d1d33' }}>✕</button>
          )}
        </div>
      </div>
      {images.length > 0 && (
        <div className="flex gap-2 overflow-x-auto mb-2 pb-1">
          {images.map((src, i) => (
            <img key={i} src={src} className="h-40 rounded-lg object-cover shrink-0 cursor-pointer"
              onClick={() => window.open(src, '_blank')} alt="" />
          ))}
        </div>
      )}
      {videos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto mb-2 pb-1">
          {videos.map((src, i) => (
            <video key={i} src={src} controls className="h-40 rounded-lg shrink-0" />
          ))}
        </div>
      )}
      <p className="text-sm leading-relaxed" style={{ color: '#e2e8f0' }}>{u.text}</p>
      <p className="text-[11px] mt-2" style={{ color: '#64748b' }}>— {u.author}</p>
    </div>
  )
}

function PostUpdateModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [project, setProject] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    if (!project) return setErr('Select a project.')
    if (!text.trim()) return setErr('Enter an update.')
    setBusy(true)
    const proj = ALL_PROJECTS.find(p => p.id === project)
    const r = await fetch('/api/updates', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: project, project_name: proj?.name || project, text }),
    })
    if (!r.ok) { setErr('Failed to post.'); setBusy(false); return }
    qc.invalidateQueries({ queryKey: ['updates'] })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-md rounded-2xl p-5 space-y-3" style={{ background: 'var(--bg-card)' }}>
        <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Post Project Update</h2>
        <select value={project} onChange={e => setProject(e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm"
          style={{ background: '#0f172a', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
          <option value="">Select project...</option>
          {ALL_PROJECTS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={5}
          placeholder="What's happening with this project?"
          className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
          style={{ background: '#0f172a', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
        {err && <p className="text-xs" style={{ color: '#f87171' }}>{err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg py-2.5 text-sm"
            style={{ background: '#1e293b', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>Cancel</button>
          <button onClick={submit} disabled={busy} className="flex-1 rounded-lg py-2.5 text-sm font-semibold disabled:opacity-60"
            style={{ flex: 2, background: '#1e40af', color: '#fff' }}>
            {busy ? 'Posting...' : 'Post Update'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function UpdatesPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const isAdmin = ADMIN_USERS.includes(user?.name || '')
  const [filterProject, setFilterProject] = useState('')
  const [showPost, setShowPost] = useState(false)

  const url = filterProject ? `/api/updates?project_id=${filterProject}` : '/api/updates'
  const { data: updates = [], isLoading } = useQuery<Update[]>({
    queryKey: ['updates', filterProject],
    queryFn: () => fetch(url, { credentials: 'include' }).then(r => r.json()),
  })

  const deleteUpdate = async (id: number) => {
    await fetch(`/api/updates/${id}`, { method: 'DELETE', credentials: 'include' })
    qc.invalidateQueries({ queryKey: ['updates'] })
  }

  return (
    <div className="max-w-2xl md:max-w-5xl mx-auto space-y-4">
      <div className="flex gap-2 items-center">
        <select value={filterProject} onChange={e => setFilterProject(e.target.value)}
          className="flex-1 rounded-lg px-3 py-2 text-sm"
          style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
          <option value="">All Projects</option>
          {ALL_PROJECTS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {isAdmin && (
          <button onClick={() => setShowPost(true)}
            className="rounded-lg px-4 py-2 text-sm font-semibold"
            style={{ background: '#1e40af', color: '#fff' }}>+ Post</button>
        )}
      </div>

      {isLoading && <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>Loading...</p>}
      {!isLoading && updates.length === 0 && (
        <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>No updates yet.</p>
      )}
      <div className="space-y-3">
        {updates.map(u => <UpdateCard key={u.id} u={u} isAdmin={isAdmin} onDelete={deleteUpdate} />)}
      </div>
      {showPost && <PostUpdateModal onClose={() => setShowPost(false)} />}
    </div>
  )
}
