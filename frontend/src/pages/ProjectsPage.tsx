import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, ClipboardList, ChevronDown, Plus, User, Pin } from 'lucide-react'
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

const STATUS_COLOR: Record<string, string> = {
  Operational: '#22c55e', Active: '#22c55e',
  'Due Diligence': '#f59e0b', 'Under Review': '#f59e0b',
  Planning: '#60a5fa', 'Early Planning': '#60a5fa',
  Research: '#a78bfa',
}
const statusColor = (s: string) => STATUS_COLOR[s] ?? '#94a3b8'
const ANALYSIS_ACCENT: Record<string, string> = {
  chicken: '#60a5fa', trees: '#34d399', sheep: '#fbbf24', washing_bay: '#a8a29e',
  irrigation: '#2dd4bf', dairy: '#60a5fa', bees: '#fbbf24',
}

const fmtCell = (v?: string) => {
  if (v == null || v === '') return '—'
  const n = Number(String(v).replace(/,/g, ''))
  return isNaN(n) ? '—' : ugx(n)
}

function ChickenLivePL({ c }: { c: LiveChicken }) {
  const num = (k: string) => Number(String(c[k]?.value || '0').replace(/,/g, ''))
  const gp = num('Gross Position')
  const np = num('Net Position (with CapEx)')
  const keys = ['sales', 'Available Stock (Cost)', 'Operating Expenses (OPEX)', 'Capital Expenses (CapEx)', 'Gross Position', 'Net Position (with CapEx)']
  if (!keys.some(k => num(k) !== 0)) return null
  const Stat = ({ v, l, color }: { v?: string; l: string; color: string }) => (
    <div className="rounded-[10px] border border-[var(--border)] bg-[var(--background)] p-2.5 text-center">
      <div className="text-sm font-bold tabular-nums" style={{ color }}>{fmtCell(v)}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--muted-2)]">{l}</div>
    </div>
  )
  return (
    <div className="mt-3 rounded-[12px] border border-[#16653433] bg-[#052e1622] p-3">
      <div className="mb-2.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--success)]">
        <BarChart3 size={12} /> Live P&amp;L from Farm App
      </div>
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

/** Cohesive secondary action button used in the card action bar. */
function ActionButton({ icon, label, accent, disabled, onClick }: {
  icon: React.ReactNode; label: string; accent?: string; disabled?: boolean; onClick?: () => void
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-[42px] items-center justify-center gap-1.5 rounded-[10px] border text-[13px] font-semibold transition-all',
        disabled
          ? 'cursor-not-allowed border-[var(--border-soft)] bg-[var(--card-inset)] text-[#3a4759]'
          : 'border-[var(--border)] bg-[var(--card-inset)] text-[var(--foreground)] hover:border-[var(--muted-2)] active:scale-[0.98]',
      )}
      style={!disabled && accent ? { color: accent } : undefined}
    >
      {icon}{label}
    </button>
  )
}

function ProjectCard({ p, live }: { p: Project; live?: LiveChicken }) {
  const [showDetails, setShowDetails] = useState(false)
  const [updExpanded, setUpdExpanded] = useState(false)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [interestOpen, setInterestOpen] = useState(false)
  const sc = statusColor(p.status)
  const hasAnalysis = ANALYSABLE.has(p.id)
  const hasAudit = AUDITABLE.has(p.id)

  return (
    <div
      className="group relative mb-4 overflow-hidden rounded-[16px] border border-[var(--border)] transition-all duration-200 hover:border-[#3f5068]"
      style={{ background: 'linear-gradient(180deg,#1f2a3d 0%,#19212e 100%)', boxShadow: '0 4px 20px rgba(0,0,0,.28)' }}
    >
      <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: sc }} />

      <div className="px-4 pt-4">
        <div className="mb-2.5 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border text-[24px]"
              style={{ background: `${sc}14`, borderColor: `${sc}33` }}
            >{p.icon}</div>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold leading-tight text-[var(--foreground)]">{p.name}</div>
              <div className="mt-0.5 text-[11px] text-[var(--muted-2)]">{p.category}</div>
            </div>
          </div>
          <span
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{ color: sc, background: `${sc}14`, border: `1px solid ${sc}33` }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: sc }} />{p.status}
          </span>
        </div>

        <div className="mb-2.5 flex items-center gap-1.5 text-xs text-[var(--muted-2)]">
          <User size={13} className="opacity-70" /> {p.lead}
        </div>

        <div
          className="mb-2.5 flex items-center gap-2 rounded-[10px] px-3 py-2 text-[13px] font-semibold text-[#4ade80]"
          style={{ background: 'linear-gradient(90deg,#052e1655,#052e1611)', borderLeft: '3px solid #22c55e' }}
        >
          <Pin size={13} className="shrink-0 -rotate-45" /> {p.headline}
        </div>

        {p.update && (
          <div className="mb-2.5 overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--card-inset)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--success)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" /> Latest update
              </span>
              <span className="text-[11px] text-[var(--muted-2)]">{p.update.date}</span>
            </div>
            <div className="p-3">
              {p.update.images?.length > 0 && (
                <div className="mb-2.5 flex gap-2 overflow-x-auto pb-1">
                  {p.update.images.map((src, i) => (
                    <img key={i} src={src} onClick={() => window.open(src, '_blank')} className="h-[136px] shrink-0 cursor-pointer rounded-[10px] object-cover ring-1 ring-[var(--border)]" alt="" />
                  ))}
                </div>
              )}
              {p.update.videos?.length > 0 && (
                <div className="mb-2.5 flex gap-2 overflow-x-auto pb-1">
                  {p.update.videos.map((src, i) => <video key={i} src={src} controls className="h-[176px] shrink-0 rounded-[10px] bg-black ring-1 ring-[var(--border)]" />)}
                </div>
              )}
              <p className="text-[13px] leading-relaxed text-[#cbd5e1]">
                {p.update.text.length > 180 && !updExpanded ? p.update.text.slice(0, 180).trimEnd() + '…' : p.update.text}
                {p.update.text.length > 180 && (
                  <button onClick={() => setUpdExpanded(e => !e)} className="ml-1 font-medium text-[var(--info)] hover:underline">
                    {updExpanded ? 'Show less' : 'Read more'}
                  </button>
                )}
              </p>
              <div className="mt-1.5 text-[11px] text-[var(--muted)]">— {p.update.author}</div>
            </div>
          </div>
        )}

        {showDetails && (
          <div className="mt-1 border-t border-[var(--border)] pt-3 pb-1">
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
      </div>

      <div className="px-4 pb-4 pt-3">
        <div className="grid grid-cols-2 gap-2">
          <ActionButton icon={<BarChart3 size={15} />} label="Analysis" accent={ANALYSIS_ACCENT[p.id]} disabled={!hasAnalysis} onClick={() => setAnalysisOpen(true)} />
          <ActionButton icon={<ClipboardList size={15} />} label="Audit" disabled={!hasAudit} onClick={() => setAuditOpen(true)} />
          <ActionButton icon={<ChevronDown size={15} className={cn('transition-transform', showDetails && 'rotate-180')} />} label={showDetails ? 'Hide Details' : 'Show Details'} onClick={() => setShowDetails(s => !s)} />
          <button
            onClick={() => setInterestOpen(true)}
            className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-[10px] text-[13px] font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98]"
            style={{ background: 'linear-gradient(180deg,#22c55e,#16a34a)', boxShadow: '0 2px 8px rgba(34,197,94,.25)' }}
          >
            <Plus size={15} /> Interest
          </button>
        </div>
        {p.id === 'washing_bay' && <div className="mt-2"><WashingBayIncome /></div>}
        <TeamInterest projectId={p.id} />
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

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-end justify-between px-0.5">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-[var(--foreground)]">Our Projects</h1>
          <p className="mt-0.5 text-xs text-[var(--muted-2)]">{projects.length} ventures across the portfolio</p>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2.5">
        <button
          onClick={() => openPortfolio('ranking')}
          className="flex min-h-[46px] items-center justify-center gap-2 rounded-[12px] text-[13px] font-bold text-[#c4b5fd] transition-all hover:brightness-110 active:scale-[0.98]"
          style={{ background: 'linear-gradient(180deg,#241d52,#1a1640)', border: '1px solid #7c3aed66', boxShadow: '0 2px 10px rgba(124,58,237,.18)' }}
        >🎯 Portfolio AI</button>
        <button
          onClick={() => openPortfolio('ventures')}
          className="flex min-h-[46px] items-center justify-center gap-2 rounded-[12px] text-[13px] font-bold text-[#86efac] transition-all hover:brightness-110 active:scale-[0.98]"
          style={{ background: 'linear-gradient(180deg,#06321a,#04230f)', border: '1px solid #22c55e66', boxShadow: '0 2px 10px rgba(34,197,94,.15)' }}
        >🚀 New Ventures</button>
      </div>

      {isLoading && <p className="py-6 text-center text-xs text-[var(--muted)]">Loading projects…</p>}

      {projects.map(p => <ProjectCard key={p.id} p={p} live={liveData?.chicken} />)}

      <PortfolioModal open={portfolioOpen} onOpenChange={setPortfolioOpen} tab={portfolioTab} onTabChange={setPortfolioTab} />
    </div>
  )
}
