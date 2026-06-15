import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'

type ToastKind = 'success' | 'error' | 'info' | 'loading'
interface Toast { id: number; kind: ToastKind; message: string }

interface ToastApi {
  show: (message: string, kind?: ToastKind) => number
  success: (message: string) => number
  error: (message: string) => number
  info: (message: string) => number
  /** Persistent spinner toast (does not auto-dismiss). Returns its id. */
  loading: (message: string) => number
  /** Update an existing toast (e.g. resolve a loading toast to success/error). */
  update: (id: number, message: string, kind?: ToastKind) => void
  dismiss: (id: number) => void
  /** Wrap an async server task: shows a spinner, then success/error. Returns the promise. */
  promise: <T>(p: Promise<T>, msgs: { loading: string; success: string; error?: string }) => Promise<T>
}

const ToastCtx = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx)
  if (!ctx) {
    // Safe no-op fallback so a missing provider never crashes a component.
    const noop = () => 0
    return {
      show: noop, success: noop, error: noop, info: noop, loading: noop,
      update: () => {}, dismiss: () => {},
      promise: async (p) => p,
    }
  }
  return ctx
}

const STYLE: Record<ToastKind, { bg: string; border: string; color: string; icon: string }> = {
  success: { bg: '#0f3d22', border: '#166534', color: '#86efac', icon: '✓' },
  error:   { bg: '#3f1d1d', border: '#7f1d1d', color: '#fca5a5', icon: '✕' },
  info:    { bg: '#0d1829', border: '#1e3a5f', color: '#93c5fd', icon: 'ℹ' },
  loading: { bg: '#0d1829', border: '#1e3a5f', color: '#93c5fd', icon: '' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const idRef = useRef(0)
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})

  const dismiss = useCallback((id: number) => {
    setToasts(t => t.filter(x => x.id !== id))
    const tm = timers.current[id]
    if (tm) { clearTimeout(tm); delete timers.current[id] }
  }, [])

  const schedule = useCallback((id: number, kind: ToastKind) => {
    // loading toasts persist until explicitly updated/dismissed
    if (kind === 'loading') return
    const ttl = kind === 'error' ? 6000 : 3500
    timers.current[id] = setTimeout(() => dismiss(id), ttl)
  }, [dismiss])

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = ++idRef.current
    setToasts(t => [...t, { id, kind, message }])
    schedule(id, kind)
    return id
  }, [schedule])

  const update = useCallback((id: number, message: string, kind: ToastKind = 'info') => {
    setToasts(t => t.map(x => x.id === id ? { ...x, message, kind } : x))
    const tm = timers.current[id]
    if (tm) { clearTimeout(tm); delete timers.current[id] }
    schedule(id, kind)
  }, [schedule])

  const promise = useCallback(async <T,>(p: Promise<T>, msgs: { loading: string; success: string; error?: string }): Promise<T> => {
    const id = show(msgs.loading, 'loading')
    try {
      const r = await p
      update(id, msgs.success, 'success')
      return r
    } catch (e: unknown) {
      const detail = (e instanceof Error && e.message) ? e.message : (msgs.error || 'Something went wrong')
      update(id, msgs.error ? `${msgs.error}: ${detail}` : detail, 'error')
      throw e
    }
  }, [show, update])

  const api: ToastApi = {
    show,
    success: m => show(m, 'success'),
    error:   m => show(m, 'error'),
    info:    m => show(m, 'info'),
    loading: m => show(m, 'loading'),
    update, dismiss, promise,
  }

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 'min(92vw, 380px)' }}>
        {toasts.map(t => {
          const s = STYLE[t.kind]
          return (
            <div key={t.id} onClick={() => t.kind !== 'loading' && dismiss(t.id)}
              style={{
                background: s.bg, border: `1px solid ${s.border}`, color: s.color,
                borderRadius: 10, padding: '10px 12px', fontSize: 13, lineHeight: 1.4,
                display: 'flex', gap: 8, alignItems: 'flex-start',
                cursor: t.kind === 'loading' ? 'default' : 'pointer',
                boxShadow: '0 6px 20px rgba(0,0,0,0.4)', animation: 'kf-toast-in 0.18s ease-out',
              }}>
              {t.kind === 'loading'
                ? <span style={{ flexShrink: 0, width: 14, height: 14, marginTop: 1, border: '2px solid #1e3a5f', borderTopColor: '#93c5fd', borderRadius: '50%', display: 'inline-block', animation: 'kf-spin 0.7s linear infinite' }} />
                : <span style={{ flexShrink: 0, fontWeight: 700 }}>{s.icon}</span>}
              <span style={{ flex: 1 }}>{t.message}</span>
            </div>
          )
        })}
      </div>
      <style>{`@keyframes kf-toast-in{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:none}}@keyframes kf-spin{to{transform:rotate(360deg)}}`}</style>
    </ToastCtx.Provider>
  )
}
