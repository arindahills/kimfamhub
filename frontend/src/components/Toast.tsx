import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'

type ToastKind = 'success' | 'error' | 'info'
interface Toast { id: number; kind: ToastKind; message: string }

interface ToastApi {
  show: (message: string, kind?: ToastKind) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastCtx = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx)
  // Safe no-op fallback so a missing provider never crashes a component.
  if (!ctx) {
    const noop = () => {}
    return { show: noop, success: noop, error: noop, info: noop }
  }
  return ctx
}

const STYLE: Record<ToastKind, { bg: string; border: string; color: string; icon: string }> = {
  success: { bg: '#0f3d22', border: '#166534', color: '#86efac', icon: '✓' },
  error:   { bg: '#3f1d1d', border: '#7f1d1d', color: '#fca5a5', icon: '✕' },
  info:    { bg: '#0d1829', border: '#1e3a5f', color: '#93c5fd', icon: 'ℹ' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const idRef = useRef(0)

  const remove = useCallback((id: number) => {
    setToasts(t => t.filter(x => x.id !== id))
  }, [])

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = ++idRef.current
    setToasts(t => [...t, { id, kind, message }])
    const ttl = kind === 'error' ? 6000 : 3500
    setTimeout(() => remove(id), ttl)
  }, [remove])

  const api: ToastApi = {
    show,
    success: m => show(m, 'success'),
    error:   m => show(m, 'error'),
    info:    m => show(m, 'info'),
  }

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 'min(92vw, 380px)' }}>
        {toasts.map(t => {
          const s = STYLE[t.kind]
          return (
            <div key={t.id} onClick={() => remove(t.id)}
              style={{
                background: s.bg, border: `1px solid ${s.border}`, color: s.color,
                borderRadius: 10, padding: '10px 12px', fontSize: 13, lineHeight: 1.4,
                display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer',
                boxShadow: '0 6px 20px rgba(0,0,0,0.4)', animation: 'kf-toast-in 0.18s ease-out',
              }}>
              <span style={{ flexShrink: 0, fontWeight: 700 }}>{s.icon}</span>
              <span style={{ flex: 1 }}>{t.message}</span>
            </div>
          )
        })}
      </div>
      <style>{`@keyframes kf-toast-in{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:none}}`}</style>
    </ToastCtx.Provider>
  )
}
