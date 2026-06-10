import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AuditModal, AUDITABLE } from '@/components/projects/AuditModal'
import { WashingBayIncome } from '@/components/projects/WashingBayIncome'
import { PortfolioModal } from '@/components/projects/PortfolioModal'
import { DetailModal, ANALYSABLE } from '@/components/projects/DetailModal'
import { InterestModal, TeamInterest } from '@/components/projects/InterestModal'
import { ugx } from '@/lib/utils'

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
  Planning: '#93c5fd', 'Early Planning': '#93c5fd',
  Research: '#94a3b8',
}
const statusColor = (s: string) => STATUS_COLOR[s] ?? '#94a3b8'

const ANALYSIS_STYLE: Record<string, { bg: string; bd: string; cl: string }> = {
  chicken:     { bg: '#0f3460', bd: '#1e3a5f', cl: '#93c5fd' },
  trees:       { bg: '#052e16', bd: '#14532d', cl: '#86efac' },
  sheep:       { bg: '#2d1b00', bd: '#78350f', cl: '#fcd34d' },
  washing_bay: { bg: '#1c1917', bd: '#44403c', cl: '#d6d3d1' },
  irrigation:  { bg: '#022c22', bd: '#065f46', cl: '#6ee7b7' },
  dairy:       { bg: '#0c1a2e', bd: '#1e40af', cl: '#93c5fd' },
  bees:        { bg: '#2d1a00', bd: '#92400e', cl: '#fcd34d' },
}

const fmtCell = (v?: string) => {
  if (v == null || v === '') return '—'
  const n = Number(String(v).replace(/,/g, ''))
  return isNaN(n) ? '—' : ugx(n)
}

const gridBtn = 'flex items-center justify-center gap-1.5 rounded-[8px] px-1.5 text-xs font-semibold min-h-[40px] transition-colors'

function ChickenLivePL({ c }: { c: LiveChicken }) {
  const gp = Number(String(c['Gross Position']?.value || '0').replace(/,/g, ''))
  const np = Number(String(c['Net Position (with CapEx)']?.value || '0').replace(/,/g, ''))
  const Stat = ({ v, l, color }: { v?: string; l: string; color: string }) => (
    <div className="rounded-[8px] bg-[var(--card)] p-2.5 text-center">
      <div className="text-sm font-bold" style={{ color }}>{fmtCell(v)}</div>
      <div className="mt-0.5 text-[10px] text-[var(--muted-2)]">{l}</div>
    </div>
  )
  return (
    <div className="mt-2.5 border-t border-[var(--border)] pt-2.5">
      <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--success)]">📊 Live P&amp;L from Farm App</div>
      <div className="grid grid-cols-2 gap-2">
        <Stat v={c['sales']?.value} l="Total Sales" color="#4ade80" />
        <Stat v={c['Available Stock (Cost)']?.value} l="Stock at Cost" color="#60a5fa" />
        <Stat v={c['Operating Expenses (OPEX)']?.value} l="OPEX" color="#f87171" />
        <Stat v={c['Capital Expenses (CapEx)']?.value} l="CapEx" color="#f87171" />
      </div>
      <div className="mt-2 flex justify-between text-xs"><span className="text-[var(--muted-2)]">Gross Position</span><span style={{ color: gp >= 0 ? '#4ade80' : '#f87171' }}>{fmtCell(c['Gross Position']?.value)}</span></div>
      <div className="mt-1 flex justify-between text-xs"><span className="text-[var(--muted-2)]">Net Position (with CapEx)</span><span style={{ color: np >= 0 ? '#4ade80' : '#f87171' }}>{fmtCell(c['Net Position (with CapEx)']?.value)}</span></div>
      <div className="mt-2 text-[11px] text-[var(--muted-2)]">Data entered live by Solomon Ariho</div>
    </div>
  )
}

function ProjectCard({ p, live }: { p: Project; live?: LiveChicken }) {
  const [showDetails, setShowDetails] = useState(false)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [interestOpen, setInterestOpen] = useState(false)
  const sc = statusColor(p.status)
  const hasAnalysis = ANALYSABLE.has(p.id)
  const hasAudit = AUDITABLE.has(p.id)
  const an = ANALYSIS_STYLE[p.id]

  return (
    <div className="mb-3.5 overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--card)]" style={{ boxShadow: '0 2px 8px rgba(0,0,0,.3)' }}>
      <div style={{ height: 4, background: sc }} />
      <div className="px-3.5 pt-3.5">
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="shrink-0 text-[28px]">{p.icon}</span>
            <div className="min-w-0">
              <div className="text-base font-bold leading-tight text-[var(--foreground)]">{p.name}</div>
              <div className="mt-0.5 text-[11px] text-[var(--muted-2)]">{p.category}</div>
            </div>
          </div>
          <span className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ color: sc, background: `${sc}18`, border: `1px solid ${sc}44` }}>{p.status}</span>
        </div>
        <div className="mb-1 text-xs text-[var(--muted-2)]">👤 {p.lead}</div>
        <div className="mb-2.5 rounded-[6px] px-2.5 py-1.5 text-[13px] font-medium text-[#4ade80]" style={{ background: '#052e1655', borderLeft: '3px solid #22c55e44' }}>📌 {p.headline}</div>

        {p.update && (
          <div className="mb-2.5 rounded-[8px] bg-[var(--surface)] p-2.5" style={{ borderLeft: '3px solid #22c55e' }}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--success)]">Latest update</span>
              <span className="text-[11px] text-[var(--muted-2)]">{p.update.date}</span>
            </div>
            {p.update.images?.length > 0 && (
              <div className="my-2 flex gap-2 overflow-x-auto pb-1">
                {p.update.images.map((src, i) => (
                  <img key={i} src={src} onClick={() => window.open(src, '_blank')} className="h-[140px] shrink-0 cursor-pointer rounded-lg object-cover" alt="" />
                ))}
              </div>
            )}
            {p.update.videos?.length > 0 && (
              <div className="my-2 flex gap-2 overflow-x-auto pb-1">
                {p.update.videos.map((src, i) => <video key={i} src={src} controls className="h-[180px] shrink-0 rounded-lg bg-black" />)}
              </div>
            )}
            <p className="text-[13px] leading-relaxed text-[#cbd5e1]">{p.update.text}</p>
            <div className="mt-1 text-[11px] text-[var(--muted)]">— {p.update.author}</div>
          </div>
        )}

        {showDetails && (
          <div className="pb-1">
            <div className="space-y-1.5">
              {p.data.map(d => (
                <div key={d.label} className="flex justify-between gap-3 text-xs">
                  <span className="shrink-0 text-[var(--muted-2)]">{d.label}</span>
                  <span className="text-right text-[#cbd5e1]" style={{ maxWidth: '60%' }}>{d.value}</span>
                </div>
              ))}
            </div>
            {p.id === 'chicken' && live && <ChickenLivePL c={live} />}
          </div>
        )}
      </div>

      <div className="px-3.5 pb-3.5 pt-2.5">
        <div className="mb-2 grid grid-cols-2 gap-2">
          <button
            disabled={!hasAnalysis}
            onClick={() => setAnalysisOpen(true)}
            className={gridBtn}
            style={hasAnalysis && an
              ? { background: an.bg, border: `1px solid ${an.bd}`, color: an.cl }
              : { background: 'var(--card-inset)', border: '1px solid var(--border-soft)', color: '#334155', cursor: 'not-allowed' }}
          >📊 Analysis</button>
          <button
            disabled={!hasAudit}
            onClick={() => setAuditOpen(true)}
            className={gridBtn}
            style={hasAudit
              ? { background: '#0f172a', border: '1px solid var(--border)', color: 'var(--muted)' }
              : { background: 'var(--card-inset)', border: '1px solid var(--border-soft)', color: '#334155', cursor: 'not-allowed' }}
          >📋 Audit</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setShowDetails(s => !s)}
            className={gridBtn}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)' }}
          >{showDetails ? '▴ Hide Details' : '▾ Show Details'}</button>
          <button
            onClick={() => setInterestOpen(true)}
            className={gridBtn}
            style={{ background: '#166534', color: '#86efac' }}
          >+ Interest</button>
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
      <h1 className="mb-3 text-center text-2xl font-bold text-[var(--foreground)]">Our Projects</h1>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <button onClick={() => openPortfolio('ranking')} className="min-h-[44px] rounded-[10px] px-2 py-2.5 text-[13px] font-bold" style={{ background: '#1e1b4b', border: '1px solid #7c3aed', color: '#a78bfa' }}>🎯 Portfolio AI</button>
        <button onClick={() => openPortfolio('ventures')} className="min-h-[44px] rounded-[10px] px-2 py-2.5 text-[13px] font-bold" style={{ background: '#052e16', border: '1px solid #22c55e', color: '#86efac' }}>🚀 New Ventures</button>
      </div>

      {isLoading && <p className="py-6 text-center text-xs text-[var(--muted)]">Loading projects…</p>}

      {projects.map(p => <ProjectCard key={p.id} p={p} live={liveData?.chicken} />)}

      <PortfolioModal open={portfolioOpen} onOpenChange={setPortfolioOpen} tab={portfolioTab} onTabChange={setPortfolioTab} />
    </div>
  )
}
