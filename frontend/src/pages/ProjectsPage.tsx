import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BarChart3, ClipboardList, ChevronDown, TrendingUp, SlidersHorizontal, LayoutGrid, Tag, Sparkles, X } from 'lucide-react'
import { AuditModal, AUDITABLE } from '@/components/projects/AuditModal'
import { WashingBayIncome } from '@/components/projects/WashingBayIncome'
import { WashingBayCapital } from '@/components/projects/WashingBayCapital'
import { PortfolioModal } from '@/components/projects/PortfolioModal'
import { DetailModal, ANALYSABLE } from '@/components/projects/DetailModal'
import { ViabilityModal, PROJECTABLE } from '@/components/projects/ViabilityModal'
import { InterestModal, TeamInterest } from '@/components/projects/InterestModal'
import { MediaCarousel } from '@/components/projects/MediaCarousel'
import { AnimatedHeadline } from '@/components/AnimatedHeadline'
import { useInView } from '@/lib/useInView'
import { useAuth } from '@/context/AuthContext'
import { playPop } from '@/lib/sound'
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

/** Constitution (Investment & Reward Guidelines) asset class per operating category.
 *  Operating tags are what we filter by; the asset class is shown as a tag on each card. */
const ASSET_CLASS: Record<string, string> = {
  'Farming & Agriculture': 'Alternative investment',
  'Business Ventures': 'Alternative investment',
  'Unit Trusts': 'Unit trust',
  'Real Estate': 'Real estate',
}
const assetClass = (c: string) => ASSET_CLASS[c] ?? 'Alternative investment'

/** Operating-category filters (constitution-aligned grouping). null = All. */
const FILTERS: { label: string; value: string | null }[] = [
  { label: 'All', value: null },
  { label: 'Farming', value: 'Farming & Agriculture' },
  { label: 'Business', value: 'Business Ventures' },
  { label: 'Unit Trusts', value: 'Unit Trusts' },
  { label: 'Real Estate', value: 'Real Estate' },
]

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

/** Short "why join" pitch per venture category. */
const JOIN_PITCH: Record<string, string> = {
  'Farming & Agriculture': 'A hands-on farming venture with steady produce income. Bring labour, oversight, or capital and share the harvest.',
  'Business Ventures': 'A cash-generating service business. Add capital or commercial muscle and earn from every shift.',
  'Unit Trusts': 'Grow your money in professionally managed funds. Join with capital and let it compound.',
  'Real Estate': 'Build long-term family wealth in property. Contribute capital or oversight and own a piece.',
}
const joinPitch = (c: string) => JOIN_PITCH[c] ?? 'Be part of this venture early. Add your skills, capital, or oversight and share in the returns.'

interface InterestRow { member_name: string; status: string }

/**
 * Floating "why join" bubble. Appears over a card once it settles into focus,
 * only if the member has NOT already expressed interest. They can dismiss it
 * (suppressed for the session) or jump straight to Express Interest.
 */
function JoinBubble({
  projectId, projectName, category, focused, onExpress,
}: {
  projectId: string; projectName: string; category: string; focused: boolean; onExpress: () => void
}) {
  const { user } = useAuth()
  const me = user?.name || ''
  const storeKey = `kf_join_dismissed_${projectId}`
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(storeKey) === '1')
  const [armed, setArmed] = useState(false)

  const { data: interests = [], isSuccess } = useQuery<InterestRow[]>({
    queryKey: ['interests', projectId],
    queryFn: () => fetch(`/api/projects/interests?project_id=${projectId}`, { credentials: 'include' }).then(r => (r.ok ? r.json() : [])),
    staleTime: 60_000,
  })
  const mine = interests.find(r => r.member_name === me && r.status !== 'rejected')

  // AI-cooked, figure-led pitch (shared across all bubbles); falls back to the
  // static category line until the engine has cooked one.
  const { data: pitches } = useQuery<Record<string, string>>({
    queryKey: ['project-pitches'],
    queryFn: () => fetch('/api/projects/pitches', { credentials: 'include' }).then(r => (r.ok ? r.json() : {})),
    staleTime: 10 * 60_000,
  })
  const pitch = pitches?.[projectId] || joinPitch(category)

  // Only pop after the card has rested in focus for a beat — avoids flashing
  // while the user is scrolling straight past it.
  useEffect(() => {
    if (!focused) { setArmed(false); return }
    const t = setTimeout(() => setArmed(true), 650)
    return () => clearTimeout(t)
  }, [focused])

  const show = armed && isSuccess && !mine && !dismissed

  // Chime once when the bubble actually appears.
  useEffect(() => { if (show) playPop() }, [show])

  if (!show) return null

  const dismiss = () => { sessionStorage.setItem(storeKey, '1'); setDismissed(true) }

  return (
    <div className="bubble-pop pointer-events-none absolute inset-x-3 bottom-3 z-30">
      <div
        className="pointer-events-auto rounded-[14px] border p-3.5"
        style={{ background: 'rgba(16,24,40,.96)', borderColor: 'rgba(34,197,94,.45)', boxShadow: '0 14px 40px rgba(0,0,0,.6)', backdropFilter: 'blur(6px)' }}
      >
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: 'rgba(34,197,94,.16)', color: '#4ade80' }}>
            <Sparkles size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-bold text-[var(--foreground)]">Join {projectName}?</div>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">{pitch}</p>
          </div>
          <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 rounded-md p-1 text-[var(--muted-2)] hover:text-[var(--foreground)]">
            <X size={15} />
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={dismiss} className="flex-1 rounded-[9px] border border-[var(--border)] bg-transparent py-2 text-[12px] font-semibold text-[var(--muted)] transition-colors hover:text-[var(--foreground)]">
            Not now
          </button>
          <button
            onClick={() => { dismiss(); onExpress() }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-[9px] py-2 text-[12px] font-bold text-white"
            style={{ background: 'linear-gradient(180deg,#22c55e,#16a34a)', boxShadow: '0 3px 12px rgba(34,197,94,.35)' }}
          >
            Express Interest
          </button>
        </div>
      </div>
    </div>
  )
}

function ProjectCard({ p, live, focused }: { p: Project; live?: LiveChicken; focused?: boolean }) {
  const [showDetails, setShowDetails] = useState(false)
  const [updExpanded, setUpdExpanded] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [viabilityOpen, setViabilityOpen] = useState(false)
  const [interestOpen, setInterestOpen] = useState(false)
  const hasAnalysis = ANALYSABLE.has(p.id)
  const hasAudit = AUDITABLE.has(p.id)
  const hasProjection = PROJECTABLE.has(p.id)
  const th = categoryTheme(p.category)
  const { ref, seen } = useInView<HTMLDivElement>()

  return (
    <div
      ref={ref}
      data-project-card
      data-id={p.id}
      className="scroll-focus relative mb-3 overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--card)]"
      style={{ boxShadow: '0 12px 32px rgba(0,0,0,.5)' }}
    >
      <JoinBubble
        projectId={p.id}
        projectName={p.name}
        category={p.category}
        focused={!!focused}
        onExpress={() => setInterestOpen(true)}
      />
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
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[12px] text-[var(--muted-2)]">{p.category}</span>
              <span
                className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                style={{ background: 'rgba(167,139,250,0.13)', color: '#c4b5fd', border: '1px solid rgba(167,139,250,0.30)' }}
                title="Constitution asset class"
              >{assetClass(p.category)}</span>
            </div>
            <div className="text-[12px] text-[var(--muted-2)]">Lead: <span className="text-[var(--muted)]">{p.lead}</span></div>
          </div>
        </div>

        {/* Themed hero metric */}
        <div className="mb-4 flex items-center gap-2.5 rounded-[10px] px-3.5 py-3" style={{ background: `linear-gradient(90deg,${th.from},${th.to})` }}>
          <TrendingUp size={16} className="shrink-0" style={{ color: th.bar }} />
          <span className="flex-1 text-[13px] font-bold uppercase tracking-wide" style={{ color: th.text }}>
            <AnimatedHeadline text={p.headline} run={seen} />
          </span>
          <Sparkline color={th.bar} />
        </div>

        {/* Latest update */}
        {p.update && (
          <div className="mb-3 rounded-[12px] bg-[var(--card-inset)] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">Latest Update</span>
              <span className="text-[11px] text-[var(--muted-2)]">{p.update.date}</span>
            </div>
            <MediaCarousel images={p.update.images || []} videos={p.update.videos || []} />
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
            {hasProjection && <button className={fullActionBtn} onClick={() => setViabilityOpen(true)}><TrendingUp size={15} className="text-[#4ade80]" /> Viability Matrix</button>}
            {hasAnalysis && <button className={fullActionBtn} onClick={() => setAnalysisOpen(true)}><BarChart3 size={15} className="text-[#60a5fa]" /> Analysis</button>}
            {hasAudit && <button className={fullActionBtn} onClick={() => setAuditOpen(true)}><ClipboardList size={15} className="text-[#94a3b8]" /> Audit</button>}
            <button className={fullActionBtn} onClick={() => setShowDetails(s => !s)}>
              <ChevronDown size={15} className={cn('transition-transform', showDetails && 'rotate-180')} /> {showDetails ? 'Hide Details' : 'Show Details'}
            </button>
            {p.id === 'washing_bay' && <WashingBayIncome />}
            {p.id === 'washing_bay' && <WashingBayCapital />}
          </div>
        )}

        {/* Team Interest accordion (collapsed by default) + demoted Express Interest */}
        <TeamInterest projectId={p.id} onExpressInterest={() => setInterestOpen(true)} />
      </div>

      {hasAnalysis && <DetailModal projectId={p.id} projectName={p.name.replace(/ \(.*\)/, '')} icon={p.icon} open={analysisOpen} onOpenChange={setAnalysisOpen} />}
      {hasAudit && <AuditModal projectId={p.id} projectName={p.name.replace(/ \(.*\)/, '')} icon={p.icon} open={auditOpen} onOpenChange={setAuditOpen} />}
      {hasProjection && <ViabilityModal projectId={p.id} projectName={p.name.replace(/ \(.*\)/, '')} icon={p.icon} open={viabilityOpen} onOpenChange={setViabilityOpen} />}
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

  const { t } = useTranslation()
  const openPortfolio = (tab: string) => { setPortfolioTab(tab); setPortfolioOpen(true) }
  const pill = 'flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold transition-colors'

  // Operating-category filter (constitution-aligned). null = All.
  const [filter, setFilter] = useState<string | null>(null)
  const shown = filter ? projects.filter(p => p.category === filter) : projects

  // The single project currently in focus (nearest viewport centre) — drives
  // the "why join" bubble so only one appears at a time, on the project reached.
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const focusedRef = useRef<string | null>(null)

  // Scroll-driven focus: the card whose centre is nearest the viewport centre
  // stays full, neighbours dim and shrink slightly so attention follows scroll.
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    const update = () => {
      raf = 0
      const center = window.innerHeight / 2
      const span = window.innerHeight * 0.62
      let nearestId: string | null = null
      let nearestDist = Infinity
      document.querySelectorAll<HTMLElement>('[data-project-card]').forEach(el => {
        const r = el.getBoundingClientRect()
        const dist = Math.abs(r.top + r.height / 2 - center)
        if (!reduce) {
          const norm = Math.min(1, dist / span)
          el.style.opacity = String(1 - norm * 0.55)
          el.style.transform = `scale(${1 - norm * 0.05})`
        }
        // only consider cards actually on screen as "focused"
        if (r.bottom > 0 && r.top < window.innerHeight && dist < nearestDist) {
          nearestDist = dist
          nearestId = el.dataset.id ?? null
        }
      })
      if (nearestId !== focusedRef.current) {
        focusedRef.current = nearestId
        setFocusedId(nearestId)
      }
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [projects.length, filter])

  return (
    <div className="mx-auto max-w-3xl pt-1">
      <h1 className="text-[22px] font-bold tracking-tight text-[var(--foreground)]">{t('projects.ourProjects')}</h1>
      <p className="mt-1 text-[13px] text-[var(--muted)]">
        {shown.length} {filter ? `in ${filter}` : t('projects.ventures')}
      </p>

      {/* Constitution-aligned category filters */}
      <div className="mt-5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map(f => {
          const count = f.value === null ? projects.length : projects.filter(p => p.category === f.value).length
          if (f.value !== null && count === 0) return null
          const active = filter === f.value
          return (
            <button
              key={f.label}
              onClick={() => setFilter(f.value)}
              className={cn(pill, 'shrink-0 active:scale-95', active ? 'bg-[var(--surface)] text-[var(--foreground)] ring-1 ring-white/10' : 'text-[var(--muted)]')}
              style={active ? undefined : { border: '1px solid var(--border)' }}
            >
              {f.label === 'All' && <SlidersHorizontal size={14} />}
              {f.label}
              <span className="text-[var(--muted-2)]">{count}</span>
            </button>
          )
        })}
      </div>

      {/* AI tools — centered */}
      <div className="mb-4 mt-2.5 flex justify-center gap-3">
        <button onClick={() => openPortfolio('ranking')} className={cn(pill, 'glow-rim active:scale-95')} style={{ background: 'rgba(139,92,246,0.14)', border: '1px solid rgba(139,92,246,0.45)', color: '#c4b5fd', ['--rim' as string]: '#a78bfa' }}><LayoutGrid size={14} color="#a78bfa" /> {t('projects.portfolioAI')}</button>
        <button onClick={() => openPortfolio('ventures')} className={cn(pill, 'glow-rim active:scale-95')} style={{ background: 'rgba(34,197,94,0.13)', border: '1px solid rgba(34,197,94,0.45)', color: '#86efac', ['--rim' as string]: '#4ade80' }}><Tag size={14} color="#4ade80" /> {t('projects.newVentures')}</button>
      </div>

      {isLoading && <p className="py-6 text-center text-xs text-[var(--muted)]">Loading projects…</p>}

      {shown.map(p => <ProjectCard key={p.id} p={p} live={liveData?.chicken} focused={focusedId === p.id} />)}

      <PortfolioModal open={portfolioOpen} onOpenChange={setPortfolioOpen} tab={portfolioTab} onTabChange={setPortfolioTab} />
    </div>
  )
}
