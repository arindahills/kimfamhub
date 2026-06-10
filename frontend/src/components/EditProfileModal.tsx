import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Camera, KeyRound, Eye, EyeOff, Check } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Tab = 'photo' | 'password'

function PhotoTab({ name, onUploaded }: { name: string; onUploaded?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const safe = (name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const currentSrc = `/static/avatars/${safe}.jpg`

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch('/api/auth/upload-avatar', { method: 'POST', credentials: 'include', body: fd })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Upload failed')
      return r.json()
    },
    onSuccess: () => {
      setDone(true)
      onUploaded?.()  // tell AppShell to bump version → Avatar reloads
    },
  })

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setPreview(URL.createObjectURL(f))
    setDone(false)
    upload.mutate(f)
  }

  return (
    <div className="flex flex-col items-center gap-5 py-4">
      {/* Avatar preview */}
      <div className="relative h-24 w-24">
        <div className="h-24 w-24 overflow-hidden rounded-full border-2 border-[var(--success)]" style={{ background: '#1e3a5f' }}>
          {preview
            ? <img src={preview} className="h-full w-full object-cover" alt="preview" />
            : <img src={`${currentSrc}?t=${Date.now()}`} className="h-full w-full object-cover" alt="current"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
          }
          {!preview && (
            <div className="absolute inset-0 flex items-center justify-center text-3xl font-bold" style={{ color: '#4ade80' }}>
              {(name || '?').charAt(0).toUpperCase()}
            </div>
          )}
        </div>
      </div>

      {/* Clear upload button */}
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*" className="sr-only" onChange={onPick} />
      <button
        onClick={() => { setDone(false); inputRef.current?.click() }}
        disabled={upload.isPending}
        className="flex w-full items-center justify-center gap-2 rounded-[12px] py-3 text-[14px] font-semibold disabled:opacity-50"
        style={{ background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', color: '#fff', boxShadow: '0 3px 12px rgba(59,130,246,.35)' }}
      >
        <Camera size={18} />
        {upload.isPending ? 'Uploading…' : 'Choose Photo'}
      </button>
      <p className="text-[11px] text-[var(--muted-2)]">Supports JPEG, PNG, HEIC (iPhone photos)</p>

      {upload.isError && (
        <div className="w-full rounded-[10px] border border-[rgba(239,68,68,.4)] bg-[rgba(239,68,68,.1)] p-3 text-[12px] text-[var(--danger)]">
          {(upload.error as Error).message}
        </div>
      )}
      {done && (
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--success)]">
          <Check size={16} /> Photo updated!
        </span>
      )}
    </div>
  )
}

function PasswordTab() {
  const [old, setOld] = useState('')
  const [nw, setNw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showOld, setShowOld] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')

  const mut = useMutation({
    mutationFn: () =>
      fetch('/api/auth/change-password', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_password: old, new_password: nw }),
      }).then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Failed'); return r.json() }),
    onSuccess: () => { setDone(true); setOld(''); setNw(''); setConfirm('') },
    onError: (e: Error) => setErr(e.message),
  })

  const valid = old && nw.length >= 6 && nw === confirm
  const mismatch = confirm && nw !== confirm

  const field = 'h-11 w-full rounded-[10px] border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-2)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]'

  return (
    <div className="space-y-3 py-2">
      <div className="relative">
        <input type={showOld ? 'text' : 'password'} placeholder="Current password" value={old} onChange={e => setOld(e.target.value)} className={field} />
        <button type="button" onClick={() => setShowOld(v => !v)} className="absolute right-3 top-3 text-[var(--muted-2)]">{showOld ? <EyeOff size={16} /> : <Eye size={16} />}</button>
      </div>
      <div className="relative">
        <input type={showNew ? 'text' : 'password'} placeholder="New password (min 6 chars)" value={nw} onChange={e => { setNw(e.target.value); setErr('') }} className={field} />
        <button type="button" onClick={() => setShowNew(v => !v)} className="absolute right-3 top-3 text-[var(--muted-2)]">{showNew ? <EyeOff size={16} /> : <Eye size={16} />}</button>
      </div>
      <input type="password" placeholder="Confirm new password" value={confirm} onChange={e => setConfirm(e.target.value)}
        className={cn(field, mismatch && 'border-[var(--danger)]')} />
      {mismatch && <p className="text-[11px] text-[var(--danger)]">Passwords don't match.</p>}
      {err && <p className="text-[11px] text-[var(--danger)]">{err}</p>}
      {done && <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--success)]"><Check size={16} /> Password changed!</p>}
      <Button variant="success" className="w-full" disabled={!valid || mut.isPending} onClick={() => { setErr(''); mut.mutate() }}>
        {mut.isPending ? 'Saving…' : 'Update Password'}
      </Button>
    </div>
  )
}

export function EditProfileModal({ open, onClose, userName, onAvatarUploaded }: { open: boolean; onClose: () => void; userName?: string; onAvatarUploaded?: () => void }) {
  const [tab, setTab] = useState<Tab>('photo')

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent title="Edit Profile" subtitle={userName || ''} className="min-h-[72vh]">
        <div className="grid grid-cols-2 gap-1 rounded-[12px] bg-[var(--card-inset)] p-1 mb-4">
          {([['photo', Camera, 'Photo'] as const, ['password', KeyRound, 'Password'] as const]).map(([key, Icon, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn('flex items-center justify-center gap-2 rounded-[9px] py-2.5 text-[13px] font-semibold transition-all', tab === key ? 'text-white' : 'text-[var(--muted)]')}
              style={tab === key ? { background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', boxShadow: '0 2px 8px rgba(59,130,246,.30)' } : undefined}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
        {tab === 'photo' ? <PhotoTab name={userName || ''} onUploaded={onAvatarUploaded} /> : <PasswordTab />}
      </DialogContent>
    </Dialog>
  )
}
