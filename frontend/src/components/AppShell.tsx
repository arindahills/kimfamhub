import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import Nav from './Nav'
import LanguageSwitcher from './LanguageSwitcher'

export default function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const { user, logout } = useAuth()

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      {/* Sidebar (desktop only) */}
      <Nav />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header
          className="flex items-center justify-between px-4 py-2 shrink-0"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-nav)' }}
        >
          {/* Mobile: show app name */}
          <span className="md:hidden font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
            KimFam Hub
          </span>
          {/* Desktop: show member name (already in sidebar) */}
          <span className="hidden md:block text-sm" style={{ color: 'var(--text-muted)' }}>
            {user?.family} family
          </span>

          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <button
              onClick={logout}
              className="text-xs px-2 py-1 rounded"
              style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
            >
              {t('auth.logout')}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto pb-20 md:pb-4 px-4 py-4">
          {children}
        </main>
      </div>
    </div>
  )
}
