"""
investment.py — KimFam Hub investment viability projection engine.

Pure, dependency-light financial projection for investment-category projects
(e.g. Fortune Credit). No DB writes, no network, no I/O — fully unit-testable.

MODEL (verified against KIM 012 loan agreement + project_updates 12/16, 2026-07):
  - An external investment (Fortune Credit) pays a monthly return (2%/mo) in CASH,
    with principal returned at term end. Simple interest — the minutes say
    "monthly interest received", i.e. paid out, not compounded.
  - KimFam funds the capital partly from its OWN money and partly by BORROWING from
    members at a member-lend rate (1%/mo SIMPLE, principal only). Member interest
    ACCRUES monthly and is paid, together with principal, at term end.
  - KimFam is the BORROWER under the loan agreement: the lender obligation SURVIVES
    an external default. This is why the downside block below is mandatory.

CLUB ECONOMICS (the "spread"):
  - Earn:  monthly_return_pct on (own + borrowed) capital, in cash, every month.
  - Pay:   member_lend_rate_pct on borrowed capital, accrued, at term end.
  - Net gain at term end = return*own*T + (return - lend)*borrowed*T
      i.e. the FULL return on the club's own money, only the SPREAD on borrowed money.

DOWNSIDE (external returns nothing):
  - Club loses its own capital AND still owes lenders principal + accrued interest.
  - Max loss = own + borrowed*(1 + lend*T), payable from club funds.

All amounts are UGX (integers). Percentages are per-month whole numbers (2.0 == 2%/mo).

NOTE ON SOURCE OF TRUTH: INVESTMENT_TERMS below is the structured, computable source
of truth. The free-text {label, value} rows in main.py's projects list are DISPLAY-ONLY
and must be kept consistent with this map by hand.
"""

import calendar
from datetime import date


# ── Structured investment terms (computable). STRUCTURED MAP WINS. ────────────
INVESTMENT_TERMS = {
    "fortune_credit": {
        "name": "Fortune Credit",
        "monthly_return_pct": 2.0,        # external pays 2%/mo, cash, simple
        "return_basis": "simple",         # simple payout; compound shown only as a comparison
        "term_months_options": [3, 6],
        "default_term_months": 6,
        "min_investment_ugx": 29_000_000,
        "max_investment_ugx": 34_000_000,
        "member_lend_rate_pct": 1.0,      # members lend to KimFam @1%/mo simple, principal only
        "member_interest_basis": "simple_accrued_paid_at_term",
        "principal_returned_at": "term_end",
        "currency_note": "KES-denominated (FX risk unmodelled)",
        "risk_flags": [
            "Due diligence — no funds committed. Verify CMA Kenya registration before committing.",
            "KES/UGX exchange-rate risk (the investment is KES-denominated).",
            "Kenyan withholding tax on unit-trust distributions may reduce the 2% headline return.",
            "KimFam is the borrower: if Fortune Credit does not repay, the club still owes its lenders.",
        ],
        "committed": False,               # False → UI must label projections "illustrative"
    },
}


def is_investment_project(project_id):
    return project_id in INVESTMENT_TERMS


def _add_months(d, n):
    """Return the date n whole months after d, clamping the day to month end."""
    m = d.month - 1 + n
    y = d.year + m // 12
    m = m % 12 + 1
    day = min(d.day, calendar.monthrange(y, m)[1])
    return date(y, m, day)


def _r(x):
    return int(round(x))


def project_investment_matrix(project_id, start_date, own_capital_ugx,
                              borrowed_capital_ugx, term_months, bank_now_ugx):
    """Month-by-month projection from start_date to term end.

    Returns {"summary": {...}, "rows": [{...per month...}]}.
    own + borrowed = total capital committed to the external investment.
    """
    terms = INVESTMENT_TERMS.get(project_id)
    if not terms:
        raise ValueError("no structured investment terms for project '%s'" % project_id)

    r = terms["monthly_return_pct"] / 100.0
    lend = terms["member_lend_rate_pct"] / 100.0
    own = max(0, int(own_capital_ugx))
    borrowed = max(0, int(borrowed_capital_ugx))
    capital = own + borrowed
    T = max(1, int(term_months))
    bank_now = int(bank_now_ugx)

    rows = []
    for n in range(1, T + 1):
        month_return_cash = capital * r                 # cash received this month
        cum_return_cash = capital * r * n               # cumulative cash received
        cum_lender_accrued = borrowed * lend * n        # liability, unpaid until term end
        settled = (n == T)
        if settled:
            # term end: external returns principal; club repays lender principal + accrued
            bank_if_invested = (bank_now - own
                                + cum_return_cash
                                + capital
                                - borrowed
                                - cum_lender_accrued)
        else:
            # mid-term: own money is locked out; only monthly cash has come in.
            # lender interest has ACCRUED but is not yet paid (shown separately).
            bank_if_invested = bank_now - own + cum_return_cash
        rows.append({
            "month": n,
            "date": _add_months(start_date, n).isoformat(),
            "return_cash_this_month": _r(month_return_cash),
            "return_cash_cumulative": _r(cum_return_cash),
            "lender_interest_accrued": _r(cum_lender_accrued),
            "principal_settled": settled,
            "bank_if_invested": _r(bank_if_invested),
            "bank_if_nothing": bank_now,
            "net_vs_nothing": _r(bank_if_invested - bank_now),
        })

    # ── summary ────────────────────────────────────────────────────────────
    # Derive the headline figures from the LAST ROW's already-rounded integers so the
    # summary always reconciles with the table a member can read (no 1-UGX drift).
    last = rows[-1]
    club_net_gain = last["net_vs_nothing"]                   # == bank_if_invested - bank_now at term end
    club_end_position = last["bank_if_invested"]             # full return on own, spread on borrowed
    total_return_simple = last["return_cash_cumulative"]
    lender_total_interest = last["lender_interest_accrued"]
    total_return_compound = capital * ((1 + r) ** T - 1)
    # downside: external returns nothing
    downside_still_owed = borrowed + borrowed * lend * T     # principal + accrued still owed to lenders
    downside_max_loss = own + downside_still_owed            # own money lost + lender obligation
    downside_shortfall = max(0, downside_max_loss - bank_now)

    summary = {
        "project_id": project_id,
        "name": terms["name"],
        "start_date": start_date.isoformat(),
        "end_date": _add_months(start_date, T).isoformat(),
        "term_months": T,
        "own_capital": own,
        "borrowed_capital": borrowed,
        "total_capital": capital,
        "monthly_return_pct": terms["monthly_return_pct"],
        "member_lend_rate_pct": terms["member_lend_rate_pct"],
        "bank_now": bank_now,
        # upside (reconciled with the last table row)
        "external_return_total_simple": total_return_simple,
        "external_return_total_compound": _r(total_return_compound),
        "lender_interest_total": lender_total_interest,
        "club_net_gain": club_net_gain,
        "club_end_position": club_end_position,
        "vs_nothing_delta": club_net_gain,
        # downside (mandatory on a family-facing board)
        "downside_own_lost": own,
        "downside_still_owed_to_lenders": _r(downside_still_owed),
        "downside_max_loss": _r(downside_max_loss),
        "downside_shortfall_vs_bank": _r(downside_shortfall),
        # governance
        "committed": terms["committed"],
        "currency_note": terms["currency_note"],
        "risk_flags": terms["risk_flags"],
    }
    return {"summary": summary, "rows": rows}


def member_lender_payout(project_id, principal_ugx, term_months, start_date):
    """What a single member who lends `principal_ugx` to KimFam receives."""
    terms = INVESTMENT_TERMS.get(project_id)
    if not terms:
        raise ValueError("no structured investment terms for project '%s'" % project_id)
    lend = terms["member_lend_rate_pct"] / 100.0
    P = max(0, int(principal_ugx))
    T = max(1, int(term_months))
    total_interest = P * lend * T
    return {
        "principal": P,
        "term_months": T,
        "monthly_interest": _r(P * lend),
        "total_interest": _r(total_interest),
        "principal_returned_at": _add_months(start_date, T).isoformat(),
        "total_received": _r(P + total_interest),
        "effective_return_pct": round(lend * T * 100, 2),   # simple, over the whole term
    }
