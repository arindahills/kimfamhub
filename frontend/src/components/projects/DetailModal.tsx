import { type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Card, Inset } from '@/components/ui/card'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { LoadingRow } from '@/components/ui/spinner'
import { MiniChart, type Series } from '@/components/projects/MiniChart'
import { cn, ugx } from '@/lib/utils'

/** Projects with a /detail analysis endpoint. */
export const ANALYSABLE = new Set(['chicken', 'trees', 'sheep', 'washing_bay', 'irrigation', 'dairy', 'bees'])

type Num = (number | null)[]
interface ChartData {
  labels?: string[]
  projected_cumulative?: Num; projected_cumrev_mid?: Num; actual_points?: Num; capex_line?: Num
  revenue?: Num; profit?: Num
  break_even_month?: number
}
interface Projection { revenue_by_year?: Num; profit_by_year?: Num; cumulative_profit?: Num }
type DetailData = Record<string, unknown> & { chart_data?: ChartData; projection?: Projection }

/* ── value helpers ──────────────────────────────────────────────────────── */
const isScalar = (v: unknown) => v == null || typeof v !== 'object'
const isLongText = (v: unknown) => typeof v === 'string' && v.length > 52
const prettyKey = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const MONEY_KEY = /revenue|profit|income|balance|capex|capital|value|cost|amount|total|cumulative|sales|contributed|cut|payback|recoup|position|investment|price|spend/i
function prettyVal(v: unknown): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return Math.abs(v) >= 1000 ? ugx(v) : v.toLocaleString()
  return String(v)
}
const isMoney = (k: string, v: unknown) => typeof v === 'number' && Math.abs(v) >= 1000 && MONEY_KEY.test(k)

/* ── KPI rows: label left (gray) · value right (bold white) ──────────────── */
function KpiRows({ obj }: { obj: Record<string, unknown> }) {
  const rows = Object.entries(obj).filter(([, v]) => isScalar(v))
  if (!rows.length) return null
  return (
    <div className="divide-y divide-white/[0.05]">
      {rows.map(([k, v]) =>
        isLongText(v) ? (
          <div key={k} className="py-2.5">
            <div className="mb-1.5 text-[11px] text-[var(--muted-2)]">{prettyKey(k)}</div>
            <div className="rounded-[8px] border-l-2 px-3 py-2 text-[12px] leading-relaxed text-[#cbd5e1]"
              style={{ borderColor: 'var(--primary)', background: 'var(--card-inset)' }}>
              {String(v)}
            </div>
          </div>
        ) : (
          <div key={k} className="flex items-center justify-between gap-4 py-2.5">
            <span className="text-[13px] text-[var(--muted)]">{prettyKey(k)}</span>
            <span className={cn('text-right text-[13px] font-semibold tabular-nums', isMoney(k, v) ? 'text-[#4ade80]' : 'text-white')}>{prettyVal(v)}</span>
          </div>
        ),
      )}
    </div>
  )
}

/* ── Log streams: each row → a clean feed card (no tables) ───────────────── */
function FeedCard({ item }: { item: Record<string, unknown> }) {
  const entries = Object.entries(item).filter(([, v]) => isScalar(v))
  const find = (re: RegExp) => entries.find(([k, v]) => re.test(k) && !isLongText(v))?.[0]
  const dateK = find(/date|when|time|month|year/i)
  const qtyK = find(/\b(qty|quantity|count|units?|number|head)\b/i)
  const prodK = find(/product|type|item|breed|category|name/i)
  const descK = entries.find(([k, v]) => /reason|note|desc|source|detail|cause|comment/i.test(k) || isLongText(v))?.[0]
  const used = new Set([dateK, qtyK, prodK, descK].filter(Boolean) as string[])
  const others = entries.filter(([k]) => !used.has(k))
  const primary = dateK ?? prodK ?? entries[0]?.[0]

  return (
    <div className="rounded-[12px] border border-[var(--border)] bg-[var(--card)] p-3.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[14px] font-semibold text-white">{primary ? prettyVal(item[primary]) : '—'}</span>
        {qtyK && (
          <Badge tone="neutral">
            {prettyVal(item[qtyK])}{prodK && prodK !== primary ? ` ${prettyVal(item[prodK])}` : ''}
          </Badge>
        )}
      </div>
      {others.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-[var(--muted-2)]">
          {others.map(([k, v]) => <span key={k}>{prettyKey(k)}: <span className="text-[#cbd5e1]">{prettyVal(v)}</span></span>)}
        </div>
      )}
      {descK && (
        <div className="mt-2 rounded-[8px] border-l-2 px-3 py-2 text-[12px] leading-relaxed text-[#cbd5e1]"
          style={{ borderColor: 'rgba(96,165,250,0.5)', background: 'var(--card-inset)' }}>
          {prettyVal(item[descK])}
        </div>
      )}
    </div>
  )
}

/** Recursively render any value: scalars→KPI card, arrays→feed cards, nested→sub-blocks. */
function renderValue(v: unknown): ReactNode {
  if (Array.isArray(v)) {
    if (v.length && typeof v[0] === 'object' && v[0] !== null) {
      return <div className="space-y-2.5">{v.map((o, i) => <FeedCard key={i} item={o as Record<string, unknown>} />)}</div>
    }
    return <Card className="p-3 text-[12px] leading-relaxed text-[#cbd5e1]">{v.map(x => String(x)).join(', ') || '—'}</Card>
  }
  if (v && typeof v === 'object') return <ObjBlock obj={v as Record<string, unknown>} />
  return <Card className="p-3 text-[13px] text-[#cbd5e1]">{prettyVal(v)}</Card>
}

function ObjBlock({ obj }: { obj: Record<string, unknown> }) {
  const scalars = Object.fromEntries(Object.entries(obj).filter(([, v]) => isScalar(v)))
  const complex = Object.entries(obj).filter(([, v]) => !isScalar(v))
  return (
    <>
      {Object.keys(scalars).length > 0 && <Card className="px-4 py-1.5"><KpiRows obj={scalars} /></Card>}
      {complex.map(([k, v]) => (
        <div key={k} className="mt-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">{prettyKey(k)}</div>
          {renderValue(v)}
        </div>
      ))}
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <div className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.12em] text-[#93c5fd]">{title}</div>
      {children}
    </div>
  )
}

const PROB_TONE: Record<string, BadgeProps['tone']> = { High: 'danger', Medium: 'warning', Low: 'success' }
function RisksSection({ risks }: { risks: { risk: string; probability: string; impact: string; note?: string }[] }) {
  return (
    <Section title="Risks">
      <div className="space-y-2">
        {risks.map((r, i) => (
          <Inset key={i} className="p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-white">{r.risk}</span>
              <div className="flex shrink-0 gap-1">
                <Badge tone={PROB_TONE[r.probability] ?? 'neutral'}>P: {r.probability}</Badge>
                <Badge tone={PROB_TONE[r.impact] ?? 'neutral'}>I: {r.impact}</Badge>
              </div>
            </div>
            {r.note && <p className="text-[12px] leading-relaxed text-[var(--muted)]">{r.note}</p>}
          </Inset>
        ))}
      </div>
    </Section>
  )
}

/* ── Headline KPIs: surface the few most important figures at the very top ── */
const HEADLINE = /total[_ ]?revenue|annual[_ ]?revenue|monthly[_ ]?revenue|total[_ ]?sales|gross[_ ]?position|net[_ ]?position|annual[_ ]?profit|total[_ ]?actual|total[_ ]?contributed|total[_ ]?capex|total[_ ]?value/i
function findHeadlines(data: DetailData): { label: string; value: number }[] {
  const out: { label: string; value: number }[] = []
  const seen = new Set<string>()
  const consider = (k: string, v: unknown) => {
    if (typeof v === 'number' && v !== 0 && HEADLINE.test(k) && !seen.has(k)) { seen.add(k); out.push({ label: prettyKey(k), value: v }) }
  }
  for (const [secK, secV] of Object.entries(data)) {
    if (secV && typeof secV === 'object' && !Array.isArray(secV)) {
      for (const [k, v] of Object.entries(secV)) consider(k, v)
    } else consider(secK, secV)
  }
  return out.slice(0, 3)
}

function buildChart(d: DetailData): { labels: string[]; series: Series[]; breakEvenIndex?: number } | null {
  const cd = d.chart_data
  if (cd?.labels?.length) {
    const s: Series[] = []
    if (cd.projected_cumulative) s.push({ name: 'Projected cumulative', data: cd.projected_cumulative, kind: 'line', color: '#34d399' })
    if (cd.projected_cumrev_mid) s.push({ name: 'Projected revenue', data: cd.projected_cumrev_mid, kind: 'line', color: '#34d399' })
    if (cd.actual_points) s.push({ name: 'Actual', data: cd.actual_points, kind: 'line', color: '#60a5fa' })
    if (cd.revenue) s.push({ name: 'Revenue', data: cd.revenue, kind: 'bar', color: '#38bdf8' })
    if (cd.profit) s.push({ name: 'Profit', data: cd.profit, kind: 'line', color: '#34d399' })
    if (cd.capex_line) s.push({ name: 'CapEx', data: cd.capex_line, kind: 'ref', color: '#f87171' })
    if (s.length) return { labels: cd.labels, series: s, breakEvenIndex: cd.break_even_month }
  }
  const pj = d.projection
  if (pj && (pj.profit_by_year || pj.cumulative_profit)) {
    const base = pj.revenue_by_year || pj.profit_by_year || []
    const labels = base.map((_, i) => `Yr ${i + 1}`)
    const s: Series[] = []
    if (pj.revenue_by_year) s.push({ name: 'Revenue', data: pj.revenue_by_year, kind: 'bar', color: '#38bdf8' })
    if (pj.profit_by_year) s.push({ name: 'Profit', data: pj.profit_by_year, kind: 'bar', color: '#34d399' })
    if (pj.cumulative_profit) s.push({ name: 'Cumulative profit', data: pj.cumulative_profit, kind: 'line', color: '#a78bfa' })
    if (s.length) return { labels, series: s }
  }
  return null
}

export function DetailModal({
  projectId, projectName, icon, open, onOpenChange,
}: {
  projectId: string; projectName: string; icon: string; open: boolean; onOpenChange: (o: boolean) => void
}) {
  const { data, isLoading } = useQuery<DetailData>({
    queryKey: ['detail', projectId],
    queryFn: () => fetch(`/api/projects/${projectId}/detail`, { credentials: 'include' }).then(r => r.json()),
    enabled: open,
    staleTime: 300_000,
  })

  const chart = data ? buildChart(data) : null
  const headlines = data ? findHeadlines(data) : []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`${icon} ${projectName} Analysis`} subtitle="Live operational and financial breakdown">
        {isLoading || !data ? (
          <LoadingRow label="Loading analysis…" />
        ) : (
          <div>
            {/* Hero KPIs */}
            {headlines.length > 0 && (
              <div className={cn('mb-4 grid gap-2', headlines.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
                {headlines.map(h => (
                  <Card key={h.label} className="p-3.5">
                    <div className="text-[10px] uppercase tracking-[0.06em] text-[var(--muted-2)]">{h.label}</div>
                    <div className="mt-1 text-[17px] font-bold tabular-nums text-[#4ade80]">{ugx(h.value)}</div>
                  </Card>
                ))}
              </div>
            )}

            {chart && (
              <Section title="Projection">
                <Card className="p-3"><MiniChart labels={chart.labels} series={chart.series} breakEvenIndex={chart.breakEvenIndex} /></Card>
              </Section>
            )}

            {Object.entries(data).map(([key, value]) => {
              if (key === 'chart_data' || key === 'projection' || value == null) return null
              if (key === 'risks' && Array.isArray(value) && value.length) {
                return <RisksSection key={key} risks={value as { risk: string; probability: string; impact: string; note?: string }[]} />
              }
              return <Section key={key} title={prettyKey(key)}>{renderValue(value)}</Section>
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
