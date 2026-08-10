import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Plus, Check, Clock, ShieldCheck } from 'lucide-react'
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
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)]">Your role</div>
            <div className="grid grid-cols-2 gap-1 rounded-[12px] bg-[var(--card-inset)] p-1">
              {([['project_lead', 'Project Lead'], ['team_member', 'Team Member']] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => pickRole(val)}
                  className={cn('rounded-[9px] py-2.5 text-[13px] font-semibold transition-all', role === val ? 'text-white' : 'text-[var(--muted)]')}
                  style={role === val ? { background: 'linear-gradient(180deg,#22c55e,#16a34a)', boxShadow: '0 2px 8px rgba(34,197,94,.25)' } : undefined}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {role && (
            <div>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)]">Contribution modes</div>
              <div className="space-y-2.5">
                {PP_MODES.map(m => {
                  const locked = role === 'project_lead' && LOCKED_FOR_LEAD.includes(m.key)
                  const checked = modes.includes(m.key)
                  return (
                    <label
                      key={m.key}
                      className={cn(
                        'flex items-center gap-3 rounded-[12px] border bg-[var(--card-inset)] p-3 transition-colors',
                        checked ? 'border-[#22c55e55]' : 'border-[var(--border)]',
                        locked ? 'opacity-55' : 'cursor-pointer hover:border-[var(--muted-2)]',
                      )}
                    >
                      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border-2 transition-colors', checked ? 'border-[#22c55e] bg-[#22c55e]' : 'border-[var(--muted-2)] bg-transparent')}>
                        {checked && <Check size={13} strokeWidth={3.5} className="text-white" />}
                      </span>
                      <input type="checkbox" className="sr-only" checked={checked} disabled={locked} onChange={() => toggleMode(m.key)} />
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-[var(--foreground)]">{m.label}</div>
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

/**
 * Replaces the "Express Interest" button once the member has already applied —
 * the control now reflects where their application sits in the approval flow.
 * Hillary can approve her own awaiting_chairman/awaiting_coauthors submissions.
 */
function MyInterestStatus({ status, onApprove }: { status: string; onApprove?: () => void }) {
  const base = 'flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12px] font-semibold'
  if (status === 'confirmed') {
    return (
      <span className={base} style={{ color: '#34d399', background: 'rgba(52,211,153,.13)', border: '1px solid rgba(52,211,153,.4)' }}>
        <ShieldCheck size={13} /> Interest Confirmed
      </span>
    )
  }
  if (status === 'awaiting_chairman' || status === 'awaiting_coauthors') {
    return (
      <button onClick={onApprove} className={base} style={{ color: '#22c55e', background: 'rgba(34,197,94,.16)', border: '1px solid rgba(34,197,94,.5)', cursor: 'pointer' }}>
        <Check size={13} /> Approve
      </button>
    )
  }
  // pending / anything else mid-review — animated "checking approval" shimmer
  return (
    <span className={cn(base, 'status-checking')} style={{ color: '#fcd34d', background: 'rgba(251,191,36,.13)', border: '1px solid rgba(251,191,36,.4)' }}>
      <Clock size={13} /> Checking approval…
    </span>
  )
}

export function TeamInterest({ projectId, onExpressInterest }: { projectId: string; onExpressInterest: () => void }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const me = user?.name || ''
  const [open, setOpen] = useState(false)

  const { data: interests = [] } = useQuery<Interest[]>({
    queryKey: ['interests', projectId],
    queryFn: () => fetch(`/api/projects/interests?project_id=${projectId}`, { credentials: 'include' }).then(r => r.ok ? r.json() : []),
    staleTime: 60_000,
  })

  const approve = useMutation({
    mutationFn: (interestId: number) =>
      fetch(`/api/projects/interest/${interestId}/confirm`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed_role: 'team_member', confirmed_modes: [] }),
      }).then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Approval failed')
        return r.json()
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['interests', projectId] })
    },
  })

  const approveAsDad = useMutation({
    mutationFn: (interestId: number) =>
      fetch(`/api/projects/interest/${interestId}/hillary-as-dad-approve`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      }).then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Approval failed')
        return r.json()
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['interests', projectId] })
    },
  })

  const visible = interests.filter(r => r.status !== 'rejected' || r.member_name === me)
  // The member's own live application (a rejected one is treated as "not yet in",
  // so they can re-express). Drives whether we entice or show approval status.
  const mine = interests.find(r => r.member_name === me && r.status !== 'rejected')

  return (
    <div className="mt-4 rounded-[12px]" style={{ background: 'rgba(59,130,246,0.09)', border: '1px solid rgba(96,165,250,0.30)' }}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={() => visible.length && setOpen(o => !o)}
          className="flex flex-1 items-center gap-1.5 text-left"
          disabled={!visible.length}
        >
          <ChevronRight size={16} className={cn('text-[var(--muted)] transition-transform', open && 'rotate-90')} />
          <span className="text-[13px] font-semibold text-[var(--foreground)]">Team Interest</span>
          <span className="rounded-full bg-[var(--primary)]/15 px-1.5 text-[11px] font-semibold text-[#93c5fd]">{visible.length}</span>
        </button>
        {mine ? (
          <MyInterestStatus
            status={mine.status}
            onApprove={() => mine.id && approve.mutate(mine.id)}
          />
        ) : (
          <button
            onClick={onExpressInterest}
            className="cta-entice flex items-center gap-1 rounded-[8px] px-2.5 py-1.5 text-[12px] font-semibold text-[#bbf7d0]"
            style={{ background: 'rgba(34,197,94,.16)', border: '1px solid rgba(34,197,94,.5)' }}
          >
            <Plus size={13} /> Express Interest
          </button>
        )}
      </div>

      {open && visible.length > 0 && (
        <div className="divide-y divide-[var(--border-soft)] border-t border-[var(--border-soft)]">
          {visible.map(r => {
            const color = STATUS_COLOR[r.status] ?? '#64748b'
            const roleLabel = r.preferred_role === 'project_lead' ? 'Project Lead' : 'Team Member'
            const modes = r.contribution_modes?.length ? r.contribution_modes.join(', ') : ''
            const isMe = r.member_name === me
            const canApproveAsDad = me === 'Hillary' && !isMe && r.status === 'awaiting_chairman'
            return (
              <div key={r.id} className="flex items-center gap-2.5 px-3 py-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: `${color}22`, color }}>{initials(r.member_name)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[13px] leading-tight">
                    <span className="font-semibold text-[var(--foreground)]">{isMe ? 'You' : r.member_name}</span>
                    {r.family_name && <span className="text-[11px] text-[var(--muted-2)]">{r.family_name}</span>}
                  </div>
                  <div className="truncate text-[11px] text-[var(--muted-2)]">{roleLabel}{modes ? ` · ${modes}` : ''}</div>
                </div>
                {canApproveAsDad ? (
                  <button onClick={() => r.id && approveAsDad.mutate(r.id)} className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color: '#22c55e', background: 'rgba(34,197,94,.16)', border: '1px solid rgba(34,197,94,.5)', cursor: 'pointer' }}>
                    Approve (as Dad)
                  </button>
                ) : (
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color, background: `${color}1f` }}>{titleCase(r.status)}</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
