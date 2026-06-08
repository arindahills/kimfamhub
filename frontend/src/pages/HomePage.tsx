import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

interface Summary {
  confirmed_bank_balance?: number
}

interface ActivityItem {
  id: number
  project_id: string
  project_name: string
  text: string
  author: string
  created_at: string
  media?: string[]
}

const PROJECT_COLORS: Record<string, string> = {
  chicken: '#f59e0b',
  washing_bay: '#06b6d4',
  sheep: '#a78bfa',
  goats: '#34d399',
  banana: '#f97316',
  bees: '#fbbf24',
  trees: '#22c55e',
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function fmt(n: number) {
  return 'UGX ' + Math.abs(n).toLocaleString()
}

function ActivityCard({ item }: { item: ActivityItem }) {
  const col = PROJECT_COLORS[item.project_id] || '#94a3b8'
  return (
    <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--bg-card)' }}>
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ color: col, background: col + '22' }}
        >
          {item.project_name.toUpperCase()}
        </span>
        <span className="text-[11px]" style={{ color: '#475569' }}>{timeAgo(item.created_at)}</span>
      </div>
      {item.media && item.media.length > 0 && (
        <div className="flex gap-2 overflow-x-auto mb-2 pb-1">
          {item.media.filter(u => !u.match(/\.mp4$/i)).map((src, i) => (
            <img key={i} src={src} className="h-28 rounded-lg object-cover shrink-0" alt="" />
          ))}
        </div>
      )}
      <p className="text-sm leading-relaxed mb-2" style={{ color: '#e2e8f0' }}>{item.text}</p>
      <p className="text-[11px]" style={{ color: '#94a3b8' }}>— {item.author}</p>
    </div>
  )
}

export default function HomePage() {
  const { t } = useTranslation()

  const { data: summary } = useQuery<Summary>({
    queryKey: ['contributions-summary'],
    queryFn: () => fetch('/api/contributions/summary', { credentials: 'include' }).then(r => r.json()),
  })

  const { data: feed, isLoading: feedLoading } = useQuery<ActivityItem[]>({
    queryKey: ['activity'],
    queryFn: () => fetch('/api/activity', { credentials: 'include' }).then(r => r.json()),
  })

  const bal = summary?.confirmed_bank_balance ?? 0

  return (
    <div className="max-w-2xl md:max-w-5xl mx-auto">
      {/* Header */}
      <div className="text-center py-6">
        <div className="text-4xl mb-2">🌾</div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t('home.tagline')}
        </h1>
        <p className="text-xs mt-1" style={{ color: '#86efac' }}>{t('home.mission')}</p>
      </div>

      {/* Stats strip */}
      <div
        className="grid grid-cols-3 rounded-xl mb-4 overflow-hidden"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
      >
        <div className="p-3 text-center">
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {bal ? fmt(bal) : '—'}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Bank Balance</div>
        </div>
        <div className="p-3 text-center" style={{ borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>7</div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Family Groups</div>
        </div>
        <div className="p-3 text-center">
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>12</div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Active Projects</div>
        </div>
      </div>

      {/* About */}
      <div
        className="rounded-xl p-4 mb-4 text-sm leading-relaxed"
        style={{ background: 'var(--bg-card)', color: '#cbd5e1' }}
      >
        <p className="mb-3">
          Create a portfolio of investment choices that can transcend generations and contribute
          to the general economic welfare of all club members.
        </p>
        <ul className="space-y-1.5">
          {[
            ['📈', 'Invest in profitable and quickly marketable ventures'],
            ['🏦', 'Build a strong investment fund for lucrative opportunities'],
            ['🌍', 'Build a saving culture among all club members'],
            ['🎁', 'Share profits among members in proportion to contributions'],
          ].map(([icon, text]) => (
            <li key={text} className="flex items-start gap-2">
              <span>{icon}</span>
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Activity feed */}
      <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-muted)' }}>
        RECENT UPDATES
      </h2>
      {feedLoading && (
        <p className="text-xs py-4 text-center" style={{ color: 'var(--text-muted)' }}>
          {t('common.loading')}
        </p>
      )}
      {!feedLoading && (!feed || feed.length === 0) && (
        <p className="text-xs py-4 text-center" style={{ color: 'var(--text-muted)' }}>
          No recent activity.
        </p>
      )}
      {feed?.map(item => <ActivityCard key={item.id} item={item} />)}
    </div>
  )
}
