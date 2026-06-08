import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'

interface MemberStatus {
  name: string
  has_password: boolean
  last_login: string | null
  login_count: number
}

interface MembersStatusData {
  members: MemberStatus[]
}

const DOC_CATEGORIES = ['minutes', 'governance', 'projects', 'financial', 'receipts']

function SetPasswordModal({ member, onClose }: { member: string; onClose: () => void }) {
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!pw.trim() || pw.length < 6) return setMsg('Min 6 characters.')
    setBusy(true)
    const r = await fetch('/api/auth/admin/set-password', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_name: member, new_password: pw }),
    })
    const j = await r.json()
    if (r.ok) { setMsg('Password set.'); setTimeout(onClose, 800) }
    else setMsg(j.detail || 'Error.')
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-sm rounded-2xl p-5 space-y-3" style={{ background: 'var(--bg-card)' }}>
        <h3 className="font-semibold text-sm" style={{ color: '#f1f5f9' }}>Set password for {member}</h3>
        <input type="password" placeholder="New password" value={pw} onChange={e => setPw(e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: '#0f172a', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
        {msg && <p className="text-xs" style={{ color: msg.includes('set') ? '#4ade80' : '#f87171' }}>{msg}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg py-2 text-sm"
            style={{ background: '#1e293b', color: '#64748b' }}>Cancel</button>
          <button onClick={submit} disabled={busy} className="flex-1 rounded-lg py-2 text-sm font-semibold disabled:opacity-60"
            style={{ background: '#1e40af', color: '#fff' }}>Set</button>
        </div>
      </div>
    </div>
  )
}

export default function AdminPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [setPwFor, setSetPwFor] = useState<string | null>(null)
  const [uploadCat, setUploadCat] = useState('minutes')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')
  const [reindexing, setReindexing] = useState(false)
  const [reindexMsg, setReindexMsg] = useState('')

  if (!['Hillary', 'Hellen'].includes(user?.name || '')) {
    return <p className="text-sm text-center py-10" style={{ color: '#f87171' }}>Admin only.</p>
  }

  const { data: statusData } = useQuery<MembersStatusData>({
    queryKey: ['admin-members-status'],
    queryFn: () => fetch('/api/auth/admin/members-status', { credentials: 'include' }).then(r => r.json()),
  })

  const members = statusData?.members || []

  const uploadDoc = async () => {
    if (!uploadFile) return
    setUploading(true)
    setUploadMsg('')
    const fd = new FormData()
    fd.append('file', uploadFile)
    fd.append('category', uploadCat)
    const r = await fetch('/api/admin/upload-doc', { method: 'POST', credentials: 'include', body: fd })
    const j = await r.json()
    setUploadMsg(r.ok ? 'Uploaded.' : j.detail || 'Error.')
    if (r.ok) { setUploadFile(null); qc.invalidateQueries({ queryKey: ['docs'] }) }
    setUploading(false)
  }

  const reindex = async () => {
    setReindexing(true)
    setReindexMsg('')
    const r = await fetch('/api/admin/reindex', { method: 'POST', credentials: 'include' })
    const j = await r.json()
    setReindexMsg(r.ok ? `Reindexed. ${j.chunks || ''} chunks.` : j.detail || 'Error.')
    setReindexing(false)
  }

  return (
    <div className="max-w-2xl md:max-w-5xl mx-auto space-y-4">
      <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Admin Panel</h2>

      {/* Member passwords */}
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)' }}>
        <h3 className="font-semibold text-sm mb-3" style={{ color: '#f1f5f9' }}>Member Login Status</h3>
        <div className="space-y-2">
          {members.map(m => (
            <div key={m.name} className="flex items-center justify-between py-2"
              style={{ borderBottom: '1px solid var(--border)' }}>
              <div>
                <span className="text-sm" style={{ color: '#e2e8f0' }}>{m.name}</span>
                <div className="text-[10px]" style={{ color: '#475569' }}>
                  {m.has_password ? `Logins: ${m.login_count}` : 'No password set'}
                  {m.last_login ? ` · Last: ${m.last_login.slice(0, 10)}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                  style={{ color: m.has_password ? '#4ade80' : '#fbbf24', background: m.has_password ? '#14532d33' : '#78350f33' }}>
                  {m.has_password ? 'Active' : 'No password'}
                </span>
                <button onClick={() => setSetPwFor(m.name)}
                  className="text-[11px] px-2 py-1 rounded"
                  style={{ background: '#1e3a5f', color: '#93c5fd' }}>
                  Set PW
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Upload doc */}
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)' }}>
        <h3 className="font-semibold text-sm mb-3" style={{ color: '#f1f5f9' }}>Upload Document</h3>
        <select value={uploadCat} onChange={e => setUploadCat(e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm mb-2"
          style={{ background: '#0f172a', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
          {DOC_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="file" accept=".docx,.pdf" onChange={e => setUploadFile(e.target.files?.[0] || null)}
          className="text-xs w-full mb-2" style={{ color: 'var(--text-muted)' }} />
        {uploadMsg && <p className="text-xs mb-2" style={{ color: uploadMsg.includes('Upload') ? '#4ade80' : '#f87171' }}>{uploadMsg}</p>}
        <button onClick={uploadDoc} disabled={!uploadFile || uploading}
          className="w-full rounded-lg py-2.5 text-sm font-semibold disabled:opacity-60"
          style={{ background: '#1e40af', color: '#fff' }}>
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
      </div>

      {/* Reindex Ask KimFam */}
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)' }}>
        <h3 className="font-semibold text-sm mb-1" style={{ color: '#f1f5f9' }}>Ask KimFam — Reindex</h3>
        <p className="text-xs mb-3" style={{ color: '#64748b' }}>
          Run after uploading new documents to make them searchable by Ask KimFam.
        </p>
        {reindexMsg && <p className="text-xs mb-2" style={{ color: '#4ade80' }}>{reindexMsg}</p>}
        <button onClick={reindex} disabled={reindexing}
          className="w-full rounded-lg py-2.5 text-sm font-semibold disabled:opacity-60"
          style={{ background: '#166534', color: '#fff' }}>
          {reindexing ? 'Reindexing...' : 'Reindex ChromaDB'}
        </button>
      </div>

      {setPwFor && <SetPasswordModal member={setPwFor} onClose={() => setSetPwFor(null)} />}
    </div>
  )
}
