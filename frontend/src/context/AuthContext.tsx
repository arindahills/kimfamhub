import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

interface AuthUser {
  name: string
  display: string
  role: 'admin' | 'member'
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  avatarVersion: number
  bumpAvatar: () => void
  login: (member: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [avatarVersion, setAvatarVersion] = useState(1)
  const bumpAvatar = () => setAvatarVersion(v => v + 1)

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.name) setUser({ name: data.name, display: data.display, role: data.role })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const login = async (member: string, password: string) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: member, password }),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error(err.detail || 'Login failed')
    }
    const data = await r.json()
    setUser({ name: data.name, display: data.display, role: data.role })
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, avatarVersion, bumpAvatar, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
