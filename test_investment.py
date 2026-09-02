"""Unit tests for investment.py — run: python3 test_investment.py"""
from datetime import date
from investment import project_investment_matrix, member_lender_payout, is_investment_project

BANK = 20_402_627


def approx(a, b, tol=1):
    assert abs(a - b) <= tol, "expected %s got %s" % (b, a)


def test_all_borrowed():
    """29M all borrowed from members, 6 months. Club earns only the 1% spread."""
    m = project_investment_matrix("fortune_credit", date(2026, 9, 3),
                                  own_capital_ugx=0, borrowed_capital_ugx=29_000_000,
                                  term_months=6, bank_now_ugx=BANK)
    s = m["summary"]
    approx(s["club_net_gain"], 1_740_000)                 # 1% * 29M * 6
    approx(s["external_return_total_simple"], 3_480_000)  # 2% * 29M * 6
    approx(s["lender_interest_total"], 1_740_000)         # 1% * 29M * 6
    approx(s["club_end_position"], BANK + 1_740_000)
    approx(s["downside_still_owed_to_lenders"], 30_740_000)  # 29M + 1.74M
    approx(s["downside_max_loss"], 30_740_000)               # own 0 + owed
    approx(s["downside_shortfall_vs_bank"], 30_740_000 - BANK)
    assert s["committed"] is False
    assert len(m["rows"]) == 6
    last = m["rows"][-1]
    assert last["principal_settled"] is True
    approx(last["net_vs_nothing"], 1_740_000)             # end position == summary gain
    approx(last["bank_if_invested"], BANK + 1_740_000)
    # mid-term row 3: only cash received, principal not settled, lender accrued shown separately
    r3 = m["rows"][2]
    assert r3["principal_settled"] is False
    approx(r3["return_cash_cumulative"], 29_000_000 * 0.02 * 3)  # 1,740,000
    approx(r3["lender_interest_accrued"], 29_000_000 * 0.01 * 3)  # 870,000
    approx(r3["bank_if_invested"], BANK - 0 + 1_740_000)


def test_mixed_capital():
    """8M own + 21M borrowed. Full 2% on own, 1% spread on borrowed."""
    m = project_investment_matrix("fortune_credit", date(2026, 9, 3),
                                  own_capital_ugx=8_000_000, borrowed_capital_ugx=21_000_000,
                                  term_months=6, bank_now_ugx=BANK)
    s = m["summary"]
    # 2%*8M*6 + 1%*21M*6 = 960,000 + 1,260,000
    approx(s["club_net_gain"], 2_220_000)
    approx(s["total_capital"], 29_000_000)
    # downside: own 8M lost + still owe 21M*(1+0.06)=22,260,000  => 30,260,000
    approx(s["downside_max_loss"], 8_000_000 + 22_260_000)


def test_own_only():
    """All own money — no borrowing, full 2% return, no lender downside."""
    m = project_investment_matrix("fortune_credit", date(2026, 9, 3),
                                  own_capital_ugx=10_000_000, borrowed_capital_ugx=0,
                                  term_months=3, bank_now_ugx=BANK)
    s = m["summary"]
    approx(s["club_net_gain"], 10_000_000 * 0.02 * 3)     # 600,000
    approx(s["lender_interest_total"], 0)
    approx(s["downside_still_owed_to_lenders"], 0)
    approx(s["downside_max_loss"], 10_000_000)            # only own money at risk


def test_member_payout():
    """A member lends 7M for 6 months @1%/mo simple."""
    p = member_lender_payout("fortune_credit", 7_000_000, 6, date(2026, 9, 3))
    approx(p["monthly_interest"], 70_000)
    approx(p["total_interest"], 420_000)
    approx(p["total_received"], 7_420_000)
    assert p["effective_return_pct"] == 6.0
    assert p["principal_returned_at"] == "2027-03-03"


def test_dates_and_compound():
    m = project_investment_matrix("fortune_credit", date(2026, 9, 3),
                                  0, 29_000_000, 6, BANK)
    assert m["summary"]["end_date"] == "2027-03-03"
    assert m["rows"][0]["date"] == "2026-10-03"
    # compound > simple for a positive rate
    assert m["summary"]["external_return_total_compound"] > m["summary"]["external_return_total_simple"]


# JUSTIFICATION-A3: net-new test fn asserting summary/last-row reconciliation; not a wrap.
def test_summary_reconciles_with_last_row_exactly():
    """Headline figures must equal the last table row to the shilling (no 1-UGX drift)
    across awkward inputs — a member cross-checking the books must see them balance."""
    cases = [
        (27_099_213, 22_757_699, 6),
        (1, 999_999_999, 3),
        (13_333_333, 6_666_667, 6),
        (0, 34_000_000, 3),
        (10_000_001, 0, 6),
    ]
    for own, borrowed, term in cases:
        m = project_investment_matrix("fortune_credit", date(2026, 9, 3),
                                      own, borrowed, term, BANK)
        s, last = m["summary"], m["rows"][-1]
        assert s["club_end_position"] == last["bank_if_invested"], (own, borrowed, term)
        assert s["club_net_gain"] == last["net_vs_nothing"], (own, borrowed, term)
        assert s["club_end_position"] == s["bank_now"] + s["club_net_gain"], (own, borrowed, term)
        assert s["external_return_total_simple"] == last["return_cash_cumulative"]
        assert s["lender_interest_total"] == last["lender_interest_accrued"]


def test_guards():
    assert is_investment_project("fortune_credit") is True
    assert is_investment_project("chicken") is False
    try:
        project_investment_matrix("chicken", date(2026, 9, 3), 0, 1, 6, BANK)
        assert False, "should have raised"
    except ValueError:
        pass


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print("  ok", fn.__name__)
    print("\nAll %d tests passed." % len(fns))
