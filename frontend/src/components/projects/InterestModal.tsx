import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'

const PP_MODES: { key: string; label: string; desc: string }[] = [
  { key: 'operational', label: 'Operational', desc: 'Day-to-day running and management' },
  { key: 'oversight', label: 'Oversight', desc: 'Governance, monitoring and reporting' },
  { key: 'capital', label: 'Capital', desc: 'Financial investment' },
  { key: 'advisory', label: 'Advisory', desc: 'Strategic advice and expertise' },
  { key: 'commercial', label: 'Commercial', desc: 'Sales, procurement and market links' },
  { key: 'physical', label: 'Physical', desc: 'Labour and on-site work' },
]
const LOCKED_FOR_LEAD = ['operational', 'oversight']

export function InterestModal({
  projectId, projectName, open, onOpenChange,
}: {
  projectId: string; projectName: string; open: boolean; onOpenChange: (o: boolean) => void
}) {
  const qc = useQueryClient()
  const [role, setRole] = useState<'project_lead' | 'team_member' | ''>('')
  const [modes, setModes] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')

  const reset = () => { setRole(''); setModes([]); setNote(''); setErr('') }

  const pickRole = (r: 'project_lead' | 'team_member') => {
    setRole(r)
    setModes(r === 'project_lead' ? [...LOCKED_FOR_LEAD] : [])
  }
  const toggleMode = (m: string) => {
    if (role === 'project_lead' && LOCKED_FOR_LEAD.includes(m)) return
    setModes(cur => (cur.includes(m) ? cur.filter(x => x !== m) : [...cur, m]))
  }

  const submit = useMutation({
    mutationFn: () =>
      fetch('/api/projects/interest', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, preferred_role: role, contribution_modes: modes, note: note || null }),
      }).then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Submission failed')
        return r.json()
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['interests', projectId] })
      reset()
      onOpenChange(false)
    },
    onError: (e: Error) => setErr(e.message),
  })

  const onSubmit = () => {
    setErr('')
    if (!role) return setErr('Please select a role.')
    if (!modes.length) return setErr('Select at least one contribution mode.')
    submit.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (!o) reset() }}>
      <DialogContent title={`Express Interest — ${projectName}`} subtitle="Tell the club how you would like to take part">
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase text-[var(--muted-2)]">Your role</div>
            <div className="grid grid-cols-2 gap-2">
              {([['project_lead', 'Project Lead'], ['team_member', 'Team Member']] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => pickRole(val)}
                  className={cn(
                    'rounded-[10px] border bg-[var(--card-inset)] px-3 py-2.5 text-sm font-semibold transition-colors',
                    role === val ? 'border-[var(--success)] text-[var(--foreground)]' : 'border-[var(--border)] text-[var(--muted)]',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {role && (
            <div>
              <div className="mb-1.5 text-[11px] font-bold uppercase text-[var(--muted-2)]">Contribution modes</div>
              <div className="space-y-1.5">
                {PP_MODES.map(m => {
                  const locked = role === 'project_lead' && LOCKED_FOR_LEAD.includes(m.key)
                  const checked = modes.includes(m.key)
                  return (
                    <label
                      key={m.key}
                      className={cn(
                        'flex items-start gap-2.5 rounded-[8px] border border-[var(--border)] bg-[var(--card-inset)] p-2.5',
                        locked ? 'opacity-55' : 'cursor-pointer',
                      )}
                    >
                      <input type="checkbox" className="mt-0.5 shrink-0" checked={checked} disabled={locked} onChange={() => toggleMode(m.key)} />
                      <div>
                        <div className="text-[13px] text-[var(--foreground)]">{m.label}</div>
                        <div className="text-[11px] text-[var(--muted-2)]">{m.desc}</div>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase text-[var(--muted-2)]">Note (optional)</div>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-2)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              placeholder="Anything the chairman should know"
            />
          </div>

          {err && <p className="text-xs text-[var(--danger)]">{err}</p>}

          <Button variant="success" className="w-full" disabled={submit.isPending} onClick={onSubmit}>
            {submit.isPending ? 'Submitting…' : 'Submit Interest'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ── Team Interest summary (shown under each card) ────────────────────────── */
interface Interest {
  id: number
  project_id: string
  member_name: string
  family_name?: string | null
  preferred_role: string
  contribution_modes: string[]
  status: string
}

const STATUS_COLOR: Record<string, string> = {
  confirmed: '#34d399', rejected: '#f87171', awaiting_chairman: '#818cf8', pending: '#fbbf24',
}
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const initials = (name: string) => name.trim().slice(0, 1).toUpperCase()

export function TeamInterest({ projectId }: { projectId: string }) {
  const { user } = useAuth()
  const me = user?.name || ''

  const { data: interests = [] } = useQuery<Interest[]>({
    queryKey: ['interests', projectId],
    queryFn: () => fetch(`/api/projects/interests?project_id=${projectId}`, { credentials: 'include' }).then(r => r.ok ? r.json() : []),
    staleTime: 60_000,
  })

  const visible = interests.filter(r => r.status !== 'rejected' || r.member_name === me)
  if (!visible.length) return null

  return (
    <div className="mt-2.5 overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--card-inset)]">
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#60a5fa]">
        Team Interest
        <span className="ml-auto rounded-full bg-[var(--surface)] px-1.5 py-px text-[10px] font-semibold text-[var(--muted-2)]">{visible.length}</span>
      </div>
      <div className="divide-y divide-[var(--border-soft)]">
        {visible.map(r => {
          const color = STATUS_COLOR[r.status] ?? '#64748b'
          const roleLabel = r.preferred_role === 'project_lead' ? 'Project Lead' : 'Team Member'
          const modes = r.contribution_modes?.length ? r.contribution_modes.join(', ') : ''
          const isMe = r.member_name === me
          return (
            <div key={r.id} className="flex items-center gap-2.5 px-3 py-2">
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}
              >{initials(r.member_name)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[13px] leading-tight">
                  <span className="font-semibold text-[var(--foreground)]">{isMe ? 'You' : r.member_name}</span>
                  {r.family_name && <span className="text-[11px] text-[var(--muted-2)]">{r.family_name}</span>}
                </div>
                <div className="truncate text-[11px] text-[var(--muted-2)]">{roleLabel}{modes ? ` · ${modes}` : ''}</div>
              </div>
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ color, background: `${color}1f`, border: `1px solid ${color}3a` }}
              >{titleCase(r.status)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
