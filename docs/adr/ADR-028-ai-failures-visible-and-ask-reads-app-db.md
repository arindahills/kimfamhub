# ADR-028: AI failures are visible, fallbacks are live, Ask KimFam reads the app's records

## Status: Accepted (2026-09-25)

## Context

- `_ask_claude` / `_ask_claude_async` discarded the CLI's stderr and returned `""` on any
  failure. On 2026-09-11 a token rotation left the workers holding a revoked token: AI
  suggest, document summaries and Ask KimFam went blank for two days with nothing logged,
  and the "AI suggest" buttons swallowed the empty result (`catch {/* ignore */}`).
- Every fallback behind Claude was dead: 15 call sites used `gemini-2.0-flash` and
  `llama-3.3-70b-versatile`, both of which now return 404 (verified live 2026-09-25). A
  Claude failure therefore had no backup at all.
- Ask KimFam's live context read the Google Sheet "2026 Meeting Register" and "Action
  Tracker", which stopped being maintained once meetings and actions moved into the app. In
  September it still said the latest meeting was KIM 008 (June); the app had KIM 016.

## Decision

- Every Claude CLI failure is logged (`uvicorn.error`) with the CLI's own message and
  recorded in `_AI_HEALTH`; a 401/revoked/expired error carries the hint to restart
  kimfamhub after a token rotation. `GET /api/ai/health` (admin) shows the last success and
  failure. A zero exit with empty output counts as a failure.
- The agenda suggestion returns `error: "AI unavailable (<reason>). ..."` when it has
  nothing, and both "AI suggest" buttons show it instead of doing nothing.
- Fallback models: `gemini-2.5-flash` and Groq `openai/gpt-oss-120b` (both verified).
- `_get_live_context` reads `meetings` (all, held vs UPCOMING, with the latest held named
  explicitly) and `actions` (open, in progress, carried over, plus the last 20 done) from
  Postgres. The Sheet is no longer consulted for either.

## Consequences

- Better: an AI outage is visible to the family (a message) and to the admin (log and
  health endpoint) the first time it happens; Ask KimFam answers from the records the family
  actually maintains.
- Worse: the live context is about 21k characters (all meetings with decisions and
  summaries); watch prompt size as meetings accumulate and trim to the last N if needed.
- Watch: model ids retire without warning. The same 404 pattern hit the WhatsApp agent
  (2026-09-08); check both when a provider announces deprecations.
