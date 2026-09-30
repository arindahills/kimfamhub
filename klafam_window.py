"""
klafam_window.py: which KlaFam Tanda cycles are open on a given day (ADR-031).

A cycle's contributions are due on the 28th of the PREVIOUS month, so from the 28th a new
"current" cycle opens (Oct opens on 28 Sep). Late payers are normal: someone paying their
September share on 30 Sep sends it to the September beneficiary, not to October's. So the
cycle before the current one stays OPEN for late payments until the 14th of the current cycle's
month (Sep stays open until 14 Oct), then closes and is no longer shown.

Pure and unit-tested across whole years (tests/test_api.py::TestKlaFamWindow).
"""
from datetime import date


def _prev(y, m):
    return (y - 1, 12) if m == 1 else (y, m - 1)


def cycle_window(today):
    """today -> ((cur_year, cur_month), (prev_year, prev_month) or None).

    current: the 28th onward rolls to next month; before the 28th it is this month.
    previous: the cycle before current, only while today is before the 14th of the current
    cycle's month (on or after the 14th it is closed)."""
    if today.day >= 28:
        cy, cm = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
    else:
        cy, cm = today.year, today.month
    prev_open = today < date(cy, cm, 14)
    return (cy, cm), (_prev(cy, cm) if prev_open else None)
