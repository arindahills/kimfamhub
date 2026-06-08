import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'

const TABS = [
  { to: '/',          icon: '🏠', key: 'home'     },
  { to: '/updates',   icon: '📰', key: 'updates'  },
  { to: '/actions',   icon: '✅', key: 'actions'  },
  { to: '/finances',  icon: '💰', key: 'finances' },
  { to: '/members',   icon: '👨‍👩‍👧‍👦', key: 'members' },
  { to: '/projects',  icon: '🌾', key: 'projects' },
  { to: '/equity',    icon: '⚖️', key: 'equity'   },
  { to: '/loans',     icon: '🏦', key: 'loans'    },
  { to: '/meetings',  icon: '📋', key: 'meetings' },
  { to: '/docs',      icon: '📁', key: 'docs'     },
  { to: '/ask',       icon: '🤖', key: 'ask'      },
]

export default function Nav() {
  const { t } = useTranslation()
  const { user } = useAuth()

  const tabs = user?.role === 'admin'
    ? [...TABS, { to: '/admin', icon: '⚙️', key: 'admin' }]
    : TABS

  return (
    <>
      {/* Desktop sidebar */}
      <nav
        className="hidden md:flex flex-col h-full w-56 shrink-0 py-4 overflow-y-auto"
        style={{ background: 'var(--bg-nav)', borderRight: '1px solid var(--border)' }}
      >
        <div className="px-4 mb-6">
          <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>KimFam Hub</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{user?.name}</div>
        </div>
        {tabs.map(tab => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'font-medium'
                  : 'opacity-70 hover:opacity-100'
              }`
            }
            style={({ isActive }) => ({
              color: isActive ? 'var(--accent)' : 'var(--text-primary)',
              background: isActive ? 'rgba(59,130,246,0.1)' : 'transparent',
            })}
          >
            <span className="text-base">{tab.icon}</span>
            <span>{t(`nav.${tab.key}`)}</span>
          </NavLink>
        ))}
      </nav>

      {/* Mobile bottom tab bar */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 flex overflow-x-auto z-50"
        style={{
          background: 'var(--bg-nav)',
          borderTop: '1px solid var(--border)',
          scrollbarWidth: 'none',
        }}
      >
        {tabs.map(tab => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className="flex flex-col items-center justify-center min-w-[60px] py-2 text-xs gap-0.5 flex-1"
            style={({ isActive }) => ({
              color: isActive ? 'var(--accent)' : 'var(--text-muted)',
            })}
          >
            <span className="text-lg leading-none">{tab.icon}</span>
            <span className="leading-tight text-[10px]">{t(`nav.${tab.key}`)}</span>
          </NavLink>
        ))}
      </nav>
    </>
  )
}
