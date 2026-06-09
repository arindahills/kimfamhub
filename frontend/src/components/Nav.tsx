import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'

function useIsDesktop() {
  const [desktop, setDesktop] = useState(() => window.innerWidth >= 640)
  useEffect(() => {
    const handler = () => setDesktop(window.innerWidth >= 640)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return desktop
}

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
  const isDesktop = useIsDesktop()

  const tabs = user?.role === 'admin'
    ? [...TABS, { to: '/admin', icon: '⚙️', key: 'admin' }]
    : TABS

  if (isDesktop) {
    return (
      <nav
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          width: 224,
          flexShrink: 0,
          paddingTop: 16,
          paddingBottom: 16,
          overflowY: 'auto',
          background: 'var(--bg-nav)',
          borderRight: '1px solid var(--border)',
        }}
      >
        <div style={{ padding: '0 16px', marginBottom: 24 }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>KimFam Hub</div>
          <div style={{ fontSize: 12, marginTop: 2, color: 'var(--text-muted)' }}>{user?.name}</div>
        </div>
        {tabs.map(tab => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 16px',
              fontSize: 14,
              textDecoration: 'none',
              color: isActive ? 'var(--accent)' : 'var(--text-primary)',
              background: isActive ? 'rgba(59,130,246,0.1)' : 'transparent',
              opacity: isActive ? 1 : 0.7,
              transition: 'opacity 0.15s',
            })}
          >
            <span style={{ fontSize: 16 }}>{tab.icon}</span>
            <span>{t(`nav.${tab.key}`)}</span>
          </NavLink>
        ))}
      </nav>
    )
  }

  // Mobile bottom tab bar
  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        display: 'flex',
        overflowX: 'auto',
        zIndex: 50,
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
          style={({ isActive }) => ({
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 60,
            padding: '8px 0',
            flex: 1,
            textDecoration: 'none',
            color: isActive ? 'var(--accent)' : 'var(--text-muted)',
          })}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>{tab.icon}</span>
          <span style={{ fontSize: 10, lineHeight: 1.2, marginTop: 2 }}>{t(`nav.${tab.key}`)}</span>
        </NavLink>
      ))}
    </nav>
  )
}
