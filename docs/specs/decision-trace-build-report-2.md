# Decision trace build report 2 (phase 3: trace API and Why? UI, issue #101)

Branch: feat/101-why-panel (from origin/main). No PR opened, nothing merged or deployed.

## What changed
- `decision_trace.py`: pure `quote_context()` (quote plus up to 2 transcript lines either side, cut at
  `quote_start`, lines capped at 400 characters, never the whole transcript, None when there is no offset or
  it is outside the text), `visible_links()`, `review_args()`, `review_decision()` (committed write through
  `execute_returning`), `trace()` and `register()` (read side, both exclude private meetings via `private_clause`
  and rejected links).
- `main.py`: `GET /api/trace/{project_id}` (target types: ledger_expense, ledger_sale, ledger_stock, ledger_loss,
  treasury_payment, open_item, action), `GET /api/trace/{project_id}/decisions` (any logged-in member; the
  internal key may read), admin-only `POST /api/decision-register/decisions/{id}/review`. All registered before
  the ledger routes and the SPA catch-all.
- `frontend/src/pages/LedgerPage.tsx`: Why? button on Entries rows, Reconciliation open items and drill-down
  lines (only lines that carry a row id); `WhyPanel` timeline (decision, speaker or "unattributed", quote with
  context and meeting ref and date, action and updates, outcome rows with total), badges (unreviewed, suggested,
  status), admin confirm or correct control, bottom sheet on a phone; new Decisions tab grouped by meeting.
- `tests/test_api.py`: new `TestTraceChain` (11 tests); `TestDecisionTrace` route-set test extended for the new
  admin route.
- ADR-034 (item 7, status line) and `docs/architecture.dsl` updated.

## Checks
- `python -m compileall -q .`: clean.
- `pytest tests/test_api.py`: 203 passed, 6 failed. The 6 are the Ask tests (chromadb not installed), as expected.
  TestTraceChain, TestDecisionTrace, TestCashHardening and TestWritesAreCommitted all pass. Collection needed a
  local Postgres (started in the sandbox) and a few pip packages; nothing was extracted into temp files.
- `npx tsc -b`: clean. `npx eslint src/pages/LedgerPage.tsx`: clean.
- Extra: a synthetic end-to-end run of `trace()`, `register()`, `review_decision()` and `set_private()` against a
  scratch Postgres (synthetic meeting, decision and links, then removed): suggested link flagged, rejected link
  hidden, quote context correct, private meeting hidden, review recorded.

## Notes and what is left
- Not exercised in a browser; the panel was type-checked and linted only.
- `projection_line` and `kpi` are valid link types in the register but are not accepted as trace targets (the
  issue lists seven target types).
- The trace shows the target row itself in the outcome list when the target is a ledger row, plus every row the
  linked decisions point at.
- Out of scope, as instructed: report and Ask KimFam tool (#102).
