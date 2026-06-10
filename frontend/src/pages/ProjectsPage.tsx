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

/** Themed accent per venture type — colour aids subconscious categorisation. */
const CATEGORY_THEME: Record<string, { bar: string; text: string; from: string; to: string; glow: string; tint: string }> = {
  'Farming & Agriculture': { bar: '#34d399', text: '#86efac', from: 'rgba(34,197,94,.16)', to: 'rgba(34,197,94,.02)', glow: 'rgba(34,197,94,.30)', tint: 'rgba(34,197,94,.14)' },
  'Business Ventures':     { bar: '#38bdf8', text: '#7dd3fc', from: 'rgba(56,189,248,.16)', to: 'rgba(56,189,248,.02)', glow: 'rgba(56,189,248,.30)', tint: 'rgba(56,189,248,.14)' },
  'Unit Trusts':           { bar: '#a78bfa', text: '#c4b5fd', from: 'rgba(167,139,250,.16)', to: 'rgba(167,139,250,.02)', glow: 'rgba(167,139,250,.30)', tint: 'rgba(167,139,250,.14)' },
  'Real Estate':           { bar: '#fbbf24', text: '#fcd34d', from: 'rgba(245,158,11,.16)', to: 'rgba(245,158,11,.02)', glow: 'rgba(245,158,11,.30)', tint: 'rgba(245,158,11,.14)' },
}
const categoryTheme = (c: string) => CATEGORY_THEME[c] ?? CATEGORY_THEME['Farming & Agriculture']

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

function Sparkline({ color }: { color: string }) {
  const bars = [38, 52, 44, 66, 58, 88, 72, 95]
  return (
    <div className="flex h-7 items-end gap-[3px]">
      {bars.map((h, i) => (
        <div key={i} className="w-[3px] rounded-[2px]" style={{ height: `${h}%`, background: color, opacity: 0.35 + (i / bars.length) * 0.65 }} />
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
  const shown = items.slice(0, MAX)
  const extra = items.length - MAX // overlaid on the last tile when > 0

  return (
    <div className="grid grid-cols-4 gap-2">
      {shown.map((m, i) => {
        const isLast = i === MAX - 1 && extra > 0
        return (
          <button
            key={i}
            onClick={() => window.open(m.src, '_blank')}
            className="relative aspect-square overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--background)]"
          >
            {m.type === 'image'
              ? <img src={m.src} className="h-full w-full object-cover" alt="" />
              : <><video src={m.src} className="h-full w-full object-cover" /><span className="absolute inset-0 flex items-center justify-center bg-black/35"><Play size={16} className="text-white" fill="white" /></span></>}
            {isLast && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm font-bold text-white">+{extra + 1}</span>
            )}
          </button>
        )
      })}
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

const fullActionBtn = 'flex h-11 w-full items-center gap-2.5 rounded-[10px] border border-[var(--border)] bg-[var(--card-inset)] px-4 text-[13px] font-medium text-[var(--foreground)] transition-colors hover:border-[var(--muted-2)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40'

function ProjectCard({ p, live }: { p: Project; live?: LiveChicken }) {
  const [showDetails, setShowDetails] = useState(false)
  const [updExpanded, setUpdExpanded] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [interestOpen, setInterestOpen] = useState(false)
  const hasAnalysis = ANALYSABLE.has(p.id)
  const hasAudit = AUDITABLE.has(p.id)
  const th = categoryTheme(p.category)

  return (
    <div className="mb-8 overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--card)]" style={{ boxShadow: '0 10px 30px rgba(0,0,0,.45)' }}>
      <div className="p-5">
        {/* Header */}
        <div className="mb-4 flex items-start gap-3">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[24px]"
            style={{ background: th.tint, boxShadow: `0 0 16px ${th.glow}` }}
          >{p.icon}</div>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[15px] font-bold leading-tight text-[var(--foreground)]">{p.name}</span>
              <StatusPill status={p.status} />
            </div>
            <div className="mt-1 text-[12px] text-[var(--muted-2)]">{p.category}</div>
            <div className="text-[12px] text-[var(--muted-2)]">Lead: <span className="text-[var(--muted)]">{p.lead}</span></div>
          </div>
        </div>

        {/* Themed hero metric */}
        <div className="mb-4 flex items-center gap-2.5 rounded-[10px] px-3.5 py-3" style={{ background: `linear-gradient(90deg,${th.from},${th.to})` }}>
          <TrendingUp size={16} className="shrink-0" style={{ color: th.bar }} />
          <span className="flex-1 text-[13px] font-bold uppercase tracking-wide" style={{ color: th.text }}>{p.headline}</span>
          <Sparkline color={th.bar} />
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

        {/* Management actions — collapsed under one full-width trigger to decompress the card */}
        <button
          onClick={() => setActionsOpen(o => !o)}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--card-inset)] text-[13px] font-semibold text-[var(--foreground)] transition-colors hover:border-[var(--muted-2)]"
        >
          <SlidersHorizontal size={15} /> View Management Actions
          <ChevronDown size={15} className={cn('transition-transform', actionsOpen && 'rotate-180')} />
        </button>
        {actionsOpen && (
          <div className="mt-2 space-y-2">
            {hasAnalysis && <button className={fullActionBtn} onClick={() => setAnalysisOpen(true)}><BarChart3 size={15} className="text-[#60a5fa]" /> Analysis</button>}
            {hasAudit && <button className={fullActionBtn} onClick={() => setAuditOpen(true)}><ClipboardList size={15} className="text-[#94a3b8]" /> Audit</button>}
            <button className={fullActionBtn} onClick={() => setShowDetails(s => !s)}>
              <ChevronDown size={15} className={cn('transition-transform', showDetails && 'rotate-180')} /> {showDetails ? 'Hide Details' : 'Show Details'}
            </button>
            {p.id === 'washing_bay' && <WashingBayIncome />}
          </div>
        )}

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
  const pill = 'flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold transition-colors'

  return (
    <div className="mx-auto max-w-3xl pt-1">
      <h1 className="text-[22px] font-bold tracking-tight text-[var(--foreground)]">Our Projects</h1>
      <p className="mt-1 text-[13px] text-[var(--muted)]">{projects.length} ventures across the portfolio</p>

      <div className="mb-7 mt-5 flex flex-wrap gap-3.5">
        <span className={cn(pill, 'bg-[var(--surface)] text-[var(--foreground)] ring-1 ring-white/5')}><SlidersHorizontal size={14} /> All</span>
        <button onClick={() => openPortfolio('ranking')} className={cn(pill, 'bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--surface)]')}><LayoutGrid size={14} /> Portfolio AI</button>
        <button onClick={() => openPortfolio('ventures')} className={cn(pill, 'bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--surface)]')}><Tag size={14} /> New Ventures</button>
      </div>

      {isLoading && <p className="py-6 text-center text-xs text-[var(--muted)]">Loading projects…</p>}

      {projects.map(p => <ProjectCard key={p.id} p={p} live={liveData?.chicken} />)}

      <PortfolioModal open={portfolioOpen} onOpenChange={setPortfolioOpen} tab={portfolioTab} onTabChange={setPortfolioTab} />
    </div>
  )
}
