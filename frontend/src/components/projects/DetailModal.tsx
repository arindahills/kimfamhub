import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Inset } from '@/components/ui/card'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { LoadingRow } from '@/components/ui/spinner'
import { ugx } from '@/lib/utils'

/** Projects with a /detail analysis endpoint. */
export const ANALYSABLE = new Set(['chicken', 'trees', 'sheep', 'washing_bay', 'irrigation', 'dairy', 'bees'])

interface DetailData {
  overview?: Record<string, unknown>
  revenue?: Record<string, unknown>
  capex?: { initial?: number; sanitation_pending?: number; total_with_sanitation?: number; breakdown?: { item: string; amount: number; note?: string }[] }
  financial_metrics?: Record<string, unknown>
  risks?: { risk: string; probability: string; impact: string; note?: string }[]
  open_issues?: { issue: string; priority: string; amount?: number }[]
  [k: string]: unknown
}

const PROB_TONE: Record<string, BadgeProps['tone']> = { High: 'danger', Medium: 'warning', Low: 'success' }

function prettyKey(k: string) {
  return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
function prettyVal(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return v >= 100000 ? ugx(v) : v.toLocaleString()
  return String(v)
}

function KeyVals({ obj }: { obj: Record<string, unknown> }) {
  return (
    <div className="space-y-1.5">
      {Object.entries(obj).map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 text-xs">
          <span className="text-[var(--muted-2)]">{prettyKey(k)}</span>
          <span className="text-right text-[#cbd5e1]">{prettyVal(v)}</span>
        </div>
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">{title}</div>
      {children}
    </div>
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`${icon} ${projectName} Analysis`} subtitle="Live operational and financial breakdown">
        {isLoading || !data ? (
          <LoadingRow label="Loading analysis…" />
        ) : (
          <div>
            {data.overview && <Section title="Overview"><Inset className="p-3"><KeyVals obj={data.overview} /></Inset></Section>}
            {data.revenue && <Section title="Revenue"><Inset className="p-3"><KeyVals obj={data.revenue} /></Inset></Section>}
            {data.financial_metrics && <Section title="Financial Metrics"><Inset className="p-3"><KeyVals obj={data.financial_metrics} /></Inset></Section>}

            {data.capex && (
              <Section title="Capital Expenditure">
                <Inset className="p-3">
                  {data.capex.initial != null && (
                    <div className="mb-2 flex justify-between text-xs">
                      <span className="text-[var(--muted-2)]">Initial</span>
                      <span className="font-semibold text-[var(--foreground)]">{ugx(data.capex.initial)}</span>
                    </div>
                  )}
                  {(data.capex.breakdown ?? []).map((b, i) => (
                    <div key={i} className="flex justify-between gap-3 border-t border-[var(--border-soft)] py-1.5 text-xs">
                      <span className="text-[var(--muted)]">{b.item}{b.note ? <span className="text-[var(--muted-2)]"> · {b.note}</span> : null}</span>
                      <span className="shrink-0 text-[#cbd5e1]">{b.amount ? ugx(b.amount) : '—'}</span>
                    </div>
                  ))}
                </Inset>
              </Section>
            )}

            {data.risks && data.risks.length > 0 && (
              <Section title="Risks">
                {data.risks.map((r, i) => (
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
            )}

            {data.open_issues && data.open_issues.length > 0 && (
              <Section title="Open Issues">
                {data.open_issues.map((o, i) => (
                  <Inset key={i} className="mb-1.5 flex items-center justify-between gap-2 p-2.5">
                    <span className="text-xs text-[#cbd5e1]">{o.issue}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      {o.amount ? <span className="text-[11px] text-[var(--muted)]">{ugx(o.amount)}</span> : null}
                      <Badge tone={PROB_TONE[o.priority] ?? 'neutral'}>{o.priority}</Badge>
                    </div>
                  </Inset>
                ))}
              </Section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
