# ADR-034: Decision trace — a register of decisions with quotes, linked to actions and money

## Status: Accepted (2 Oct 2026). Phases 0-2 built (register, extraction, link suggestions, admin review). Phases 3-5 (trace API and UI, report, WhatsApp hand-off) are separate issues (#101, #102).

## Context
Every figure in the Hub can be traced to a ledger row, but not to the decision behind it. The family wants
to press **Why?** on a figure and see what was agreed, who said it, in which meeting, and what followed
(docs/specs/decision-trace.md). The raw material exists: meeting transcripts (the recent ones),
minutes and key decisions, actions, and the project ledger (ADR-032). What is missing is a structured,
checkable register that joins them. The standing rules are strict: never invent attribution, no
generated claim without a citation, money links are confirmed by people, private meetings are never used.

## Decision
1. **Two new tables**, created on demand under a Postgres advisory lock like `ledger.ready()`:
   `decisions` (statement, rationale, verbatim quote and its character offset, speaker or NULL, amount,
   status, confidence, review state, source `transcript` or `minutes`) and `decision_links`
   (decision to action, ledger row, treasury payment, ... with relation and state `suggested`,
   `confirmed` or `rejected`). Uniqueness on (meeting, quote offset, statement) and on
   (decision, target, relation) makes every insert idempotent. `meetings.is_private` is added (default
   false) and `actions.meeting_id` gets an index; nothing else on existing tables changes.
2. **Extraction is a model proposal followed by code that does not trust it** (`decision_trace.py`).
   The model call is an injected `model_fn(prompt) -> str`, so all tests run offline. `check()` keeps a
   decision only if its quote is found verbatim in the stored transcript (whitespace-normalised), the
   project is known, the statement is bounded and the amount and date parse. A speaker is recorded only
   when the transcript itself labels the turn containing the quote with a known member; otherwise NULL
   ("unattributed"). Meetings without a transcript fall back to their key-decision bullets
   (`source='minutes'`, no quote, no speaker, low confidence).
3. **Private meetings are skipped before the transcript is read.**
4. **AI proposes, people confirm.** `suggest_links` scores candidates (same-meeting actions with keyword
   overlap; ledger and treasury rows dated 0-45 days after the meeting with an amount equal or within 5
   percent, or keyword overlap) and stores them as `suggested` only. A rejected link is never suggested
   again. Admins confirm, reject or add a link by hand through `/api/decision-register/*`
   (admin or internal key only; registered before the ledger routes and the SPA catch-all).
5. **Phase 0 audit** (`scripts/decision_audit.py`) prints a per-meeting coverage table (counts and
   fractions, no text) so the maintainer can see how many meetings can be attributed to a speaker.
6. Claude is the engine (the Hub's existing `_ask_claude` helper wired in by the caller that runs
   extraction on the server); Gemini only as fallback. This change does not call a model itself.

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
