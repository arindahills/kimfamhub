import { useCallback, useRef, useState } from 'react'

export interface SseStep { msg: string; step: number; total: number }

/**
 * Consumes a Server-Sent-Events job stream (`data: {json}\n\n`) where the server
 * emits `{type:'step',step,total,msg}` progress events, a final
 * `{type:'result',data}`, or `{type:'error',msg}`. Works for GET and POST
 * (EventSource is GET-only, so we read the fetch body ourselves).
 */
export function useSseJob<T = unknown>() {
  const [steps, setSteps] = useState<SseStep[]>([])
  const [step, setStep] = useState(0)
  const [total, setTotal] = useState(0)
  const [result, setResult] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const ctrl = useRef<AbortController | null>(null)

  const reset = useCallback(() => {
    setSteps([]); setStep(0); setTotal(0); setResult(null); setError(null)
  }, [])

  const start = useCallback(async (url: string, init?: RequestInit) => {
    reset(); setRunning(true); setStartedAt(Date.now())
    ctrl.current?.abort()
    const ac = new AbortController()
    ctrl.current = ac
    try {
      const res = await fetch(url, { credentials: 'include', signal: ac.signal, ...init })
      if (!res.body) throw new Error('No response stream')
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let idx: number
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const dataLine = chunk.split('\n').find(l => l.startsWith('data:'))
          if (!dataLine) continue
          let obj: { type?: string; step?: number; total?: number; msg?: string; data?: T }
          try { obj = JSON.parse(dataLine.slice(5).trim()) } catch { continue }
          if (obj.type === 'step') {
            setStep(obj.step || 0)
            setTotal(obj.total || 0)
            setSteps(s => [...s, { msg: obj.msg || '', step: obj.step || 0, total: obj.total || 0 }])
          } else if (obj.type === 'result') {
            setResult((obj.data ?? null) as T | null)
          } else if (obj.type === 'error') {
            setError(obj.msg || 'Something went wrong')
          }
        }
      }
    } catch (e) {
      const err = e as Error
      if (err.name !== 'AbortError') setError(err.message || 'Stream failed')
    } finally {
      setRunning(false)
    }
  }, [reset])

  const stop = useCallback(() => { ctrl.current?.abort() }, [])

  return { start, stop, reset, steps, step, total, result, error, running, startedAt }
}
