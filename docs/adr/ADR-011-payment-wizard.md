# ADR-011: Submit Payment — 3-Step Allocation Wizard

## Status: Accepted

## Context

The KimFam contribution tracking system has two distinct obligation types per family:

1. **Monthly contributions** — ongoing UGX rate per family per month (varies by composition and rate table). Tracked as a running balance; negative = credit (paid ahead), positive = arrears.
2. **Initial obligation (Opening Balance)** — a one-off 2023 obligation recorded when the club started. Tracked separately from monthly.

A single payment can partially or fully cover either or both. The allocation logic is non-trivial and was originally built in the vanilla JS app (`old-index.html`, functions `payGoNext`, `_renderMonthPickerWithRemaining`, `_buildConfirmation`, `doSubmitPayment`, ~lines 1350–1825). The first React implementation (SubmitPaymentModal, pre ADR-011) was a flat single-step form that:

- Sent `family_name` (string) instead of `family_id` (int) — the API silently ignored it
- Sent `allocation_type: 'monthly'` — a field that does not exist in the backend
- Had no balance/coverage feedback
- Showed a hardcoded period dropdown instead of computing allocation
- The receipt was optional with no warning

This caused every payment submission to fail silently or submit with wrong data.

## Decision

Replace the flat modal with a faithful React port of the vanilla JS 3-step wizard. No new logic — this is a direct port of what was already working.

### API contract

**POST /api/contributions/submit**

```json
{
  "family_id":            123,
  "amount_ugx":          130000,
  "payment_reference":   "ABSA ref 9923",
  "declared_through":    "2026-06",
  "apply_to_initial_ugx": 0
}
```

- `family_id` — from `GET /api/contributions/ledger` (returns `family_id` + `family_name`)
- `declared_through` — YYYY-MM string, last month explicitly covered. Only used in Case 3. Backend auto-computes `period_month` from it.
- `apply_to_initial_ugx` — UGX amount of payment to credit against the opening balance. Case 2: from excess. Case 3: user-chosen split.
- Returns `{ payment_id, status: "pending" }`

**POST /api/contributions/{payment_id}/receipt** — multipart file upload for bank/MoMo screenshot.

**GET /api/contributions/family/{id}/preview** — returns:

```json
{
  "combined_balance":     130000,
  "initial_balance":      2220000,
  "current_balance":      130000,
  "current_monthly_rate": 65000,
  "suggested_period":     "2026-04"
}
```

`current_balance` = monthly arrears only.
`initial_balance` = opening obligation balance.
`combined_balance` = monthly + initial.
`suggested_period` = YYYY-MM of the oldest unpaid monthly month (FIFO starting point).

### Step 1 — Details

User selects family from ledger dropdown (populates from `/api/contributions/ledger`, using `family_id`). On family selection: fetch preview, show balance hint. On amount change: re-fetch preview, show coverage hint.

**Balance hint** (fetched from preview):
- Arrears: "Balance owed: UGX X" in red, broken down by monthly vs initial
- Credit: "Paid ahead — UGX X in credit" in green
- Clear: "All contributions up to date" in green

**Coverage hint** (computed from preview + entered amount):
- `amount < combined_balance` (partial): "Reduces balance from X to Y"
- `amount == combined_balance`: "Clears the full balance"
- `amount > combined_balance`: "Clears full balance + X paid in advance (N months)"
- `current_balance <= 0`: "Covers up to N months. Choose months on next step."

### Step 2 — Allocation (three cases)

**Case 1 — Partial arrears** (`current_balance > 0` AND `amount < current_balance`):
- No step 2. Go directly to step 3.
- Backend applies FIFO to oldest unpaid monthly months.
- `declared_through = null`, `apply_to_initial_ugx = 0`.

**Case 2 — Clears monthly arrears with excess** (`current_balance > 0` AND `amount >= current_balance`):
- Show excess allocation panel.
- Excess = `amount - current_balance`.
- User chooses how much of excess goes to `apply_to_initial_ugx` (capped at `min(excess, initial_balance)`).
- Remainder goes to future monthly credit automatically.
- `declared_through = null`.

**Case 3 — Monthly is current** (`current_balance <= 0`):
- Show month picker (toggle buttons) for affordable months from `suggested_period`.
- Affordable months = `floor((amount - initChoice + creditRemainder) / rate)` starting from `suggested_period`, skipping months already covered by existing credit.
- Optionally: user enters `initChoice` (UGX to apply to opening balance), reducing months available.
- `declared_through` = last selected month (YYYY-MM).
- `apply_to_initial_ugx = initChoice`.

### Step 3 — Review + Submit

Shows full payment summary breakdown before submission:
- Family, total amount, reference
- Case-specific allocation lines (arrears cleared, months covered, opening balance applied, extra credit)
- Receipt filename if attached
- ABSA account reminder

Submit sends to `/api/contributions/submit`. On success, upload receipt to `/api/contributions/{payment_id}/receipt`. Invalidate `contributions-summary` and `contributions-ledger` queries.

## Consequences

**Better:** Payments now submit with correct `family_id`. Allocation logic matches the vanilla app exactly. Members get live balance feedback before submitting. No silent failures.

**Watch for:**
- If the rate table changes mid-month, `suggested_period` and affordable month counts may shift. The backend handles this correctly via `compute_monthly_obligation()` — the frontend just displays what preview returns.
- `apply_to_initial_ugx` is stored on the payment record but the actual allocation to initial balance happens in `confirm_payment()` (treasurer side). The field is advisory — the treasurer's confirmation step applies it.
- Receipt upload is fire-and-forget (catch swallowed). If it fails, the payment is still recorded; Hellen can request the receipt separately.
