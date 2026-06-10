import { useState, useEffect, useRef, type ReactNode } from 'react'
import { Power } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import Nav from './Nav'
import LanguageSwitcher from './LanguageSwitcher'
import { Typewriter } from './Typewriter'
import { EditProfileModal } from './EditProfileModal'
import { WalkthroughOverlay } from './WalkthroughOverlay'

/** Brand name first (so the bar reads right on load), then the club's mission lines. */
const BRAND_LINES = [
  'KIM FAM Investment Club',
  'Growing family wealth together',
  'Save. Invest. Prosper.',
  '12 ventures, one family',
  'Building a lasting family legacy',
]

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
function Avatar({ name, version = 1 }: { name?: string; version?: number }) {
  const [err, setErr] = useState(false)
  const prevVersion = useRef(version)
  useEffect(() => {
    if (version !== prevVersion.current) { prevVersion.current = version; setErr(false) }
  }, [version])
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
      src={`/static/avatars/${safe}.jpg?v=${version}`}
      onError={() => setErr(true)}
      alt={name}
      className="h-7 w-7 shrink-0 rounded-full object-cover"
      style={{ border: '2px solid var(--success)' }}
    />
  )
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, logout, avatarVersion, bumpAvatar } = useAuth()
  const isDesktop = useIsDesktop()
  const [editOpen, setEditOpen] = useState(false)

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
            paddingTop: 'calc(8px + env(safe-area-inset-top))',
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
              <Typewriter
                phrases={BRAND_LINES}
                className="block"
                style={{ fontSize: 10, color: 'var(--muted-2)', whiteSpace: 'nowrap' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <LanguageSwitcher />
            {isDesktop && (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{user?.display}</span>
            )}
            <button onClick={() => setEditOpen(true)} title="Edit profile" aria-label="Edit profile" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
              <Avatar name={user?.name} version={avatarVersion} />
            </button>
            <EditProfileModal open={editOpen} onClose={() => setEditOpen(false)} userName={user?.name} onAvatarUploaded={bumpAvatar} />
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

        {/* Walkthrough tour — mounts once, self-manages via localStorage + custom events */}
        <WalkthroughOverlay />

        {/* Page content */}
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 16,
            paddingBottom: isDesktop ? 16 : 'calc(76px + env(safe-area-inset-bottom))',
          }}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
