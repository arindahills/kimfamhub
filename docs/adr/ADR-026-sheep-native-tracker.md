# ADR-026: Native Sheep Project Tracker (Postgres)

## Status: Accepted (Slice 1 — data model, seed, live analytics; Slice 2 — Solomon/admin entry)

## Context
The Sheep & Dorper RAM project needs the same "how is it doing" visibility the chicken
project has, but the chicken card is fed by a Google Sheet/AppSheet. Standing rule: never
build new tracking on Google Sheets — build native, in-app, Postgres-backed (Epic #16). The
existing `GET /api/projects/sheep/detail` returned a **hardcoded** dict (flock counts,
1.71M investment, valuation) that could not reflect new mortalities, vaccine spend, sales,
or capital as they happen. The club needs to track: sheep dying (mortality + cause),
vaccines/vet spend, capital in, money sent to buy animals — all live.

## Decision
A native tracker in `sheep.py`, three Postgres tables, data entered in-app (NOT Sheets).

- **Schema** (`sheep_animals`, `sheep_events`, `sheep_expenses`):
  - `sheep_events`: `opening | birth | death(+cause) | sale(+amount,counterparty) |
    purchase(+amount,counterparty)`, with a `count`. Flock alive = opening + births +
    purchases − deaths − sales. "Money sent to Mum for lambs" = a purchase event.
  - `sheep_expenses`: categorized (`sourcing | ear_tag | pasture | feed_silage | vet |
    transport | labour | other`). Vaccines = a `vet` expense.
  - `sheep_animals`: notable individuals (the Dorper ram), status alive/sold/dead.
- **Table creation**: idempotent `ensure_sheep_tables()` (CREATE TABLE IF NOT EXISTS) run
  by `ready()` once per process. The `kimfam` app role has CREATE on the public schema (it
  owns `project_updates`), so new tables are owned by kimfam — the ALTER-ownership gotcha
  that affects postgres-owned legacy tables does not apply. No manual server step; git-only.
- **Seed**: `seed_sheep_baseline()` inserts a **documented-facts-only** baseline (Dorper
  purchase UGX 1,710,000 / 2024-08-16 via Hellen→Priscilla; pasture ploughing 1,853,000 /
  2026-05-31; 1 sale 200,000; 3 lamb deaths cause unknown). It is **atomic and
  concurrency-safe**: all inserts in one transaction (mid-seed failure rolls back — no
  partial/duplicate seed), serialized by a transaction-scoped advisory lock, marker
  re-checked inside the transaction. Runs exactly once (marker: note `LIKE 'KIM015 seed%'`).
- **Live analytics**: pure `compute_flock`/`compute_financials` (unit-tested) drive
  `sheep_detail_data()`; `GET /api/projects/sheep/detail` now returns that live dict (flock,
  mortality by cause, expense breakdown, capital/sales/net, recent events & expenses),
  rendered by the existing generic DetailModal (sheep is already in ANALYSABLE).

## Consequences
- **Better**: the sheep Analysis card is now live from the DB (flock 13 alive, 17.6%
  mortality, capital 1.71M, expenses 1.85M, sales 200K, net −3.36M) instead of hardcoded;
  every future death/expense/sale updates it. Financial + action history in one place.
- **Better**: pure aggregators are unit-tested (`test_sheep.py`, 8 tests); no invented
  figures — seed is documented facts only.
- **Slice 2 (shipped): Solomon/admin entry.** Two Pydantic-validated, role-gated POST
  endpoints — `/api/projects/sheep/event` (birth/death+cause/sale/purchase) and
  `/api/projects/sheep/expense` (categorized; vaccines = `vet`). Gate `_sheep_writer`:
  `sub=="Solomon" or role=="admin"` → else 403; author recorded from the token. Pure
  `validate_event`/`validate_expense` (unit-tested) + ISO date check → 422 on bad input;
  parameterized inserts return `r[0]` (plain tuple cursor). Frontend `SheepTracker.tsx`
  (mobile forms) mounts on the sheep card for writers only and invalidates `['detail','sheep']`
  so the Analysis card refreshes. The frontend gate is cosmetic; the backend is the enforcement.
  **Two-stage entry (2026-09-04):** a single tap no longer commits — the button is *Review
  event/expense*, which shows a summary ("DEATH · 1 sheep · date · cause") and only *Confirm &
  save* writes. Added after an accidental single-tap saved a blank-cause death on prod. The
  recent-entries **delete** buttons are likewise tap-to-confirm ("delete? Yes/No") — no
  destructive action on the tracker commits on a single tap.
- **Slice 3 (shipped): live card panel (chicken parity).** Pure `compute_monthly(events)` →
  cumulative flock trend + births/deaths per event-month (unit-tested); `sheep_detail_data`
  returns it under `chart`. `SheepLivePanel.tsx` (under Show Details on the sheep card, like
  `ChickenLivePL`) renders KPI tiles + flock-trend line + births-vs-deaths bars + expense
  breakdown bars. Counts and money are kept in separate charts (MiniChart's y-axis is a money
  formatter).
- **Slice 4 (shipped): alerts + Ask-KimFam knowledge.** Pure `compute_alerts(events, today)`
  (unit-tested): a **mortality** warning when ≥2 deaths fall in the last 90 days (surfaces the
  KIM 015 unknown-cause lamb deaths automatically — "investigate & vaccinate"), and a seasonal
  **drought→silage** flag in the dry months (Jun–Sep, per KIM 015 contingency). Rendered as
  banners atop `SheepLivePanel`. The live `sheep/detail` endpoint is also reachable by the
  Ask-KimFam AI (project-analysis tool) so members can ask "how is the sheep project doing?"
  and get live flock/mortality/expense data — no separate embedding needed (live > stale index).
- The seed writes real financial history at first request; it is documented and idempotent,
  but is data, not schema — revisit if a project ever needs a clean unseeded start.
