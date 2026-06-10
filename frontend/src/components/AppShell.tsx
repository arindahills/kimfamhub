import { useState, useEffect, type ReactNode } from 'react'
import { Power } from 'lucide-react'
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

/** Round profile avatar with an initial fallback when no image exists. */
function Avatar({ name }: { name?: string }) {
  const [err, setErr] = useState(false)
  const safe = (name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const initial = (name || '?').charAt(0).toUpperCase()
  if (err || !safe) {
    return (
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
        style={{ background: '#1e3a5f', border: '2px solid var(--success)', color: '#4ade80' }}>
        {initial}
      </div>
    )
  }
  return (
    <img
      src={`/static/avatars/${safe}.jpg`}
      onError={() => setErr(true)}
      alt={name}
      className="h-7 w-7 shrink-0 rounded-full object-cover"
      style={{ border: '2px solid var(--success)' }}
    />
  )
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const isDesktop = useIsDesktop()

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--background)' }}>
      <Nav />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {/* Top bar — brand left, profile + controls right */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '8px 14px',
            flexShrink: 0,
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <img src="/static/logo.png" alt="KimFam"
              style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
            <div style={{ minWidth: 0, lineHeight: 1.15 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>KimFam Hub</div>
              <div style={{ fontSize: 10, color: 'var(--muted-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                KIM FAM Investment Club
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <LanguageSwitcher />
            {isDesktop && (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{user?.display}</span>
            )}
            <Avatar name={user?.name} />
            <button
              onClick={logout}
              title="Sign out"
              aria-label="Sign out"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 30, height: 30, borderRadius: 8,
                color: 'var(--muted)', border: '1px solid var(--border)',
                background: 'transparent', cursor: 'pointer',
              }}
            >
              <Power size={16} />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 16,
            paddingBottom: isDesktop ? 16 : 76,
          }}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
