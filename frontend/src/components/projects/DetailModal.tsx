import { type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Inset } from '@/components/ui/card'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { LoadingRow } from '@/components/ui/spinner'
import { MiniChart, type Series } from '@/components/projects/MiniChart'
import { ugx } from '@/lib/utils'

/** Projects with a /detail analysis endpoint. */
export const ANALYSABLE = new Set(['chicken', 'trees', 'sheep', 'washing_bay', 'irrigation', 'dairy', 'bees'])

type Num = (number | null)[]
interface ChartData {
  labels?: string[]
  projected_cumulative?: Num; projected_cumrev_mid?: Num; actual_points?: Num; capex_line?: Num
  revenue?: Num; profit?: Num
  break_even_month?: number
}
interface Projection {
  revenue_by_year?: Num; profit_by_year?: Num; cumulative_profit?: Num
}
type DetailData = Record<string, unknown> & { chart_data?: ChartData; projection?: Projection }

/** Build a chart from whichever shape the endpoint returned. */
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

const PROB_TONE: Record<string, BadgeProps['tone']> = { High: 'danger', Medium: 'warning', Low: 'success' }
const isScalar = (v: unknown) => v == null || typeof v !== 'object'
const prettyKey = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
function prettyVal(v: unknown): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return Math.abs(v) >= 100000 ? ugx(v) : v.toLocaleString()
  return String(v)
}

function KeyVals({ obj }: { obj: Record<string, unknown> }) {
  const rows = Object.entries(obj).filter(([, v]) => isScalar(v))
  if (!rows.length) return null
  return (
    <div className="space-y-2.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 text-xs leading-snug">
          <span className="shrink-0 text-[var(--muted-2)]">{prettyKey(k)}</span>
          <span className="text-right text-[#cbd5e1]">{prettyVal(v)}</span>
        </div>
      ))}
    </div>
  )
}

/** Recursively render any JSON value from a /detail endpoint. */
function renderValue(v: unknown): ReactNode {
  if (Array.isArray(v)) {
    if (v.length && typeof v[0] === 'object' && v[0] !== null) {
      return <div className="space-y-1.5">{v.map((o, i) => <Inset key={i} className="p-2.5"><KeyVals obj={o as Record<string, unknown>} /></Inset>)}</div>
    }
    return <div className="text-xs leading-relaxed text-[#cbd5e1]">{v.map(x => String(x)).join(', ') || '—'}</div>
  }
  if (v && typeof v === 'object') return <ObjBlock obj={v as Record<string, unknown>} />
  return <div className="text-xs text-[#cbd5e1]">{prettyVal(v)}</div>
}

function ObjBlock({ obj }: { obj: Record<string, unknown> }) {
  const scalars = Object.fromEntries(Object.entries(obj).filter(([, v]) => isScalar(v)))
  const complex = Object.entries(obj).filter(([, v]) => !isScalar(v))
  return (
    <>
      {Object.keys(scalars).length > 0 && <Inset className="p-3"><KeyVals obj={scalars} /></Inset>}
      {complex.map(([k, v]) => (
        <div key={k} className="mt-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-2)]">{prettyKey(k)}</div>
          {renderValue(v)}
        </div>
      ))}
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">{title}</div>
      {children}
    </div>
  )
}

/* Nicely-styled special sections (kept from before) */
function RisksSection({ risks }: { risks: { risk: string; probability: string; impact: string; note?: string }[] }) {
  return (
    <Section title="Risks">
      {risks.map((r, i) => (
        <Inset key={i} className="mb-1.5 p-2.5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[var(--foreground)]">{r.risk}</span>
            <div className="flex shrink-0 gap-1">
              <Badge tone={PROB_TONE[r.probability] ?? 'neutral'}>P: {r.probability}</Badge>
              <Badge tone={PROB_TONE[r.impact] ?? 'neutral'}>I: {r.impact}</Badge>
            </div>
          </div>
          {r.note && <p className="text-[11px] leading-relaxed text-[var(--muted)]">{r.note}</p>}
        </Inset>
      ))}
    </Section>
  )
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`${icon} ${projectName} Analysis`} subtitle="Live operational and financial breakdown">
        {isLoading || !data ? (
          <LoadingRow label="Loading analysis…" />
        ) : (
          <div>
            {chart && (
              <Section title="Projection">
                <Inset className="p-3"><MiniChart labels={chart.labels} series={chart.series} breakEvenIndex={chart.breakEvenIndex} /></Inset>
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
