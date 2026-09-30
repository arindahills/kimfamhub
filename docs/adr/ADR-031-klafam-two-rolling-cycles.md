# ADR-031: KlaFam keeps two rolling cycles open; payments go to the cycle whose beneficiary received them

## Status: Accepted (2026-09-30)

## Context
On 30 Sep 2026 Alex paid his September share late. The money went to the September beneficiary
(Hillary), but the Hub's single "current cycle" had already rolled to October on the 28th, so the
WhatsApp confirm recorded it against October (Max's cycle). September then showed Alex as unpaid
and October showed a payment Max's cycle had not received from Alex. The ledger modelled
"one cycle per month", while real life has late payers who pay the previous beneficiary.

## Decision
- **Two rolling cycles.** A cycle is current from the 28th of the previous month (unchanged). The
  cycle before it stays open for late payments until the 14th of the current cycle's month, then
  closes and is no longer shown. On 30 Sep: October current, September still open until 14 Oct.
  `klafam_window.cycle_window(today)` is the single rule; `GET /api/klafam/overview` returns
  `previous_cycle` while it is open. The KlaFam page shows it as a second card whose "Mark
  received" and "Record my contribution" act on that cycle.
- **Payments go to the cycle whose beneficiary received the money** (agent ADR-019). The MoMo
  message names the recipient; when the cycle cannot be decided the agent asks instead of
  defaulting to "current".
- **Covered-by entries.** When a member advances another member's share, the row stays paid (the
  beneficiary did receive it) and its notes say who covered it and who owes whom. No new status.

## Consequences
- Better: a late payment lands in the right cycle and the beneficiary's total is right.
- Worse: two cards between the 28th and the 14th; a payer with a pending row in both cycles is a
  real ambiguity the agent must ask about.
- Watch: anything else that assumes a single "current cycle" (reminders, `member_stats`).
