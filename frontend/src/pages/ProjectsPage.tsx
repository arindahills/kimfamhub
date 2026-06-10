import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { LoadingRow } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { AuditModal, AUDITABLE } from '@/components/projects/AuditModal'
import { WashingBayIncome } from '@/components/projects/WashingBayIncome'

interface ProjectData { label: string; value: string }
interface ProjectUpdate { date: string; author: string; text: string; images: string[]; videos: string[] }
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

const STATUS_TONE: Record<string, BadgeProps['tone']> = {
  Operational: 'success',
  Active: 'info',
  Planning: 'warning',
  Research: 'purple',
  'Under Review': 'danger',
  'Due Diligence': 'warning',
  'Early Planning': 'warning',
}

function ProjectCard({ p }: { p: Project }) {
  const [open, setOpen] = useState(false)

  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full p-4 text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{p.icon}</span>
            <div>
              <div className="text-sm font-semibold text-[var(--foreground)]">{p.name}</div>
              <div className="text-[11px] text-[var(--muted-2)]">{p.headline}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_TONE[p.status] ?? 'neutral'}>{p.status}</Badge>
            <ChevronRight
              size={16}
              className={cn('text-[var(--muted-2)] transition-transform', open && 'rotate-90')}
            />
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-[var(--border)] px-4 py-3">
          <div className="mb-2 text-[10px] text-[var(--muted-2)]">Lead: {p.lead} · {p.category}</div>

          {p.update?.images && p.update.images.length > 0 && (
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {p.update.images.map((src, i) => (
                <img key={i} src={src} className="h-36 shrink-0 cursor-pointer rounded-lg object-cover"
                  onClick={() => window.open(src, '_blank')} alt="" />
              ))}
            </div>
          )}
          {p.update?.videos && p.update.videos.length > 0 && (
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {p.update.videos.map((src, i) => (
                <video key={i} src={src} controls className="h-36 shrink-0 rounded-lg" />
              ))}
            </div>
          )}

          {p.update && (
            <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--card-inset)] p-3">
              <div className="mb-1 text-[10px] text-[var(--muted-2)]">Latest — {p.update.date} · {p.update.author}</div>
              <p className="text-xs leading-relaxed text-[#cbd5e1]">{p.update.text}</p>
            </div>
          )}

          <div className="space-y-1.5">
            {p.data.map(d => (
              <div key={d.label} className="flex gap-2 text-xs">
                <span className="shrink-0 text-[var(--muted-2)]" style={{ minWidth: 140 }}>{d.label}</span>
                <span className="text-[#cbd5e1]">{d.value}</span>
              </div>
            ))}
          </div>

          {/* Actions: per-project audit + washing-bay income */}
          {(AUDITABLE.has(p.id) || p.id === 'washing_bay') && (
            <div className="mt-3 flex gap-2">
              {AUDITABLE.has(p.id) && <AuditModal projectId={p.id} projectName={p.name} icon={p.icon} />}
              {p.id === 'washing_bay' && <WashingBayIncome />}
            </div>
          )}
        </div>
      )}
    </Card>
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
    <div className="mx-auto max-w-5xl space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map(c => {
          const active = cat === c
          return (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
                  : 'border-[var(--border)] bg-[var(--card)] text-[var(--muted-2)] hover:text-[var(--foreground)]',
              )}
            >
              {c === 'All' ? `All (${projects.length})` : c}
            </button>
          )
        })}
      </div>

      {isLoading && <LoadingRow label="Loading projects…" />}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {visible.map(p => <ProjectCard key={p.id} p={p} />)}
      </div>
    </div>
  )
}
