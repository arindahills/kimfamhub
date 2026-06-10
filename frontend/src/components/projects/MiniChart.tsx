/**
 * Lightweight themed SVG chart — line / bar / horizontal-reference series over
 * shared labels, with an optional break-even marker. No external dependency, so
 * it stays cohesive with the design system instead of fighting a chart lib.
 */
export interface Series {
  name: string
  data: (number | null)[]
  kind: 'line' | 'bar' | 'ref'
  color: string
}

const W = 320
const H = 168
const PAD = { l: 30, r: 10, t: 12, b: 24 }

function compactUGX(v: number): string {
  const a = Math.abs(v)
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`
  if (a >= 1_000) return `${Math.round(v / 1_000)}K`
  return `${Math.round(v)}`
}

export function MiniChart({
  labels, series, breakEvenIndex,
}: {
  labels: string[]
  series: Series[]
  breakEvenIndex?: number
}) {
  const n = labels.length
  if (!n || !series.length) return null

  const nums = series.flatMap(s => s.data.filter((v): v is number => v != null))
  const max = Math.max(...nums, 0)
  const min = Math.min(...nums, 0)
  const span = max - min || 1

  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b
  const x = (i: number) => PAD.l + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = (v: number) => PAD.t + (1 - (v - min) / span) * plotH

  const barSeries = series.filter(s => s.kind === 'bar')
  const barW = barSeries.length ? Math.max(3, (plotW / n) * 0.5 / barSeries.length) : 0

  // y gridlines at 0, mid, max
  const gridVals = Array.from(new Set([min, min + span / 2, max]))

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 168 }}>
        {/* gridlines + left Y axis labels */}
        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={0.75} />
            <text x={PAD.l - 4} y={y(v) + 3} textAnchor="end" fontSize={8} fill="var(--muted-2)">{compactUGX(v)}</text>
          </g>
        ))}

        {/* break-even marker */}
        {breakEvenIndex != null && breakEvenIndex >= 0 && breakEvenIndex < n && (
          <g>
            <line x1={x(breakEvenIndex)} x2={x(breakEvenIndex)} y1={PAD.t} y2={H - PAD.b} stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" />
            <text x={x(breakEvenIndex)} y={PAD.t + 6} textAnchor="middle" fontSize={8} fill="#fbbf24">break-even</text>
          </g>
        )}

        {/* bars */}
        {barSeries.map((s, si) =>
          s.data.map((v, i) => v == null ? null : (
            <rect
              key={`${si}-${i}`}
              x={x(i) - (barSeries.length * barW) / 2 + si * barW}
              y={Math.min(y(v), y(0))}
              width={barW}
              height={Math.abs(y(v) - y(0))}
              rx={1.5}
              fill={s.color}
              opacity={0.85}
            />
          )),
        )}

        {/* lines + refs */}
        {series.filter(s => s.kind !== 'bar').map((s, si) => {
          if (s.kind === 'ref') {
            const v = s.data.find(d => d != null) as number | undefined
            if (v == null) return null
            return <line key={si} x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke={s.color} strokeWidth={1} strokeDasharray="4 3" opacity={0.8} />
          }
          const present = s.data.map((v, i) => ({ v, i })).filter(d => d.v != null) as { v: number; i: number }[]
          const pts = present.map(d => `${x(d.i).toFixed(1)},${y(d.v).toFixed(1)}`).join(' ')
          return (
            <g key={si}>
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
              {/* dots for sparse series (e.g. Actual) so they're visible */}
              {present.length <= 14 && present.map(d => (
                <circle key={d.i} cx={x(d.i)} cy={y(d.v)} r={2.2} fill={s.color} />
              ))}
            </g>
          )
        })}

        {/* sparse x labels (first, mid, last) */}
        {[0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i).map(i => (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={8} fill="var(--muted-2)">{labels[i]}</text>
        ))}
      </svg>

      {/* legend */}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {series.map((s, i) => (
          <span key={i} className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
            {s.kind === 'ref'
              ? <span className="inline-block h-0 w-3 border-t border-dashed" style={{ borderColor: s.color }} />
              : <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />}
            {s.name}
          </span>
        ))}
      </div>
    </div>
  )
}
