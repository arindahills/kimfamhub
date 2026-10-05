# Decision trace, build report 3 (phase 4: the smart report), issue #102

Branch: `feat/102-smart-report` (from origin/main). Not merged, no PR, no tag, no deploy.

## What changed
- `report.py` (new). Pure part: `build_evidence_pack`, `render_pack`, `build_prompt`, `verify_report`, `pack_hash`,
  `generate`, `trace_answer_text`, `cite_for`, `ledger_items`. Storage part (lazy imports): `ready()` under advisory lock
  778815, `collect()`, `latest()`, `store()` (via `db.execute`, which commits), `public_view()`.
- Table `decision_reports` (project_id, pack_hash, body JSONB, stripped JSONB, created_by, created_at).
- `main.py`: `GET /api/trace/{project}/report` (any member; cached or `stale`, never generates) and
  `POST /api/trace/{project}/report` (admin JWT only; Claude via `_ask_claude`; 503 and nothing stored on model failure).
  Both sit before the ledger routes and the SPA catch-all.
- `decision_trace.py`: trace API accepts target `decision` so a `[D12]` chip opens that decision with its quote.
- `LedgerPage.tsx`: Report tab (sections, citation chips to the Why? panel or the Scorecard tab, generated time, stale
  badge, stripped count, admin-only expandable stripped list, Generate or Refresh, print stylesheet and Print button).
- `ask_agent.py`: `decision_trace` tool using the internal key, same pattern as the project tools; answers only from
  the register, says plainly when nothing is recorded.
- ADR-034 (section 8) and `docs/architecture.dsl` updated.
- House style: the whole of every changed file was swept for em and en dashes (main.py, ask_agent.py,
  decision_trace.py, tests/test_api.py had old ones, replaced by hyphens; text only).

## Checks
- `python -m compileall -q .`: clean.
- `tests/test_api.py` cannot be collected here (bcrypt and other optional dependencies, no database), so the classes
  were extracted into temp files (deleted afterwards): TestSmartReport (new, 12), TestDecisionTrace (45), TestTraceChain
  (12), TestTraceReviewFixes (4), TestCashHardening (7), TestWritesAreCommitted (2): 82 passed. The 6 Ask tests were not run
  (chromadb missing).
- Frontend: `npx tsc -b` clean, `npx eslint src/pages/LedgerPage.tsx` clean.
- New tests cover: uncited sentence stripped, unknown citation stripped, citation after the full stop, speaker never
  named unless set, private data absent from pack and prompt, rejected links dropped and suggested marked, stale hash
  detected, store commits via `execute` (no write through `query`), POST admin-only (no `internal_ok`), store only after
  generate, GET never generates, route order before the SPA catch-all, Ask tool answer and "nothing recorded".

## Not verified here (needs the real database and Claude CLI)
- `collect()`, the two routes end to end, the stored JSONB round trip, and the real model output format (the section
  parser accepts `##` and bold headings; anything unparsed is simply stripped). The UI was type-checked, not run.
- Reports that cite unlinked spend: only the 12 largest unlinked expense rows are put in the pack (prompt size).
- The speaker check is heuristic (attribution verbs and known speaker names); the prompt also forbids it.

## Left
- Phase 5 (WhatsApp agent hand-off), out of scope. A dedicated PDF export through document tooling was replaced by the
  browser print stylesheet, as specified (no new dependencies).
