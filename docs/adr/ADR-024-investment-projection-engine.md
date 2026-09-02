# ADR-024: Investment Viability Projection Engine

## Status: Accepted

## Context
The project board showed investment ventures (e.g. Fortune Credit) as static text: a
free-text "Monthly Return: 2% per month" row and one collapsed update line. Members could
not see what an investment would actually do to the club's money over time, what a member
who lends to the club would receive, or what the club stands to lose if the deal fails.
The real Fortune Credit model — verified against minutes KIM 012 and `project_updates`
12/16 — is a two-layer structure that the board never surfaced:

- **Outer**: Fortune Credit (Nairobi unit trust) pays ~2%/month, 3 or 6-month term,
  minimum UGX 29–34M. Still in due diligence; no funds committed.
- **Inner**: KimFam has ~20.4M in the bank, short of the minimum, so it raises capital by
  **borrowing from members at 1%/month simple interest on principal** (loan agreement
  approved KIM 012). KimFam is the **borrower** — the lender obligation survives an
  external default.

Pre-existing `pitch_engine.py` is deliberately forbidden from doing any math, so no
computation layer existed. Investment terms were free-text with no numeric fields.

## Decision
Add a pure, unit-tested projection engine `investment.py` and expose it read-only.

- `INVESTMENT_TERMS` — structured, computable terms per investment project (the free-text
  `{label,value}` rows in `main.py`'s projects list remain display-only; the structured map
  is the source of truth).
- `project_investment_matrix(project_id, start_date, own_capital, borrowed_capital,
  term_months, bank_now)` — month-by-month projection with real dates. Models the club as
  earning the external return in cash monthly on total capital, paying member-lender
  interest that **accrues** monthly and is settled with principal **at term end**.
  - Club net gain = `return% × own × T + (return% − lend%) × borrowed × T` (full return on
    own money, only the spread on borrowed money).
  - **Downside is mandatory** on a family-facing board: if the external investment returns
    nothing, the club loses its own capital AND still owes lenders
    `borrowed × (1 + lend% × T)`; the engine surfaces max loss and shortfall vs the bank.
- `member_lender_payout(...)` — what a single member who lends receives.
- `GET /api/projects/{project_id}/projection` — auth-gated (exposes club money), reads the
  live confirmed bank balance from `contributions.get_summary()`, returns matrix + lender
  examples + terms. Returns 404 for non-investment projects.
- Frontend `ViabilityModal.tsx` renders the matrix, a member-lender payout table, the
  mandatory downside block, and risk flags, with term/capital/own-money controls.

Simple (not compound) interest is used for both layers, matching the minutes ("monthly
interest received"); a compound comparison figure is shown alongside. Because Fortune
Credit is uncommitted and unverified, the UI labels every figure **illustrative, pending
verification** and never implies committed funds.

## Consequences
- **Better**: members see a dynamic, dated, real-figure view of an investment's effect on
  the club and on themselves, including the downside — the board becomes a decision tool.
- **Better**: investment terms are now computable, reusable by the Ask-KimFam AI (planned
  `tool_investment_projection`) and future investment ventures.
- **Worse / watch**: `INVESTMENT_TERMS` duplicates the display strings — the structured map
  wins and the two must be kept in sync by hand. FX (KES/UGX) and Kenyan withholding tax
  are surfaced as risk flags, not modelled numerically. The projection is illustrative and
  must never be read as a commitment; the "illustrative" labelling is load-bearing.
