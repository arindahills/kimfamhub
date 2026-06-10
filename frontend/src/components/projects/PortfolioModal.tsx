import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Card, Inset } from '@/components/ui/card'
import { LoadingRow } from '@/components/ui/spinner'
import { ugx } from '@/lib/utils'

/* ── Ranking ──────────────────────────────────────────────────────────────── */
interface RankedItem {
  rank: number
  project_id: string
  tier: string
  tier_reason: string
  score_out_of_10: number
  score_rationale: string
  time_frame: string
  strategic_note: string
}
interface AiRanking {
  ranked: RankedItem[]
  portfolio_insight: string
  biggest_opportunity: string
  biggest_risk: string
  compounding_play: string
}
interface RankingResponse {
  portfolio_data: Record<string, unknown>
  ai_ranking: AiRanking
}

const TIER_TONE: Record<string, BadgeProps['tone']> = {
  'MOVE NOW': 'success',
  'BUILD CAREFULLY': 'warning',
  'LET COMPOUND': 'purple',
}

const PROJECT_META: Record<string, { icon: string; name: string }> = {
  chicken: { icon: '🐔', name: 'Free Range Chicken' },
  washing_bay: { icon: '🚗', name: 'Washing Bay' },
  sheep: { icon: '🐑', name: 'Sheep (Dorper)' },
  trees: { icon: '🌲', name: 'Tree Planting' },
  irrigation: { icon: '💧', name: 'Irrigation + Bananas' },
  dairy: { icon: '🐄', name: 'Dairy (Cows)' },
  bees: { icon: '🍯', name: 'Apiary (Bees)' },
}

function Insight({ label, body, color }: { label: string; body?: string; color: string }) {
  if (!body) return null
  return (
    <Inset className="mb-2 p-3">
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide" style={{ color }}>{label}</div>
      <p className="text-[13px] leading-relaxed text-[#cbd5e1]">{body}</p>
    </Inset>
  )
}

function RankingPane() {
  const ranking = useMutation<RankingResponse>({
    mutationFn: () => fetch('/api/portfolio/ranking', { credentials: 'include' }).then(r => r.json()),
  })

  if (ranking.isPending) {
    return (
      <LoadingRow label="Ranking all 7 projects across capital, speed, and risk…" />
    )
  }
  if (!ranking.data) {
    return (
      <div className="px-2 py-8 text-center">
        <div className="mb-3 text-4xl">📊</div>
        <div className="mb-1 text-sm font-semibold text-[var(--foreground)]">Strategic Portfolio Ranking</div>
        <p className="mx-auto mb-4 max-w-sm text-xs text-[var(--muted-2)]">
          The AI ranks every project into tiers, Move Now, Build Carefully, Let Compound, and tells you what to do in the next 90 days.
        </p>
        <Button onClick={() => ranking.mutate()}>⚡ Rank Portfolio</Button>
      </div>
    )
  }

  const r = ranking.data.ai_ranking
  const ranked = [...(r.ranked || [])].sort((a, b) => a.rank - b.rank)

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[11px] text-[var(--muted-2)]">{ranked.length} projects ranked</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => ranking.mutate()}>🔄 Refresh</Button>
      </div>

      {ranked.map(item => {
        const meta = PROJECT_META[item.project_id] ?? { icon: '📦', name: item.project_id }
        return (
          <Card key={item.project_id} className="mb-2.5 p-3.5">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">{meta.icon}</span>
                <div>
                  <div className="text-sm font-semibold text-[var(--foreground)]">#{item.rank} {meta.name}</div>
                  <Badge tone={TIER_TONE[item.tier] ?? 'neutral'} className="mt-1">{item.tier}</Badge>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-[var(--foreground)]">{item.score_out_of_10}<span className="text-xs text-[var(--muted-2)]">/10</span></div>
                <div className="text-[10px] uppercase text-[var(--muted-2)]">{item.time_frame}</div>
              </div>
            </div>
            <p className="mb-1.5 text-[11px] italic text-[var(--muted)]">{item.tier_reason}</p>
            <p className="mb-2 text-xs leading-relaxed text-[#cbd5e1]">{item.score_rationale}</p>
            <Inset className="p-2.5">
              <div className="mb-1 text-[10px] font-bold uppercase text-[#f59e0b]">Next 90 days</div>
              <p className="text-xs leading-relaxed text-[#cbd5e1]">{item.strategic_note}</p>
            </Inset>
          </Card>
        )
      })}

      <div className="mt-4 mb-2 text-xs font-bold text-[var(--muted)]">PORTFOLIO-WIDE</div>
      <Insight label="Portfolio insight" body={r.portfolio_insight} color="#60a5fa" />
      <Insight label="Biggest opportunity" body={r.biggest_opportunity} color="#22c55e" />
      <Insight label="Biggest risk" body={r.biggest_risk} color="#ef4444" />
      <Insight label="Compounding play" body={r.compounding_play} color="#a78bfa" />
    </div>
  )
}

/* ── New ventures ─────────────────────────────────────────────────────────── */
interface Resource { title: string; url: string; why_relevant: string }
interface Venture {
  rank: number
  name: string
  category: string
  headline: string
  why_now: string
  why_this_club: string
  capital_required_ugx: number
  capital_note: string
  revenue_model: string
  time_to_first_revenue: string
  annual_revenue_estimate_ugx: number
  annual_profit_estimate_ugx: number
  key_assumptions: string[]
  synergies_with_portfolio: string
  risks: string[]
  first_step: string
  external_resources: Resource[]
}
interface VenturesResponse {
  status: string
  focus_area: string
  result: { ventures: Venture[]; strategic_commentary?: string; compounding_sequence?: string }
}

function VentureCard({ v }: { v: Venture }) {
  const [open, setOpen] = useState(false)
  return (
    <Card className="mb-2.5 overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full p-3.5 text-left">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-[var(--foreground)]">#{v.rank} {v.name}</div>
            <div className="mt-0.5 text-[11px] text-[var(--muted-2)]">{v.headline}</div>
          </div>
          <Badge tone="info">{v.category}</Badge>
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-[var(--muted)]">
          <span>Capital: <b className="text-[var(--foreground)]">{ugx(v.capital_required_ugx)}</b></span>
          <span>First revenue: <b className="text-[var(--foreground)]">{v.time_to_first_revenue}</b></span>
          {v.annual_profit_estimate_ugx > 0 && (
            <span>Est. profit/yr: <b className="text-[var(--success)]">{ugx(v.annual_profit_estimate_ugx)}</b></span>
          )}
        </div>
      </button>
      {open && (
        <div className="border-t border-[var(--border)] px-3.5 py-3 space-y-2.5">
          <Field label="Why now" body={v.why_now} />
          <Field label="Why this club" body={v.why_this_club} />
          <Field label="Revenue model" body={v.revenue_model} />
          <Field label="Capital covers" body={v.capital_note} />
          <Field label="Synergies" body={v.synergies_with_portfolio} />
          {v.key_assumptions?.length > 0 && <ListField label="Key assumptions" items={v.key_assumptions} color="#60a5fa" />}
          {v.risks?.length > 0 && <ListField label="Risks" items={v.risks} color="#ef4444" />}
          <Inset className="p-2.5">
            <div className="mb-1 text-[10px] font-bold uppercase text-[#f59e0b]">First step (30 days)</div>
            <p className="text-xs leading-relaxed text-[#cbd5e1]">{v.first_step}</p>
          </Inset>
          {v.external_resources?.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase text-[var(--muted-2)]">Learn more</div>
              {v.external_resources.map((res, i) => (
                <a key={i} href={res.url} target="_blank" rel="noreferrer"
                  className="mb-1 block text-xs text-[var(--info)] underline">
                  {res.title} <span className="text-[var(--muted-2)] no-underline">— {res.why_relevant}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function Field({ label, body }: { label: string; body?: string }) {
  if (!body) return null
  return (
    <div>
      <div className="text-[10px] font-bold uppercase text-[var(--muted-2)]">{label}</div>
      <p className="text-xs leading-relaxed text-[#cbd5e1]">{body}</p>
    </div>
  )
}
function ListField({ label, items, color }: { label: string; items: string[]; color: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase" style={{ color }}>{label}</div>
      <ul className="mt-0.5 space-y-0.5">
        {items.map((it, i) => <li key={i} className="text-xs leading-relaxed text-[#cbd5e1]">• {it}</li>)}
      </ul>
    </div>
  )
}

function VenturesPane() {
  const ventures = useMutation<VenturesResponse>({
    mutationFn: () =>
      fetch('/api/portfolio/new_ventures', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ focus_area: 'all' }),
      }).then(r => r.json()),
  })

  if (ventures.isPending) {
    return (
      <LoadingRow label="Researching new ventures for Western Uganda, this can take a minute…" />
    )
  }
  if (!ventures.data) {
    return (
      <div className="px-2 py-8 text-center">
        <div className="mb-3 text-4xl">🚀</div>
        <div className="mb-1 text-sm font-semibold text-[var(--foreground)]">New Venture Ideas</div>
        <p className="mx-auto mb-4 max-w-sm text-xs text-[var(--muted-2)]">
          The AI reads the club mandate, existing assets, and Uganda market context, then proposes 5 fresh, auditable opportunities.
        </p>
        <Button onClick={() => ventures.mutate()}>⚡ Propose Ventures</Button>
      </div>
    )
  }

  const res = ventures.data.result
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[11px] text-[var(--muted-2)]">{res.ventures?.length || 0} ventures proposed</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => ventures.mutate()}>🔄 Regenerate</Button>
      </div>
      {(res.ventures || []).map(v => <VentureCard key={v.rank} v={v} />)}
      <Insight label="Strategic commentary" body={res.strategic_commentary} color="#60a5fa" />
      <Insight label="Compounding sequence" body={res.compounding_sequence} color="#a78bfa" />
    </div>
  )
}

/* ── Modal shell (controlled) ─────────────────────────────────────────────── */
export function PortfolioModal({
  open,
  onOpenChange,
  tab,
  onTabChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  tab: string
  onTabChange: (t: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="🧠 AI Portfolio Analysis" subtitle="Strategic ranking and new venture ideas">
        <Tabs value={tab} onValueChange={onTabChange}>
          <TabsList>
            <TabsTrigger value="ranking">📊 Ranking</TabsTrigger>
            <TabsTrigger value="ventures">🚀 New Ventures</TabsTrigger>
          </TabsList>
          <TabsContent value="ranking"><RankingPane /></TabsContent>
          <TabsContent value="ventures"><VenturesPane /></TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
