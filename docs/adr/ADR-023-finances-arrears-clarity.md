# ADR-023: Per-Month Arrears Clarity + Receipt Visibility + Contributions Auth

## Status: Accepted

## Context
The Finances module had three confirmed gaps (reported by Hillary, verified in code/data):
1. Attached receipts were invisible. Receipts are written to `contribution_payments.receipt_url`, but Payment History only read the legacy `receipt_photo_path` column (empty for all 130 rows). Five real receipts (incl. Hillary's April payment) were on disk and served fine, just never surfaced.
2. Arrears were shown as one lump ("UGX 260,000 owed") with no indication of which months or their deadlines.
3. The payment calculator showed only a bare count of "months ahead", not which months.
The monthly deadline is the 10th of the following month (a month's contribution is due the 10th of the next month), already enforced by the scheduler's day-5 reminder.

## Decision
1. **Per-month arrears derivation.** New `compute_family_arrears_detail(family_id)` reuses the exact window and net math of `compute_family_balance` (obligations 2023-01 through the last completed month; monthly pool = total confirmed paid minus initial paid, applied oldest-first, UNCLAMPED). It returns `paid_through`, `arrears_months[]` (each with `amount_owed`, `due_date` = 10th of the next month, and an `overdue` flag), `total_arrears` (always equal to the monthly portion of the balance), and `next_due`. Families paid in advance extend `paid_through`/`next_due` into the future. Surfaced on every `get_ledger` row.
2. **Receipt visibility.** `get_family_contributions` returns `receipt_url`; the UI reads `receipt_url || receipt_photo_path` and shows "No receipt on file" for confirmed payments with neither.
3. **Auth on contributions reads.** `get_family_contributions` now requires a valid `kimfam_token` (it returns receipt image URLs + full history). `get_ledger` gained an optional `request`: HTTP callers are authenticated, internal callers (scheduler, Ask KimFam) pass no request and stay trusted.
4. **Time zone.** Arrears "today"/overdue is computed in Africa/Kampala, not server-local, so the 10th-of-month boundary matches members.

## Consequences
- Better: members see exactly which months are owed, their deadlines, the next due date, and their receipts; balances/receipts are no longer world-readable.
- Watch: `get_ledger` now runs `compute_family_arrears_detail` per family (extra month loop + 2 queries/family) — fine at ~7 families; fold shared reads into one pass if the club grows. The `next_due`/`paid_through` future-extension calls `compute_monthly_obligation` per future month for prepaid families (bounded by the pool).
- Follow-up (not in this change): file each confirmed payment's receipt into Documents → Receipts, and a Hellen back-fill tool for old payments missing a receipt.
