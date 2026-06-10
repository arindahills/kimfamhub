import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

interface Summary {
  confirmed_bank_balance?: number
}

const INITIAL_FEED_COUNT = 4

interface ActivityItem {
  ts: string
  icon: string
  title: string
  nav: string
}

function timeAgo(iso: string): string {
  if (!iso) return ''
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
  return (
    <div className="rounded-xl p-3 mb-3 flex items-center gap-3" style={{ background: 'var(--bg-card)' }}>
      <span className="text-xl shrink-0">{item.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug" style={{ color: '#e2e8f0' }}>{item.title}</p>
      </div>
      <span className="text-[11px] shrink-0" style={{ color: '#475569' }}>{timeAgo(item.ts)}</span>
    </div>
  )
}

export default function HomePage() {
  const { t } = useTranslation()
  const [feedExpanded, setFeedExpanded] = useState(false)

  const { data: summary } = useQuery<Summary>({
    queryKey: ['contributions-summary'],
    queryFn: () => fetch('/api/contributions/summary', { credentials: 'include' }).then(r => r.json()),
  })

  const { data: feed, isLoading: feedLoading } = useQuery<ActivityItem[]>({
    queryKey: ['activity'],
    queryFn: () => fetch('/api/activity', { credentials: 'include' }).then(r => r.json()),
  })

  const bal = summary?.confirmed_bank_balance ?? 0

  const allItems = feed ?? []
  const visibleItems = feedExpanded ? allItems : allItems.slice(0, INITIAL_FEED_COUNT)
  const hasMore = allItems.length > INITIAL_FEED_COUNT

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="text-center py-6">
        <img src="/static/logo.png" alt="KimFam" className="mx-auto mb-2 h-14 w-14 rounded-xl object-cover" />
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
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{t('home.bankBalance')}</div>
        </div>
        <div className="p-3 text-center" style={{ borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>7</div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{t('home.familyGroups')}</div>
        </div>
        <div className="p-3 text-center">
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>12</div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{t('home.activeProjects')}</div>
        </div>
      </div>

      {/* About */}
      <div
        className="rounded-xl p-4 mb-4 text-sm leading-relaxed"
        style={{ background: 'var(--bg-card)', color: '#cbd5e1' }}
      >
        <p className="mb-3">{t('home.clubIntro')}</p>
        <ul className="space-y-1.5">
          {([
            ['📈', t('home.obj1')],
            ['🏦', t('home.obj2')],
            ['🌍', t('home.obj3')],
            ['🎁', t('home.obj4')],
          ] as [string, string][]).map(([icon, text]) => (
            <li key={icon} className="flex items-start gap-2">
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
      {!feedLoading && allItems.length === 0 && (
        <p className="text-xs py-4 text-center" style={{ color: 'var(--text-muted)' }}>
          No recent activity.
        </p>
      )}
      {visibleItems.map((item, i) => <ActivityCard key={i} item={item} />)}

      {hasMore && (
        <button
          onClick={() => setFeedExpanded(e => !e)}
          className="w-full rounded-xl py-2.5 mt-1 text-xs font-semibold transition-opacity"
          style={{ background: 'var(--bg-card)', color: 'var(--accent)', border: '1px solid var(--border)' }}
        >
          {feedExpanded
            ? 'Show less'
            : `Show ${allItems.length - INITIAL_FEED_COUNT} more`}
        </button>
      )}
    </div>
  )
}
