# ADR-009: AI "Why Join" Pitch Engine

## Status: Accepted (2026-06-10)

## Context
The Projects screen shows a floating "why join" bubble on a project the member
has not yet joined. The first version used a static per-category sentence. The
ask was for figure-led, exciting copy ("huge potential", real numbers) that
reflects each project's CURRENT data and latest update, refreshed continuously,
and produced only by cheap models (never Sonnet+).

Generating on every request would be slow and would spend tokens per page view.

## Decision
Add `pitch_engine.py`: a background "always cooking" service.

- For each project it builds a brief from the live `get_all_projects()` data
  (headline, status, the `data[]` figures, and the latest update text) and asks
  a model for a punchy, truthful, figure-led one-liner (<=240 chars, no dashes).
- Model chain, cheap only: **DeepSeek (`deepseek-chat`) -> Claude Haiku (CLI)
  -> Gemini 2.0 Flash -> static category fallback.** Sonnet and above are never
  used here.
- Results are cached to `data/project_pitches.json` (path is `__file__`-relative
  so staging and prod stay isolated). A daemon thread cooks on boot and re-cooks
  every 6 hours; a non-blocking `fcntl` file lock ensures only one gunicorn
  worker cooks.
- Read via `GET /api/projects/pitches` (auth-gated, returns `{project_id: pitch}`);
  force a re-cook with `POST /api/projects/pitches/refresh` (auth or internal key).
- Frontend `JoinBubble` reads the map and falls back to the static category line
  until a pitch is cooked.

DeepSeek key: reused the WhatsApp agent's key (`/opt/whatsapp-agent/.env`),
copied into each app `.env`. Staging done; **prod `.env` still needs it** (else
prod silently falls back to Haiku/Gemini, which also work).

## Consequences
- Better: enticing, data-aware copy; near-zero per-view cost (served from cache);
  resilient (4-step fallback); cheap models only.
- Worse / watch:
  - **Truthfulness drift.** The "exciting" framing led DeepSeek to invent figures
    on data-thin projects (e.g. mango "250% growth", kakoba "18% returns"). The
    prompt says stay truthful, but thin data invites embellishment. For a family
    investment context this needs watching; tighten the prompt to forbid any
    number not present in the brief if it becomes a problem.
  - Cache is per-environment on local disk (not shared); fine for a single host.
  - First cook after a cold deploy takes ~30-60s; the bubble shows the static
    line until then.
