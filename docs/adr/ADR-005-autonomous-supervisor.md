# ADR-005: Autonomous Supervisor Loop on Hetzner

## Status: Accepted

## Context

KimFam Hub needed automated daily follow-ups (overdue action items, loan reminders, contribution reminders) that do not require a human to manually run reports or send WhatsApp messages. The WhatsApp bridge and Claude CLI are already live on Hetzner. A lightweight cron-driven supervisor avoids adding another service dependency (no separate worker queue, no extra API key).

## Decision

Build `/opt/kimfam-supervisor/run.py` on Hetzner. Four cron modes:
- `daily` (07:00 EAT): reads `/api/actions` and `/api/loans`, calls `claude haiku` for a concise brief, sends overdue action reminders to members and a digest to Hillary.
- `monthly` (1st of month 08:00 EAT): reads `/api/contributions/ledger`, sends contribution reminder to the prod WhatsApp group naming families with outstanding balances.
- `post_meeting` (Sunday 19:00 EAT): checks if a meeting happened today via `/api/meetings`, sends the post-meeting pipeline checklist to Hillary.
- `digest` (06:30 EAT): reads ALL project hot files from `/opt/my-brain/wiki/`, calls `claude haiku` for a cross-project morning brief, sends to Hillary.

Primary AI: `claude -p --model haiku` subprocess (Max subscription, no API key). Fallback: Gemini, then Groq.

The supervisor is intentionally stateless: it reads live API state each run and does not maintain its own database.

## Consequences

Better: Overdue items and outstanding balances surface automatically without Hillary opening the app. Cross-project morning brief replaces manual hot-file review. Hot-file compaction problem is partially mitigated because the supervisor re-synthesises state from live data each run.

Watch: Claude CLI availability on Hetzner (4-min timeout observed in the WhatsApp agent context). If haiku is unavailable, the fallback generates a plain-text summary from raw API data. Cron logs at `/var/log/kimfam_supervisor.log`.
