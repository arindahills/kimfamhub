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
  { to: '/',            icon: '🏠', key: 'home',        tour: 'nav-home'        },
  { to: '/updates',     icon: '📰', key: 'updates',     tour: 'nav-updates'     },
  { to: '/actions',     icon: '✅', key: 'actions',     tour: 'nav-actions'     },
  { to: '/finances',    icon: '💰', key: 'finances',    tour: 'nav-finances'    },
  { to: '/members',     icon: '👨‍👩‍👧‍👦', key: 'members',    tour: 'nav-members'    },
  { to: '/projects',    icon: '🌾', key: 'projects',    tour: 'nav-projects'    },
  { to: '/equity',      icon: '⚖️', key: 'equity',      tour: 'nav-equity'      },
  { to: '/loans',       icon: '🏦', key: 'loans',       tour: 'nav-loans'       },
  { to: '/meetings',    icon: '📋', key: 'meetings',    tour: 'nav-meetings'    },
  { to: '/docs',        icon: '📁', key: 'docs',        tour: 'nav-docs'        },
  { to: '/expenditure', icon: '💸', key: 'expenditure', tour: 'nav-expenditure' },
  { to: '/ask',         icon: '🤖', key: 'ask',         tour: 'nav-ask'         },
]

// 5 tabs pinned to the mobile bottom bar — chosen based on usage data
const BOTTOM_TABS = ['/', '/finances', '/updates', '/projects', '/ask']

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
            <span style={{ fontSize: 16, width: 22, textAlign: 'center' }}>{tab.icon}</span>
            <span>{t(`nav.${tab.key}`)}</span>
          </NavLink>
        ))}
      </nav>
    )
  }

  // Mobile: 5-icon bottom bar + hamburger → full drawer
  const bottomTabs = tabs.filter(tab => BOTTOM_TABS.includes(tab.to))

  return (
    <>
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

      {/* Full drawer — all tabs */}
      <nav
        style={{
          position: 'fixed',
          top: 0, left: 0, bottom: 0,
          width: 260,
          zIndex: 56,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-nav)',
          borderRight: '1px solid var(--border)',
          transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.22s ease',
          paddingTop: 16,
          paddingBottom: 80,
          overflowY: 'auto',
        }}
      >
        <div style={{ padding: '0 16px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/static/logo.png" alt="KimFam" style={{ width: 36, height: 36, borderRadius: 9, objectFit: 'cover', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>KimFam Hub</div>
              <div style={{ fontSize: 11, marginTop: 2, color: 'var(--text-muted)' }}>{user?.name}</div>
            </div>
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 20, padding: 4 }}
          >✕</button>
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

      {/* Bottom tab bar — 5 pinned tabs + hamburger */}
      <nav
        style={{
          position: 'fixed',
          bottom: 0, left: 0, right: 0,
          height: 'calc(60px + env(safe-area-inset-bottom))',
          paddingBottom: 'env(safe-area-inset-bottom)',
          zIndex: 50,
          display: 'flex',
          alignItems: 'stretch',
          background: 'var(--bg-nav)',
          borderTop: '1px solid var(--border)',
        }}
      >
        {bottomTabs.map(tab => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            style={({ isActive }) => ({
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              textDecoration: 'none',
              color: isActive ? 'var(--accent)' : 'var(--muted)',
            })}
          >
            <span className={tab.key === 'ask' ? 'attention-ask' : undefined} style={{ fontSize: 22, lineHeight: 1 }}>{tab.icon}</span>
            <span style={{ fontSize: 10, fontWeight: 500 }}>{t(`nav.${tab.key}`)}</span>
          </NavLink>
        ))}
        {/* Hamburger — opens full drawer */}
        <button
          onClick={() => setDrawerOpen(true)}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--muted)',
          }}
        >
          <span style={{ fontSize: 22, lineHeight: 1 }}>☰</span>
          <span style={{ fontSize: 10, fontWeight: 500 }}>More</span>
        </button>
      </nav>
    </>
  )
}
