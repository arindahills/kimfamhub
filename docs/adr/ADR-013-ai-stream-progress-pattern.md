# ADR-013: Reusable AI Streaming-Progress Pattern

## Status: Accepted (2026-06-18)

## Context
AI requests in KimFam Hub (Ask KimFam, proposal scoring, minutes extraction) take 30-90s.
A plain JSON `fetch` to such an endpoint is dropped by the browser/proxy at the ~60s idle
cutoff with "failed to fetch", even though the server finishes successfully a few seconds
later (the proposal record was saved while the user saw an error). Ask KimFam already
solved this by streaming, but each new AI feature was re-inventing the wire format and the
client loop, and most showed only a spinner with no sense of what was happening.

## Decision
Standardise one streaming-progress pattern and reuse it for every long AI request.

- **Wire format (SSE).** The endpoint returns `text/event-stream` with
  `Cache-Control: no-cache`, `X-Accel-Buffering: no`, `Connection: keep-alive`, and emits
  newline-delimited `data: {json}` events of three types:
  - `{"type":"step","msg":"..."}` — a human-readable stage ("Reading the proposal", "Loading
    the framework", "Scoring the 9 Key Areas", ...).
  - `{"type":"result", ...payload}` — the final payload (e.g. `{proposal: {...}}`).
  - `{"type":"error","msg":"..."}` — a failure with a user-facing message.
- **Server generator.** `_ai_score_stream(text, persist, kind)` runs the AI call as an
  asyncio task, emits a heartbeat `step` every ~6s while it runs (to beat the idle cutoff),
  then `persist(result)` and yields the `result` (or `error`). Any long AI endpoint can wrap
  its work the same way.
- **Client helper.** `frontend/src/lib/aiStream.ts` `streamAi(url, init, onStep)` reads the
  stream, calls `onStep(msg)` on each `step`, returns the `result`, throws on `error`. It also
  handles non-stream responses: if the content-type is not `text/event-stream` (e.g. a 409
  duplicate or 400), it parses JSON and throws `detail`. Pair it with a loading toast that
  updates on each step (`toast.update(tid, msg, 'loading')`).

This is now the default for AI requests, applied to proposal upload and rescore; Ask KimFam
remains the original reference implementation.

## Consequences
- **Better:** no more spurious "failed to fetch" on slow AI calls; users see live progress
  like Ask KimFam everywhere; one wire format and one client helper instead of bespoke code
  per feature; errors (including the duplicate-file 409) surface with a clear message.
- **Worse / watch:** SSE responses must not sit behind buffering proxies (the `X-Accel-Buffering`
  header and nginx config handle this); the client must read the whole stream (handled by
  `streamAi`); a result event is required or `streamAi` throws "ended without a result".
- **Reuse next:** wire minutes extraction and any future long AI endpoint through the same
  pair (`_ai_score_stream`-style generator + `streamAi`).
