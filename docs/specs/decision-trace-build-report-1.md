# Decision trace build report 1 (issue #100, phases 0-2)

Verdict: DONE. Phases 0, 1 and 2 are built and tested on branch `feat/100-decision-register`. No front-end, trace API or report (issues #101, #102).

## What changed
- `decision_trace.py`: `ready()` (decisions, decision_links, decision_private_meetings under advisory lock; `meetings.is_private` and the `actions(meeting_id)` index are best-effort only, the override table is authoritative), `chunk_transcript`, `pack_chunks`, `build_prompt`, `parse_amount`, `check`, `minutes_decisions`, `extract_meeting(meeting_id, model_fn, store=None)`, `score_links`, `suggest_links`, `set_link_state`, `add_link`. The model is an injected `model_fn`.
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
- `meetings.is_private` did not exist in the repo; `ready()` tries to add it best-effort (the table is owned by postgres, so it may fail and only log). The authoritative flag is the `decision_private_meetings` override table, set through the admin route `POST /api/decision-register/meetings/{id}/private`. Nothing is private until flagged.
- Diarised labels like "Speaker 2" are not member names, so those quotes stay unattributed.
- Projects come from `PROJECT_NAMES` (`project_names.py`), not a table.
- `treasury_payment` candidates use `expenditure_records.project = project_id`; unverified column match.
- Nothing wires `_ask_claude` to `extract_meeting` yet; the maintainer's server run passes `model_fn=lambda p: main._ask_claude(p, model="sonnet", timeout=300)`.

## Left
Phase 3-5 (trace API/UI, report, WhatsApp hand-off); a runner script/endpoint for extraction and suggest_links; admin review of decisions (review_state).

## Review fixes
All twelve findings from the independent review, each with the test that proves it (class `TestDecisionTrace`).
1. FIXED ready() on prod: DDL only for owned tables; best-effort column/index; override table; reads work without the column. `test_ready_ddl_touches_only_owned_tables`, `test_best_effort_failure_never_breaks_ready_and_private_works_without_column`.
2. FIXED projects from `PROJECT_NAMES`; empty list gives status `error`. `test_dbstore_projects_come_from_project_names`, `test_empty_project_list_is_an_error_not_a_silent_drop`.
3. FIXED minutes bullets tagged by keyword or not stored. `test_minutes_bullets_tagged_or_not_stored`, `test_minutes_fallback_end_to_end_stores_tagged_only`.
4. FIXED internal key on the list route only. `test_register_routes_are_admin_only_and_before_catch_all`.
5. FIXED quote attribution: chunk offsets, NULL when ambiguous. `test_duplicate_quote_two_speakers_gets_no_speaker`, `test_quote_attributed_inside_its_chunk_first`.
6. FIXED private meetings hidden, unlinked, purged; admin route. `test_private_flag_hides_and_purges`, `test_every_dbstore_read_excludes_private_meetings`, `test_private_route_exists_and_purges`.
7. FIXED ready() called by the default store paths, status `unavailable` (suggest_links now returns `{status, added}`). `test_extract_and_suggest_with_default_store_need_ready`.
8. FIXED round amounts capped at 0.5 with a note. `test_round_amount_with_many_rows_is_capped`.
9. FIXED typographic quotes normalised on both sides. `test_curly_quotes_match_straight_ones`.
10. FIXED oversized unlabelled turn split at sentences, carry-over sentence in the prompt, never matched. `test_unlabelled_blob_split_at_sentences_with_carry_over`.
11. FIXED the two weak tests rewritten (INSERT SQL text; per-route function-source checks). `test_suggest_links_stores_only_suggested_and_never_confirms`, `test_register_routes_are_admin_only_and_before_catch_all`.
12. FIXED ADR-034 status line is exactly `## Status: Accepted`; ADR text matches the fixes.

Checks: `python -m compileall -q .` clean. Full `tests/test_api.py` run against a local Postgres: 135 passed, 6 failed. The 6 failures are the Ask tests (TestAskPromptFit x3, TestAskRagRetrieval x3) that need `chromadb`, missing in this sandbox. TestDecisionTrace, TestLedgerDrill, TestLedgerParity and TestProjectionModel all pass.
Not fixed / caveats: un-flagging a meeting does not restore purged decisions (re-extraction is blocked by the soft-deleted rows; a maintainer must clear them). `scripts/decision_audit.py` still reads only the column, so it shows `private: no` for override-table meetings.
