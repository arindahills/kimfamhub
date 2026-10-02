# ADR-035: Track who holds the farm's cash, with acknowledgement like a contribution

## Status: Accepted

## Context
Cash from chicken sales is not paid into the club account: it is held by a person (today Dad), while the Treasurer
cannot acknowledge money that is not in the account. The AppSheet had "cash banked" and "cash withdrawn" tabs (never
used). Club-account withdrawals are already recorded once, by the Treasurer, in her expense records, so the ledger
must not ask for them again. Monthly contributions follow submit, pending, Treasurer confirms.

## Decision
- Custody, not banking. A holder is Solomon's float, a member, or the club account.
- Every cash sale records who holds the cash (required in the Hub; for a message it is not inferred from the sender,
  because the farm phone is shared, and it is listed as unassigned). A credit payment records who received it.
- A handover or a banking is SUBMITTED (with a slip photo) and counts only when ACKNOWLEDGED. The submitter never
  acknowledges: the receiving person, the Treasurer for the club account, or an admin (an opening declaration needs an
  admin who did not submit it). A pending move has left the sender but has not arrived.
- An expense is paid from a holder's cash ("Held cash: <member>", or Solomon's float) or with someone's own money
  (reimbursable) or by the club. Only the first reduces a holder's balance.
- Per-holder balance = cash received + acknowledged moves in - moves out - spent from held cash. The reconciliation shows
  where the cash is, and lists: cash sales with no recorded holder (the AppSheet period), moves waiting, and holders who
  spent more than they hold.
- Nothing is entered twice: club-account withdrawals stay in the Treasurer's expense records (the ledger links to them);
  an acknowledged banking is shown on the ledger side and is not written to the contributions tables.

## Consequences
- Better: the cash Dad holds is visible and cannot silently disappear; the 1,975,000 refund can be compared with what he
  holds and spent from it.
- Worse: one more step for Dad and Solomon (say who holds the cash); an opening declaration is needed once for the
  AppSheet-period cash.
- Watch: the Treasurer name list (`Hellen`) and the custodian list in `ledger.py`; moves are not covered by the
  WhatsApp entry path yet (message-based sales stay "no recorded holder").
