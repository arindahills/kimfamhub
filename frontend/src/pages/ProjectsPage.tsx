import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, ClipboardList, ChevronDown, TrendingUp, Play, SlidersHorizontal, LayoutGrid, Tag } from 'lucide-react'
import { AuditModal, AUDITABLE } from '@/components/projects/AuditModal'
import { WashingBayIncome } from '@/components/projects/WashingBayIncome'
import { PortfolioModal } from '@/components/projects/PortfolioModal'
import { DetailModal, ANALYSABLE } from '@/components/projects/DetailModal'
import { InterestModal, TeamInterest } from '@/components/projects/InterestModal'
import { cn, ugx } from '@/lib/utils'

interface ProjectData { label: string; value: string }
interface ProjectUpdate { date: string; author: string; text: string; images: string[]; videos: string[] }
interface Project {
  id: string; name: string; icon: string; category: string; status: string
  lead: string; headline: string; live?: boolean
  data: ProjectData[]; update?: ProjectUpdate
}
type LiveCell = { value: string; desc?: string }
type LiveChicken = Record<string, LiveCell>

/** Low-saturation status tints (bg, text) — depth over neon. */
const STATUS_TINT: Record<string, { bg: string; fg: string }> = {
  Operational: { bg: 'rgba(34,197,94,.13)', fg: '#6ee7b7' },
  Active: { bg: 'rgba(34,197,94,.13)', fg: '#6ee7b7' },
  'Due Diligence': { bg: 'rgba(234,179,8,.13)', fg: '#fcd34d' },
  'Under Review': { bg: 'rgba(234,179,8,.13)', fg: '#fcd34d' },
  Planning: { bg: 'rgba(96,165,250,.13)', fg: '#93c5fd' },
  'Early Planning': { bg: 'rgba(96,165,250,.13)', fg: '#93c5fd' },
  Research: { bg: 'rgba(167,139,250,.13)', fg: '#c4b5fd' },
}
const statusTint = (s: string) => STATUS_TINT[s] ?? { bg: 'rgba(148,163,184,.12)', fg: '#cbd5e1' }

const fmtCell = (v?: string) => {
  if (v == null || v === '') return '—'
  const n = Number(String(v).replace(/,/g, ''))
  return isNaN(n) ? '—' : ugx(n)
}

function StatusPill({ status }: { status: string }) {
  const t = statusTint(status)
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: t.bg, color: t.fg }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.fg }} />{status}
    </span>
  )
}

function Sparkline() {
  const bars = [40, 55, 45, 70, 60, 90, 75]
  return (
    <div className="flex h-7 items-end gap-[3px]">
      {bars.map((h, i) => (
        <div key={i} className="w-[3px] rounded-[2px] bg-[#34d399]" style={{ height: `${h}%`, opacity: 0.35 + (i / bars.length) * 0.65 }} />
      ))}
    </div>
  )
}

/** Uniform square media frames with a +X counter when more than 4 assets. */
function MediaGrid({ images, videos }: { images: string[]; videos: string[] }) {
  const items = [
    ...images.map(src => ({ src, type: 'image' as const })),
    ...videos.map(src => ({ src, type: 'video' as const })),
  ]
  if (!items.length) return null
  const MAX = 4
  const shown = items.length > MAX ? items.slice(0, MAX - 1) : items.slice(0, MAX)
  const extra = items.length - shown.length

  return (
    <div className="grid grid-cols-4 gap-2">
      {shown.map((m, i) => (
        <button
          key={i}
          onClick={() => window.open(m.src, '_blank')}
          className="relative aspect-square overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--background)]"
        >
          {m.type === 'image'
            ? <img src={m.src} className="h-full w-full object-cover" alt="" />
            : <><video src={m.src} className="h-full w-full object-cover" /><span className="absolute inset-0 flex items-center justify-center bg-black/35"><Play size={18} className="text-white" fill="white" /></span></>}
        </button>
      ))}
      {extra > 0 && (
        <button
          onClick={() => window.open(items[shown.length].src, '_blank')}
          className="flex aspect-square items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--card-inset)] text-sm font-bold text-[var(--muted)]"
        >+{extra}</button>
      )}
    </div>
  )
}

function ChickenLivePL({ c }: { c: LiveChicken }) {
  const num = (k: string) => Number(String(c[k]?.value || '0').replace(/,/g, ''))
  const gp = num('Gross Position'); const np = num('Net Position (with CapEx)')
  const keys = ['sales', 'Available Stock (Cost)', 'Operating Expenses (OPEX)', 'Capital Expenses (CapEx)', 'Gross Position', 'Net Position (with CapEx)']
  if (!keys.some(k => num(k) !== 0)) return null
  const Stat = ({ v, l, color }: { v?: string; l: string; color: string }) => (
    <div className="rounded-[10px] bg-[var(--background)] p-2.5 text-center">
      <div className="text-sm font-bold tabular-nums" style={{ color }}>{fmtCell(v)}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--muted-2)]">{l}</div>
    </div>
  )
  return (
    <div className="mt-3 rounded-[12px] bg-[var(--card-inset)] p-3">
      <div className="mb-2.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--success)]"><BarChart3 size={12} /> Live P&amp;L from Farm App</div>
      <div className="grid grid-cols-2 gap-2">
        <Stat v={c['sales']?.value} l="Total Sales" color="#4ade80" />
        <Stat v={c['Available Stock (Cost)']?.value} l="Stock at Cost" color="#60a5fa" />
        <Stat v={c['Operating Expenses (OPEX)']?.value} l="OPEX" color="#f87171" />
        <Stat v={c['Capital Expenses (CapEx)']?.value} l="CapEx" color="#f87171" />
      </div>
      <div className="mt-2.5 space-y-1 border-t border-[var(--border)] pt-2.5">
        <div className="flex justify-between text-xs"><span className="text-[var(--muted-2)]">Gross Position</span><span className="font-semibold tabular-nums" style={{ color: gp >= 0 ? '#4ade80' : '#f87171' }}>{fmtCell(c['Gross Position']?.value)}</span></div>
        <div className="flex justify-between text-xs"><span className="text-[var(--muted-2)]">Net Position (with CapEx)</span><span className="font-semibold tabular-nums" style={{ color: np >= 0 ? '#4ade80' : '#f87171' }}>{fmtCell(c['Net Position (with CapEx)']?.value)}</span></div>
      </div>
      <div className="mt-2 text-[10px] text-[var(--muted-2)]">Data entered live by Solomon Ariho</div>
    </div>
  )
}

const outlineBtn = 'flex h-10 items-center justify-center gap-1.5 rounded-[8px] border border-[var(--border)] bg-transparent text-[13px] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--card-inset)] active:scale-[0.98] disabled:cursor-not-allowed disabled:text-[#3a4759] disabled:hover:bg-transparent'

function ProjectCard({ p, live }: { p: Project; live?: LiveChicken }) {
  const [showDetails, setShowDetails] = useState(false)
  const [updExpanded, setUpdExpanded] = useState(false)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [interestOpen, setInterestOpen] = useState(false)
  const hasAnalysis = ANALYSABLE.has(p.id)
  const hasAudit = AUDITABLE.has(p.id)

  return (
    <div className="mb-3.5 overflow-hidden rounded-[16px] bg-[var(--card)]" style={{ boxShadow: '0 4px 20px rgba(0,0,0,.28)' }}>
      <div className="p-4">
        {/* Header */}
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-[22px]">{p.icon}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[15px] font-bold leading-tight text-[var(--foreground)]">{p.name}</span>
              <StatusPill status={p.status} />
            </div>
            <div className="mt-0.5 text-[12px] text-[var(--muted-2)]">{p.category}</div>
            <div className="text-[12px] text-[var(--muted-2)]">Lead: <span className="text-[var(--muted)]">{p.lead}</span></div>
          </div>
        </div>

        {/* Hero metric */}
        <div className="mb-3 flex items-center gap-2.5 rounded-[10px] px-3 py-2.5" style={{ background: 'linear-gradient(90deg,rgba(34,197,94,.15),rgba(34,197,94,.03))' }}>
          <TrendingUp size={16} className="shrink-0 text-[#34d399]" />
          <span className="flex-1 text-[13px] font-bold uppercase tracking-wide text-[#86efac]">{p.headline}</span>
          <Sparkline />
        </div>

        {/* Latest update */}
        {p.update && (
          <div className="mb-3 rounded-[12px] bg-[var(--card-inset)] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">Latest Update</span>
              <span className="text-[11px] text-[var(--muted-2)]">{p.update.date}</span>
            </div>
            <MediaGrid images={p.update.images || []} videos={p.update.videos || []} />
            <p className="mt-2.5 text-[13px] leading-relaxed text-[#cbd5e1]">
              {p.update.text.length > 160 && !updExpanded ? p.update.text.slice(0, 160).trimEnd() + '…' : p.update.text}
              {p.update.text.length > 160 && (
                <button onClick={() => setUpdExpanded(e => !e)} className="ml-1 font-medium text-[var(--info)] hover:underline">{updExpanded ? 'Show less' : 'Read more'}</button>
              )}
            </p>
            <div className="mt-1.5 text-[11px] text-[var(--muted-2)]">— {p.update.author}</div>
          </div>
        )}

        {/* Inline details */}
        {showDetails && (
          <div className="mb-3 rounded-[12px] bg-[var(--card-inset)] p-3">
            <div className="space-y-2.5">
              {p.data.map(d => (
                <div key={d.label} className="flex justify-between gap-4 text-[13px] leading-snug">
                  <span className="shrink-0 text-[var(--muted-2)]">{d.label}</span>
                  <span className="text-right text-[#cbd5e1]" style={{ maxWidth: '62%' }}>{d.value}</span>
                </div>
              ))}
            </div>
            {p.id === 'chicken' && live && <ChickenLivePL c={live} />}
          </div>
        )}

        {/* Uniform action buttons */}
        <div className="grid grid-cols-3 gap-2">
          <button className={outlineBtn} disabled={!hasAnalysis} onClick={() => setAnalysisOpen(true)}><BarChart3 size={15} /> Analysis</button>
          <button className={outlineBtn} disabled={!hasAudit} onClick={() => setAuditOpen(true)}><ClipboardList size={15} /> Audit</button>
          <button className={outlineBtn} onClick={() => setShowDetails(s => !s)}><ChevronDown size={15} className={cn('transition-transform', showDetails && 'rotate-180')} /> {showDetails ? 'Hide' : 'Details'}</button>
        </div>

        {p.id === 'washing_bay' && <div className="mt-2"><WashingBayIncome /></div>}

        {/* Team Interest accordion (collapsed by default) + demoted Express Interest */}
        <TeamInterest projectId={p.id} onExpressInterest={() => setInterestOpen(true)} />
      </div>

      {hasAnalysis && <DetailModal projectId={p.id} projectName={p.name.replace(/ \(.*\)/, '')} icon={p.icon} open={analysisOpen} onOpenChange={setAnalysisOpen} />}
      {hasAudit && <AuditModal projectId={p.id} projectName={p.name.replace(/ \(.*\)/, '')} icon={p.icon} open={auditOpen} onOpenChange={setAuditOpen} />}
      <InterestModal projectId={p.id} projectName={p.name} open={interestOpen} onOpenChange={setInterestOpen} />
    </div>
  )
}

export default function ProjectsPage() {
  const [portfolioOpen, setPortfolioOpen] = useState(false)
  const [portfolioTab, setPortfolioTab] = useState('ranking')

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['projects-all'],
    queryFn: () => fetch('/api/projects/all', { credentials: 'include' }).then(r => r.json()),
    staleTime: 120_000,
  })
  const { data: liveData } = useQuery<{ chicken?: LiveChicken }>({
    queryKey: ['projects-live'],
    queryFn: () => fetch('/api/projects', { credentials: 'include' }).then(r => r.json()),
    staleTime: 120_000,
  })

  const openPortfolio = (tab: string) => { setPortfolioTab(tab); setPortfolioOpen(true) }
  const pill = 'flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold transition-colors'

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-[22px] font-bold tracking-tight text-[var(--foreground)]">Our Projects</h1>
      <p className="mt-0.5 text-xs text-[var(--muted-2)]">{projects.length} ventures across the portfolio</p>

      <div className="mb-5 mt-3 flex flex-wrap gap-2.5">
        <span className={cn(pill, 'bg-[var(--surface)] text-[var(--foreground)]')}><SlidersHorizontal size={14} /> All</span>
        <button onClick={() => openPortfolio('ranking')} className={cn(pill, 'bg-transparent text-[var(--muted)] hover:bg-[var(--surface)]')}><LayoutGrid size={14} /> Portfolio AI</button>
        <button onClick={() => openPortfolio('ventures')} className={cn(pill, 'bg-transparent text-[var(--muted)] hover:bg-[var(--surface)]')}><Tag size={14} /> New Ventures</button>
      </div>

      {isLoading && <p className="py-6 text-center text-xs text-[var(--muted)]">Loading projects…</p>}

      {projects.map(p => <ProjectCard key={p.id} p={p} live={liveData?.chicken} />)}

      <PortfolioModal open={portfolioOpen} onOpenChange={setPortfolioOpen} tab={portfolioTab} onTabChange={setPortfolioTab} />
    </div>
  )
}
