# Decision trace build report 4: speaker map (issue #106)

Branch: feat/106-speaker-map (no PR opened, nothing merged, tagged or deployed).

## What changed
- `speaker_map.py` (new): pure `split_sources`, `turns_of`, `align`, `addressed_names`, `suggest`; storage (`meeting_speakers`,
  `speaker_map_log`, advisory lock), `store_suggestions`, `confirm_label`, `speakers_view`, `confirmed_map`, `attribute`,
  `label_for_offset`, two backfill functions. `scripts/speaker_backfill.py` is the CLI (labels, suggestions, all).
- `decision_trace.py`: `check()` stores `speaker_label` for every quoted unique turn that carries a label (a member name is no
  longer needed); `decisions.speaker_label` added in its own transaction in `ready()`; `trace()` and `register()` return
  `speaker_label`, `speaker` (confirmed member or null), `attribution` (confirmed, shared, unattributed), `shared`.
- `report.py`: the pack uses the resolved confirmed member only; a shared voice is worded "shared device voice, no person named";
  `verify_report` is unchanged.
- `main.py`: GET `/api/meetings/{id}/speakers` (members), PUT `/api/meetings/{id}/speakers/{label}` (admin or attendee, JWT only),
  POST `/api/meetings/{id}/speakers/suggest` (admin), all before the SPA catch-all; private meetings excluded.
- `LedgerPage.tsx`: Review speakers panel per meeting in the Decisions tab (samples, Tactiq agreement, addressed names, attendee
  picker, Confirm, Shared device, Unknown, "suggestion, not a fact" wording); Why? and the list say "Speaker 3 (not yet identified)",
  "<name> (confirmed)" or "(shared device, cannot tell who)" from API data.
- Docs: ADR-034 amendment, `docs/architecture.dsl` (Speaker Map component and relations).

## Design notes
- The old `decisions.speaker` column is still written by `check()` (existing tests rely on it) but is no longer displayed: only a
  confirmed map row resolves a member. Existing name-labelled turns therefore show the raw label until someone confirms.
- Who may confirm is decided from the JWT (admin, or the login name on the meeting's attendance list). The login is never evidence of
  who spoke; with a shared login, anyone using it who is on the list may confirm, which is the intended human check.
- `store_suggestions` never overwrites a row that has a confirmer, and never writes `confirmed`.

## Checks
- `python -m compileall -q .`: pass.
- New `TestSpeakerMap` (18 tests): pass.
- TestDecisionTrace, TestTraceChain, TestTraceReviewFixes, TestSmartReport, TestReportVerifierHardening, TestCashHardening,
  TestCashRoutes, TestWritesAreCommitted: pass (110 passed with the new class) on a local Postgres 16.
- Integration run against that database (suggest, confirm, change with history, refuse a non-attendee, backfill twice, trace and
  register attribution, shared): behaved as specified. Not part of the test suite (needs a database).
- `npx tsc -b`: clean. `npx eslint src/pages/LedgerPage.tsx`: clean.
- Not run: tests/test_frontend.py (playwright not installed) and the Ask tests (chromadb missing).

## Left
- Run `python3 scripts/speaker_backfill.py all` on the server after merge, then have people confirm labels.
- Audio clips per voice are not offered because audio is not stored; follow-up.
- Existing decisions only get a label when `quote_start` still lands on a labelled turn in the stored transcript.
