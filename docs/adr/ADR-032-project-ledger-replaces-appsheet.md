# ADR-032: A native project ledger replaces Solomon's AppSheet

## Status: Accepted (2026-10-01). Built and rehearsed on staging; prod cut-over on Hillary's date. Amended after independent review the same day.

## Context
The chicken project is recorded in Solomon's AppSheet (a Google Sheet with an app on top), read
by the Hub through the Sheets API (`_fetch_chicken_data`, plus a second reader behind `/api/projects`).
Hillary: "I can't stand two systems recording partial things"; the monthly payments were already moved
into the Hub and the AppSheet is to be retired entirely. What the audit of 30 Sep 2026 (action
KIM/17/26-11) found: 141 expense rows all entered by one person, no "who paid", no receipts (the
picture columns are empty, in 28 months); a 1,975,000 refund to Dad recorded by the club on 29 Sep with
no matching expense; one death in the new 100-bird batch reported on WhatsApp but not entered (the batch
itself IS entered: stock row 8 Jun 2026, expense 29 May 2026, 1,300,000); and a cash picture (about
19.8M out, 17.3M known in) nobody can explain from the records. The Hub only shows summary totals.

The module is small (4 products, 141 expenses, 73 sales, 41 stock rows, 10 loss rows, 5 users; all
sales are cash; loan, savings and supplier tabs are empty template leftovers).

## Decision
1. **One native ledger for every project**, in Postgres, scoped by `project_id` (same move as
   ADR-029): `ledger_products`, `ledger_stock`, `ledger_sales`, `ledger_losses`, `ledger_expenses`.
   Every row carries `created_by`, `created_at`, `source` (app, whatsapp, appsheet_import), a unique
   `source_ref`, soft-delete columns, and money as integer UGX. Imported rows keep the raw sheet row
   as JSON.
2. **A bird purchase is ONE entry that produces two effects**: an expense line (P&L) and a stock
   movement (flock). The AppSheet holds birds in two places that disagree: `company expenses` (opex,
   4,160,000, incl. 20 chickens / 260,000 on 8 Aug 2024 that are not in stock) and `stock details`
   (3,991,000, incl. 7 cocks / 91,000 on 11 Mar 2026 that are not in expenses). The import creates both
   effects from both tabs, keeps the P&L opex at the sheet's figure, and lists the 260,000 and 91,000
   differences as named open items for Solomon to confirm. Category breakdowns use the expense item
   mapping fixed in code, not keyword order (the Hub today counts "Transport for chicken" 29,000 and
   "Medicine for chicken" 73,000 as birds, 102,000 too high).
3. **Formulas, written down so parity is checkable** (these are the AppSheet's own):
   sales = sum of sales totals; spoilt = sum of loss totals AS ENTERED (not qty x cost); stock at cost
   = qty available x sell price for eggs and x cost price for every other product (the eggs are valued
   at sell price in the sheet: preserved for parity, then shown to the family as a known quirk and
   corrected only by a decision of Hillary); expected sales = qty available x sell price; opex and
   capex = sums of expense totals by Expense Type; depreciation = capex / 10 (the sheet's
   per-row depreciation column, 559,631, is ignored); gross = sales - spoilt - opex; net with capex =
   gross - capex; net with depreciation = gross - depreciation. `ledger_products` holds cost price,
   sell price, typed quantity available and a valuation rule. Parity must hold on the Financial
   Statement AND the per-product columns.
4. **Two accounts, never merged**: the club treasury (`expenditure_records`: capital tranches, Solomon's
   pay, refunds) and the farm cash box (the ledger: what was spent and sold on the farm). Capital
   tranches are read from `expenditure_records` (the hardcoded `family_account` list in
   `chicken_detail` is dropped). Solomon's pay is not in the AppSheet and stays out of the ledger.
5. **Who paid, honestly.** Imported rows get `paid_by = NULL` labelled "pre-ledger, unattributed" and are
   one opening item, not 141 unknowns. From the cut-over day every expense and stock purchase records
   `paid_by` (Solomon's float, Dad, the club, another member) and an optional receipt. A refund such as
   the 29 Sep 1,975,000 to Dad is explained by Hillary attributing Dad's rows, never auto-linked.
   Receipts are a reconciliation open item ("receipt missing"), not a precondition to recording.
   Via WhatsApp the payer must be stated in the message; it is not inferred from the sender, because
   the farm phone is shared (Dad, Solomon, Mum).
6. **Reconciliation view, visible to all members** (logged-in members only, never public): money in,
   out by funder, reimbursed versus outstanding, unmatched club payments, the gap, each open item
   markable as explained with a dated, attributed note. The existing un-authenticated finance endpoints
   (`/api/contributions/expenditure`, `/api/projects`) are not extended; the ledger and reconciliation
   endpoints require a login. Receipts go to private R2 (`receipts/`, presigned or authenticated URLs).
7. **Numbers the family sees must not change unexpectedly.** Outputs to preserve: sales 8,976,400;
   spoilt 781,600; stock at cost 2,100,000; expected sales 5,150,000; opex 14,217,600; capex
   5,596,000; depreciation 559,600; gross -6,022,800; net with capex -11,618,800; net with depreciation
   -6,582,400. Current outputs that are bugs and are dropped: the batch "pending" flag shown beside
   `new_batch_chicks: 100`, `chicks_capex = deaths_val`, and the audit's "no critical gaps" text.
8. **Import**: once, from a frozen snapshot (sheet exported with values unformatted, stored in R2
   `financial/` with its hash). Dates come from the sheet's serial numbers, never from the Hub's two
   existing string parsers (one assumes m/d/Y, one d/m/Y; the sheet mixes both). `source_ref =
   appsheet:<snapshot_hash>:<tab>:<row>`. Numbers parsed as integers.
9. **Consumers switched in one move** (not only `_fetch_chicken_data`): `/api/projects` (and
   `SOLOMON_ID`, `gc()`), `chicken_detail`, `_build_audit_data`, `ask_agent.py` chicken tools,
   `nightly_digest.py`, portfolio ranking, the `ChickenLivePL` card (keyed on the sheet's literal
   labels, so the ledger endpoint emits the same keys), the "live AppSheet" narrative strings,
   `"headline":"60% production rate"`, the duplicate `/api/projects/chicken/refresh` routes, and
   `docs/architecture.dsl` lines for the AppSheet.
10. **Phases, no parallel run** (two live systems is exactly what Hillary rejected):
    0. this ADR amended; 1. schema, ledger endpoints and consumer switches on staging, dry-run import
    from a snapshot taken today, parity on everything in 3 and 7, then discarded; 2. native entry
    (Hub forms; WhatsApp through the internal key as ADR-030) tested on staging; 3. cut-over day, on
    Hillary's date: freeze the sheet (remove editors), snapshot to R2, import, parity, flip reads, native
    entry live the same day; 4. after one month-close, remove the sheet readers; the snapshot stays as
    archive and rollback source (restore = re-add editors and revert the flag; rows entered natively
    since cut-over are re-keyed, not lost).

## Consequences
- Better: one system; Dad's spending visible when it happens; every refund backed by lines and
  receipts; the audit becomes possible; two Hub bugs fixed on the way.
- Worse: a one-time migration of money data (mitigated by parity on every figure before the switch);
  Solomon must change how he records (WhatsApp entry); nothing is live in the new system until the
  cut-over day.
- Watch: egg production is entered as weekly stock rows at cost 0 (keep as a `production` kind);
  Solomon never attached a photo in 28 months, so receipts will lag; Dad and Solomon do nothing until
  cut-over day, so a short walkthrough must precede it.

## Implementation notes (1 Oct 2026)
- Receipts are stored privately on disk outside the web root and served by an authenticated route
  (`/api/ledger/receipt/{kind}/{id}`), the same pattern as expenditure receipts, not in R2. Not public.
- A bird purchase carries a link between its expense and its flock movement (`source_ref` and
  `source_ref:stock`); deleting the expense removes both.
- The import is refused unless parity holds, and refused a second time from a different snapshot
  (the row references carry the snapshot hash, so a second import would duplicate every row).
- The ledger endpoints answer "goes live on cut-over day" until the import has run, so prod shows no
  empty ledger beforehand. Cut-over: `scripts/ledger_cutover.sh` (snapshot, parity, import, flip,
  verify); rollback: `scripts/ledger_rollback.sh` (reads back on the sheet, ledger rows kept).
- Payer options are the farm cash, the club, any member, or "Unknown (check)"; WhatsApp requires the
  payer to be stated (agent ADR-020).
- Verified on staging: 34 API checks, 10 WhatsApp scenarios with real Claude, a mobile browser walk
  through every tab, the cut-over script rehearsed end to end, rollback and the second-import guard.
