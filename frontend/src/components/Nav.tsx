import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
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
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  const tabs = user?.role === 'admin'
    ? [...TABS, { to: '/admin', icon: '⚙️', key: 'admin' }]
    : TABS

  // Close drawer on navigation
  useEffect(() => { setDrawerOpen(false) }, [location.pathname])

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

  // Mobile: hamburger button + slide-in drawer
  return (
    <>
      {/* Hamburger button — top left */}
      <button
        onClick={() => setDrawerOpen(o => !o)}
        style={{
          position: 'fixed',
          top: 10,
          left: 12,
          zIndex: 60,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 4,
          color: 'var(--text-primary)',
          fontSize: 22,
          lineHeight: 1,
        }}
        aria-label="Open menu"
      >
        {drawerOpen ? '✕' : '☰'}
      </button>

      {/* Backdrop */}
      {drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 55,
            background: 'rgba(0,0,0,0.55)',
          }}
        />
      )}

      {/* Drawer */}
      <nav
        style={{
          position: 'fixed',
          top: 0, left: 0, bottom: 0,
          width: 240,
          zIndex: 56,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-nav)',
          borderRight: '1px solid var(--border)',
          transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.22s ease',
          paddingTop: 56,
          paddingBottom: 16,
          overflowY: 'auto',
        }}
      >
        <div style={{ padding: '0 16px', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>KimFam Hub</div>
          <div style={{ fontSize: 11, marginTop: 2, color: 'var(--text-muted)' }}>{user?.name}</div>
        </div>
        {tabs.map(tab => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '12px 20px',
              fontSize: 15,
              textDecoration: 'none',
              color: isActive ? 'var(--accent)' : 'var(--text-primary)',
              background: isActive ? 'rgba(59,130,246,0.12)' : 'transparent',
              opacity: isActive ? 1 : 0.75,
            })}
          >
            <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>{tab.icon}</span>
            <span>{t(`nav.${tab.key}`)}</span>
          </NavLink>
        ))}
      </nav>
    </>
  )
}
