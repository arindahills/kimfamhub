import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'

type Mode = 'login' | 'forgot' | 'reset'

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  borderRadius: 16,
  padding: '28px 24px',
  border: '1px solid var(--border)',
}

const inp: React.CSSProperties = {
  width: '100%',
  background: '#0f172a',
  color: 'var(--text-primary)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
}

const btn = (primary = true): React.CSSProperties => ({
  width: '100%',
  padding: '11px',
  borderRadius: 8,
  border: 'none',
  background: primary ? 'var(--accent)' : 'transparent',
  color: primary ? '#fff' : 'var(--text-muted)',
  fontSize: 14,
  fontWeight: primary ? 600 : 400,
  cursor: 'pointer',
  marginTop: primary ? 4 : 0,
})

const label: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: 'var(--text-muted)',
  marginBottom: 6,
  marginTop: 14,
}

export default function LoginPage() {
  const { t } = useTranslation()
  const { login } = useAuth()
  const [mode, setMode] = useState<Mode>('login')

  // login state
  const [member, setMember] = useState('')
  const [password, setPassword] = useState('')

  // forgot/reset state
  const [fName, setFName] = useState('')
  const [otp, setOtp] = useState('')
  const [newPw, setNewPw] = useState('')

  const [showPw, setShowPw] = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  const reset = () => { setError(''); setInfo('') }

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault(); reset(); setBusy(true)
    try { await login(member, password) }
    catch (err) { setError(err instanceof Error ? err.message : 'Login failed') }
    finally { setBusy(false) }
  }

  const handleForgot = async (e: FormEvent) => {
    e.preventDefault(); reset(); setBusy(true)
    try {
      const r = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fName }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Failed')
      setInfo('Code sent to your WhatsApp. Enter it below.')
      setMode('reset')
    } catch (err) { setError(err instanceof Error ? err.message : 'Error') }
    finally { setBusy(false) }
  }

  const handleReset = async (e: FormEvent) => {
    e.preventDefault(); reset(); setBusy(true)
    try {
      const r = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fName, token: otp, new_password: newPw }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Failed')
      await login(fName, newPw)
    } catch (err) { setError(err instanceof Error ? err.message : 'Error') }
    finally { setBusy(false) }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-primary)',
      padding: 16,
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* Logo + heading */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img
            src="/static/icon-192.png"
            alt="KimFam Hub"
            style={{ width: 72, height: 72, borderRadius: 16, margin: '0 auto 14px', display: 'block' }}
          />
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>
            Welcome to KimFam Hub
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>KimFam Investment Club</p>
        </div>

        {/* ── LOGIN ── */}
        {mode === 'login' && (
          <div style={card}>
            <form onSubmit={handleLogin}>
              <label style={label}>{t('auth.member')}</label>
              <input type="text" value={member} onChange={e => setMember(e.target.value)}
                required autoComplete="username" style={inp} />

              <label style={label}>{t('auth.password')}</label>
              <div style={{ position: 'relative' }}>
                <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  required autoComplete="current-password" style={{ ...inp, paddingRight: 40 }} />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16 }}>
                  {showPw ? '🙈' : '👁️'}
                </button>
              </div>

              {error && <p style={{ fontSize: 12, color: 'var(--accent-red)', margin: '10px 0 0', textAlign: 'center' }}>{error}</p>}

              <button type="submit" disabled={busy} style={{ ...btn(), opacity: busy ? 0.6 : 1, marginTop: 18 }}>
                {busy ? 'Signing in...' : t('auth.login')}
              </button>
            </form>

            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <button onClick={() => { setMode('forgot'); reset() }}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 13, cursor: 'pointer' }}>
                Forgot password?
              </button>
            </div>
          </div>
        )}

        {/* ── FORGOT ── */}
        {mode === 'forgot' && (
          <div style={card}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              Enter your member name and we'll send a code to your WhatsApp.
            </p>
            <form onSubmit={handleForgot}>
              <label style={{ ...label, marginTop: 0 }}>{t('auth.member')}</label>
              <input type="text" value={fName} onChange={e => setFName(e.target.value)}
                required autoFocus style={inp} />

              {error && <p style={{ fontSize: 12, color: 'var(--accent-red)', margin: '10px 0 0', textAlign: 'center' }}>{error}</p>}

              <button type="submit" disabled={busy} style={{ ...btn(), opacity: busy ? 0.6 : 1, marginTop: 18 }}>
                {busy ? 'Sending...' : 'Send Code'}
              </button>
            </form>
            <button onClick={() => { setMode('login'); reset() }} style={btn(false)}>Back to login</button>
          </div>
        )}

        {/* ── RESET ── */}
        {mode === 'reset' && (
          <div style={card}>
            {info && <p style={{ fontSize: 12, color: 'var(--accent-green)', marginBottom: 14, textAlign: 'center' }}>{info}</p>}
            <form onSubmit={handleReset}>
              <label style={{ ...label, marginTop: 0 }}>WhatsApp Code</label>
              <input type="text" value={otp} onChange={e => setOtp(e.target.value)}
                required autoFocus inputMode="numeric" style={inp} />

              <label style={label}>New Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showNewPw ? 'text' : 'password'} value={newPw} onChange={e => setNewPw(e.target.value)}
                  required style={{ ...inp, paddingRight: 40 }} />
                <button type="button" onClick={() => setShowNewPw(v => !v)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16 }}>
                  {showNewPw ? '🙈' : '👁️'}
                </button>
              </div>

              {error && <p style={{ fontSize: 12, color: 'var(--accent-red)', margin: '10px 0 0', textAlign: 'center' }}>{error}</p>}

              <button type="submit" disabled={busy} style={{ ...btn(), opacity: busy ? 0.6 : 1, marginTop: 18 }}>
                {busy ? 'Setting password...' : 'Set New Password'}
              </button>
            </form>
            <button onClick={() => { setMode('forgot'); reset() }} style={btn(false)}>Resend code</button>
          </div>
        )}
      </div>
    </div>
  )
}
