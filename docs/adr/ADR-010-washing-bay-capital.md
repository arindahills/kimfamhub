# ADR-010: Washing Bay Capital Accountability + SQLite Path Isolation

## Status: Accepted (2026-06-10)

## Context
The washing bay reports ~UGX 25,900,000 CapEx but with no proof of sources or
contributor split. Dad is reconciling who actually funded it. The family needs
an inline way to log contributions and watch the running total balance against
the reported estimate, and the gap should surface as a project risk.

Separately, the washing bay SQLite DB path (`_WB_DB`) was hardcoded to the prod
path, so the staging app wrote into the prod file. Staging review had injected
56 test income rows into prod.

## Decision
1. **Capital accountability module.** New `capital_contributions` table in
   `washing_bay.db` (contributor, amount, date, source, proof_ref, verified).
   Endpoints (PIN-gated writes, mirroring income):
   - `GET /api/washing-bay/capital` -> target, total accounted, verified subtotal,
     remaining, pct, per-contributor split, records.
   - `POST /api/washing-bay/capital` and `POST /api/washing-bay/capital/delete`.
   Target CapEx is `WB_CAPEX_TARGET = 25,900,000`. Frontend `WashingBayCapital`
   renders an inline panel (balancing progress bar, unaccounted amount, a risk
   callout when not balanced, per-contributor split, add/remove). Contributor is
   a dropdown (Dad and Alex first, then the rest of the family, then free text).
   The washing_bay `/detail` (Analysis) now computes accountability from the
   table and prepends a **"No capital accountability"** risk when accounted < CapEx.

2. **SQLite path isolation.** `_WB_DB` is now `__file__`-relative
   (`os.path.dirname(__file__)/data/washing_bay.db`). For prod that resolves to
   the same existing file; staging now uses its own `data/washing_bay.db`. This
   stops staging from writing into the prod DB. The 56 prod test income rows were
   backed up (`income_records_backup_*.sql`) and deleted.

## Consequences
- Better: capital sources become auditable and visible; the accountability gap is
  an explicit, quantified risk; staging can no longer pollute prod data.
- Watch: writes are PIN-gated only (same trust model as income); the CapEx target
  is hardcoded — change it if the estimate is revised. Prod still has the
  hardcoded `/var/www/kimfamhub/static` mount (separate pre-existing issue).
