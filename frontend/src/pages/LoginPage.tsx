import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'

const MEMBERS = [
  'Hillary','Hellen','Alex','Israel','Simon','Esther',
  'Janet','Lawi','Max','Priscilla','Solomon','Viola','Merab',
]

export default function LoginPage() {
  const { t } = useTranslation()
  const { login } = useAuth()
  const [member, setMember] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(member, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg-primary)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🌾</div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {t('auth.loginPrompt')}
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            {t('auth.loginSubtitle')}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-muted)' }}>
              {t('auth.member')}
            </label>
            <select
              value={member}
              onChange={e => setMember(e.target.value)}
              required
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
              style={{
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
              }}
            >
              <option value="">Select member...</option>
              {MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-muted)' }}>
              {t('auth.password')}
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
              style={{
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
              }}
            />
          </div>

          {error && (
            <p className="text-sm text-center" style={{ color: 'var(--accent-red)' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg py-2.5 text-sm font-medium transition-opacity disabled:opacity-60"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {busy ? t('common.loading') : t('auth.login')}
          </button>
        </form>
      </div>
    </div>
  )
}
