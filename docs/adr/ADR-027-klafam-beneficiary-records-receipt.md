# ADR-027: KlaFam — the beneficiary can record a contribution they received

## Status: Accepted

## Context
KlaFam Tanda contributions could only ever be recorded by the contributing member
(`POST /api/klafam/contributions/pay` derives the member from the caller's own login). In
practice members pay the beneficiary in cash or mobile money and simply do not open the app —
so a real payment sat "Pending" indefinitely, and the cycle's collected total under-reported.

Concretely (Sep 2026 cycle, beneficiary The Arindas): Priscilla paid, but had not recorded it.
The person who actually held the money — the beneficiary — had no way to say so. Note the app
already trusts the beneficiary for the parallel judgement: only they may acknowledge receipt of
the whole payout (`POST /api/klafam/cycles/{id}/acknowledge`).

## Decision
Extend that existing trust model to per-member receipts.

- New `POST /api/klafam/contributions/record-for` — records a contribution **received from**
  another member. Authorised only for **this cycle's beneficiary** (the person who physically
  received the money) **or an admin**; anyone else gets 403. Validates amount (0 < x ≤ 10M) and
  an ISO `paid_date`, then recomputes the cycle's `total_collected` exactly as `/pay` does.
- **Attribution is mandatory.** A new `recorded_by` column on `klafam_contributions` stores who
  logged it, and the cycle detail returns it, so the UI shows "recorded by Hillary". A
  beneficiary-logged payment is never presented as though the member recorded it themselves.
  The column is added by idempotent runtime DDL (`_ensure_klafam_cols`) — the `klafam_*` tables
  are owned by the app role, so the ALTER succeeds; no manual server step, git-only.
- **UI is two-step.** On the current cycle, a pending member row shows *Mark received* for the
  beneficiary/admin; tapping it asks "Received UGX 300,000? Yes, record / No". Nothing is written
  on a single tap (same rule adopted for the sheep tracker after an accidental one-tap save).

Rejected: letting any member mark any other member paid (abusable, and no one else witnessed the
payment); and auto-confirming from WhatsApp text alone (no reliable proof of who paid what).

## Consequences
- **Better**: the person holding the money can close the loop, so cycle totals reflect reality
  instead of who happened to open the app. Priscilla's payment can be recorded by its recipient.
- **Better**: every third-party entry is attributable, so a disputed row can be traced to whoever
  logged it — the audit trail is stronger than a self-recorded payment, not weaker.
- **Watch**: the beneficiary can mark a payment they did not receive. That is deliberate — they
  are the counterparty with the least incentive to inflate someone else's credit — but the
  attribution and the member's own view are the check. If disputes ever arise, add a member-side
  "confirm/deny" on rows recorded by someone else.
