# ADR-034: Decision trace — a register of decisions with quotes, linked to actions and money

## Status: Accepted

## Context
Every figure in the Hub can be traced to a ledger row, but not to the decision behind it. The family wants
to press **Why?** on a figure and see what was agreed, who said it, in which meeting, and what followed
(docs/specs/decision-trace.md). The raw material exists: meeting transcripts (the recent ones),
minutes and key decisions, actions, and the project ledger (ADR-032). What is missing is a structured,
checkable register that joins them. The standing rules are strict: never invent attribution, no
generated claim without a citation, money links are confirmed by people, private meetings are never used.

## Decision
Accepted 2 Oct 2026. Phases 0-3 are built (register, extraction, link suggestions, admin review, trace API and Why? UI, issue #101). Phases 4-5 (report, Ask KimFam tool, WhatsApp hand-off) are separate (#102).

1. **Three new tables**, created on demand under a Postgres advisory lock like `ledger.ready()`:
   `decisions` (statement, rationale, verbatim quote and its character offset, speaker or NULL, amount,
   status, confidence, review state, source `transcript` or `minutes`) and `decision_links`
   (decision to action, ledger row, treasury payment, ... with relation and state `suggested`,
   `confirmed` or `rejected`). Uniqueness on (meeting, quote offset, statement) and on
   (decision, target, relation) makes every insert idempotent. `ready()` creates ONLY tables the app role
   owns (`decisions`, `decision_links`, `decision_private_meetings`). `meetings` and `actions` are owned by
   the `postgres` role, so `meetings.is_private` and the `actions(meeting_id)` index are attempted
   best-effort in their own transactions (check `information_schema` first, log and continue on failure,
   as `_ensure_meeting_cols` does). The override table `decision_private_meetings(meeting_id, set_by,
   set_at)` is authoritative: a meeting is private if the column OR the table says so, and every read
   works when the column does not exist (probed once, cached, missing = not private).
2. **Extraction is a model proposal followed by code that does not trust it** (`decision_trace.py`).
   The model call is an injected `model_fn(prompt) -> str`, so all tests run offline. `check()` keeps a
   decision only if its quote is found verbatim in the stored transcript (whitespace-normalised), the
   project is known, the statement is bounded and the amount and date parse. A speaker is recorded only
   when the transcript itself labels the turn containing the quote with a known member; otherwise NULL
   ("unattributed"). Meetings without a transcript fall back to their key-decision bullets
   (`source='minutes'`, no quote, no speaker, low confidence).
3. **Private meetings are skipped before the transcript is read**, and never shown or linked: every
   read (store, register route, link candidates, existing links) excludes them. An admin-only
   `POST /api/decision-register/meetings/{id}/private` sets or clears the override row; flagging also
   soft-deletes the meeting's decisions. Projects come from `PROJECT_NAMES` (now in `project_names.py`,
   shared with `main.py`); an empty list is a status `error`, never a silent drop. Minutes-only bullets
   are tagged to one project by conservative keywords and not stored if untaggable. A quote that occurs
   more than once in its chunk (or in the transcript when no chunk is given) gets speaker NULL; quote
   matching ignores whitespace and curly-vs-straight quotes; a carry-over sentence in the prompt is context
   only and never matched.
4. **AI proposes, people confirm.** `suggest_links` scores candidates (same-meeting actions with keyword
   overlap; ledger and treasury rows dated 0-45 days after the meeting with an amount equal or within 5
   percent, or keyword overlap; when several rows match one amount each suggestion is capped at 0.5) and stores them as `suggested` only. A rejected link is never suggested
   again. Admins confirm, reject or add a link by hand through `/api/decision-register/*`
   (admin JWT only; the internal key is accepted on the read-only list route and nowhere else; registered before the ledger routes and the SPA catch-all).
5. **Phase 0 audit** (`scripts/decision_audit.py`) prints a per-meeting coverage table (counts and
   fractions, no text) so the maintainer can see how many meetings can be attributed to a speaker.
6. Claude is the engine (the Hub's existing `_ask_claude` helper wired in by the caller that runs
   extraction on the server); Gemini only as fallback. This change does not call a model itself.

7. **Trace API and Why? panel (phase 3).** `GET /api/trace/{project_id}?target_type=&target_ref=` returns the chain
   for a target (`ledger_expense|sale|stock|loss`, `treasury_payment`, `open_item`, `action`): the linked decisions
   (confirmed links as confirmed, suggested ones flagged `suggested`, rejected hidden; never from a private meeting),
   each with statement, rationale, status, review state, speaker or null (shown as "unattributed"), meeting ref and
   date and the verbatim quote with up to 2 transcript lines of context either side, cut from the stored transcript
   at `quote_start` by the pure `quote_context()` (the transcript itself is never returned; no offset or an offset
   outside the text means no quote, nothing is guessed); the linked actions with owner, deadline, status and dated
   updates; and the outcome rows (ledger or treasury rows the decisions link to, with a total).
   `GET /api/trace/{project_id}/decisions` lists the register for members (non-rejected links, non-private meetings).
   Both need a login (any member); the internal key may read. Admins review through
   `POST /api/decision-register/decisions/{id}/review` with `{state: confirmed|corrected, statement?}`, which sets
   `review_state`, `reviewed_by`, `reviewed_at` (and the corrected statement) with a committed write; admin JWT only.
   All routes are registered before the ledger routes and the SPA catch-all. In `LedgerPage.tsx` a Why? button sits on
   Entries rows, Reconciliation open items and drill-down lines and opens a timeline panel (bottom sheet on a phone)
   with "unreviewed" and "suggested" badges and an admin confirm or correct control; a Decisions tab lists the
   register grouped by meeting.

## Consequences
- Every quote in the register is provably present in the stored transcript; a model that hallucinates
  loses the decision rather than corrupting the record.
- Meetings with unlabelled transcripts (older ones, or speaker ids that are not member names) yield
  unattributed quotes, never guessed ones. Diarised labels such as "Speaker 2" are not names and stay
  unattributed until a person maps them.
- Money links stay "suggested" until an admin confirms, so the trace never presents a guess as fact.
- Extraction is a batch the maintainer runs; nothing is scheduled yet. Re-running is safe.
- The register lives in the production database; this public repo holds only code and synthetic tests.
- Later phases read the same tables: the trace API and Why? panel, the cited report, and (phase 5) the
  WhatsApp agent asking "who decided this?" through the same API.
- Flagging a meeting private is reversible: unflagging restores the decisions that flag purged (deleted at or after it was set). The audit script honours the override table.
