# Decision trace build report 1 (issue #100, phases 0-2)

Verdict: DONE. Phases 0, 1 and 2 are built and tested on branch `feat/100-decision-register`. No front-end, trace API or report (issues #101, #102).

## What changed
- `decision_trace.py`: `ready()` (decisions + decision_links under advisory lock; adds `meetings.is_private`, index on `actions.meeting_id`), `chunk_transcript`, `pack_chunks`, `build_prompt`, `parse_amount`, `check`, `minutes_decisions`, `extract_meeting(meeting_id, model_fn, store=None)`, `score_links`, `suggest_links`, `set_link_state`, `add_link`. The model is an injected `model_fn`.
- `scripts/decision_audit.py`: Phase 0 coverage table (counts only, no text).
- `main.py`: admin-only `GET /api/decision-register/{project_id}`, `POST /api/decision-register/links` (add by hand, stored confirmed), `POST /api/decision-register/links/{id}/confirm|reject`. Placed before the ledger routes and the SPA catch-all.
- `tests/test_api.py`: new class `TestDecisionTrace` (28 tests, imports only the new module plus the audit script; fake store and fake model).
- `docs/adr/ADR-034-decision-trace.md`, `docs/architecture.dsl` component "Decision Trace".

## Hard rules, enforced in code and tested
Verbatim quote check; hallucinated and too-short quotes dropped; speaker only if the transcript labels the quote's turn with a known member (model claims ignored otherwise); private meetings skipped before the transcript is read and the model never called; suggestions stored only as `suggested`, rejected links never re-suggested; bad amounts/dates drop the decision.

## Checks
- PASS `pytest tests/test_api.py -k DecisionTrace`: 28 passed.
- PASS `python -m compileall -q .`: clean.
- PASS full `tests/test_api.py`: 115 passed, 6 failed. The 6 failures (TestAskPromptFit, TestAskRagRetrieval) are the same on the unmodified base: `chromadb` is not importable in this sandbox. They are not caused by this change.
- PASS manual run against a scratch local Postgres: tables and indexes create, extraction twice adds 1 then 0 rows, add/reject link work, unlabelled/unknown speaker stored as NULL.
- Not run: the HTTP routes against a live server (covered by a source-order/auth-call test only).

## Decisions to review
- `meetings.is_private` did not exist in the repo; `ready()` adds it (default false). Nothing sets it yet, so no meeting is currently private: the maintainer must flag private meetings before running extraction.
- Diarised labels like "Speaker 2" are not member names, so those quotes stay unattributed.
- Projects are read from a `projects` table in `DbStore.projects()` (falls back to empty list, which drops every transcript decision); confirm that table and its `id`/`name` columns exist, or pass `projects=` explicitly.
- `treasury_payment` candidates use `expenditure_records.project = project_id`; unverified column match.
- Nothing wires `_ask_claude` to `extract_meeting` yet; the maintainer's server run passes `model_fn=lambda p: main._ask_claude(p, model="sonnet", timeout=300)`.

## Left
Phase 3-5 (trace API/UI, report, WhatsApp hand-off); a runner script/endpoint for extraction and suggest_links; admin review of decisions (review_state).
