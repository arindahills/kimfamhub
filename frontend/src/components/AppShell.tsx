import { useState, useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import Nav from './Nav'
import LanguageSwitcher from './LanguageSwitcher'

function useIsDesktop() {
  const [desktop, setDesktop] = useState(() => window.innerWidth >= 640)
  useEffect(() => {
    const handler = () => setDesktop(window.innerWidth >= 640)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return desktop
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const isDesktop = useIsDesktop()

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg-primary)' }}>
      <Nav />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {/* Top bar */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px',
            flexShrink: 0,
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-nav)',
          }}
        >
          {isDesktop ? (
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{user?.family} family</span>
          ) : (
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>KimFam Hub</span>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <LanguageSwitcher />
            <button
              onClick={logout}
              style={{
                fontSize: 12,
                padding: '4px 8px',
                borderRadius: 4,
                color: 'var(--text-muted)',
                border: '1px solid var(--border)',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              {t('auth.logout')}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 16,
            paddingBottom: isDesktop ? 16 : 80,
          }}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
