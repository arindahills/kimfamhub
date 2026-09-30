# ADR-032: A native project ledger replaces Solomon's AppSheet

## Status: Proposed (2026-10-01)

## Context
The chicken project is recorded in Solomon's AppSheet (a Google Sheet with an app on top), read
by the Hub through the Sheets API (`_fetch_chicken_data`). Hillary: "I can't stand two systems
recording partial things"; the monthly payments were already moved into the Hub and the AppSheet is
to be retired entirely. What the audit of 30 Sep 2026 (action KIM/17/26-11) found in the AppSheet:
141 expense rows all entered by one person, no "who paid", no receipts (the picture columns are
empty); a 1,975,000 refund to Dad recorded by the club on 29 Sep with no matching expense; a
100-bird batch reported on WhatsApp but never entered; and a cash picture (about 19.8M out, 17.3M
known in) that nobody can explain from the records. The Hub only shows summary totals.

The module is small (4 products, 141 expenses, 73 sales, 41 stock entries, 10 loss entries, 5 users;
all 73 sales are cash, there are no credit sales, and the loan, savings and supplier tabs are empty
template leftovers; the KimFam tabs are already in the Hub).

## Decision
1. **One native ledger for every project**, in Postgres, scoped by `project_id` (chicken first,
   dairy and others later, the same move as ADR-029): `ledger_products`, `ledger_stock` (purchases,
   and egg production), `ledger_sales`, `ledger_losses` (deaths, spoilage, own use),
   `ledger_expenses` (opex/capex). Every row carries `created_by`, `created_at`, `source` (app,
   whatsapp, appsheet_import), a unique `source_ref` (replay-safe), and soft-delete columns.
2. **What the AppSheet never had:** every expense and stock purchase records **who paid**
   (`paid_by`: Solomon's float, Dad, the club, or another member) and a **receipt photo** (R2).
   Sales record who sold and received the cash. Amounts are integers in UGX.
3. **Reimbursements link to the expenses they settle.** A club payment to a person (for example
   the 29 Sep refund to Dad) points at the ledger expenses it reimburses; a refund with no linked
   expenses, or expenses paid by a person and not yet reimbursed, are the reconciliation's open items.
4. **Reconciliation view, visible to ALL members** (Hillary's decision): money in (capital, sales),
   money out by funder, reimbursed versus outstanding, unmatched club payments, and the gap; each open
   item can be marked explained with a dated, attributed note (history from ADR-028-era work).
5. **The numbers the family already sees must not change.** The P&L (sales, spoilt goods, opex, capex,
   depreciation = capex / 10, gross and net positions, stock at cost, expected sales) is computed in
   the Hub with the AppSheet's own formulas, and the historical import must reproduce the AppSheet's
   Financial Statement **to the shilling** before anything is switched.
6. **Cut-over in phases, each verified:** (a) schema and one-time idempotent import with the parity
   check; (b) the chicken card reads the ledger (AppSheet read path behind a switch, side-by-side on
   staging); (c) native entry: forms in the Hub and WhatsApp entry for Dad and Solomon (they do not
   use the Hub today), then a short parallel run; (d) the AppSheet is frozen (users removed, sheet kept
   as an archive) and `_fetch_chicken_data` removed. Hillary owns the sheet and decides the freeze date.

## Consequences
- Better: one system; Dad's spending becomes visible when it happens; every refund is backed by
  lines and receipts; the audit can actually be done.
- Worse: a one-time migration of money data (risk: a wrong import); Solomon must change how he
  records (mitigated by WhatsApp entry); a period where both exist.
- Watch: egg production is currently entered as weekly "stock purchases" at cost 0 (keep as a
  distinct `production` kind, not a purchase); depreciation and P&L definitions must stay identical;
  Ask KimFam's chicken tool must be re-pointed at the ledger.
