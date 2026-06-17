// Reusable consumer for streamed AI requests (SSE over fetch POST).
// Any long AI endpoint that emits `data: {type:"step"|"result"|"error", ...}` lines
// can be driven through this so the UI shows live progress (like Ask KimFam) and the
// browser never "fails to fetch" on a slow request. Pair with toast.loading + update.
export async function streamAi(
  url: string,
  init: RequestInit,
  onStep?: (msg: string) => void,
): Promise<any> {
  const res = await fetch(url, { credentials: 'include', ...init })
  const ct = res.headers.get('content-type') || ''
  // Errors (e.g. 409 duplicate, 400) and any non-stream response come back as JSON.
  if (!res.body || !ct.includes('text/event-stream')) {
    const d = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(d.detail || 'Request failed')
    return d
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let result: any = null
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      let ev: any
      try { ev = JSON.parse(line.slice(6)) } catch { continue }
      if (ev.type === 'step') onStep?.(ev.msg)
      else if (ev.type === 'result') result = ev
      else if (ev.type === 'error') throw new Error(ev.msg || 'Something went wrong')
    }
  }
  if (!result) throw new Error('The request ended without a result. Please try again.')
  return result
}
