"""
projection.py — the original project proposal (a Google Sheet of projections) read into a model the
Hub can score actual performance against (ADR-033).

Pure part: parse the sheet's values (value_render_option=UNFORMATTED_VALUE) into a JSON-able model;
build the combined monthly plan; score ledger actuals against it. The model itself is stored in the
Hub database (the numbers are family finances: the repo is public, so tests use synthetic sheets).

The sheet's layout, as found for the chicken proposal ("Kim Fam Farm free range chicken projections"):
  * month columns C.. carry labels "1st Month", "2nd Month" ... "19th" (a label may repeat when a
    month has an extra column for the sale of birds at phase end: repeated labels are summed);
    month 1 is July 2024. The date row above the labels is NOT used (it has typos).
  * "Phase N (K chicken)" rows alternate Eggs / Chicken: quantities per month, then the same
    phases as revenue; "Cost of Sale" has one block per size (100 and 200 birds); "Other Expences"
    are monthly overheads; "Summary" restates each phase; then the capital plan sections and the
    investment recoupment.
"""
import datetime as _dt
import json
import re
import sys

MONTH0 = (2024, 7)           # month 1 of the proposal
LAY_LAG = 4                  # first eggs come this many months after the birds arrive
SPLIT = {"management": 0.30, "investor": 0.20, "club": 0.50}   # what the sheet's formulas apply (its labels say 30/70)


def _num(v):
    if isinstance(v, bool):
        return 0
    if isinstance(v, (int, float)):
        return v
    s = str(v or "").replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return 0


def _txt(v):
    return re.sub(r"\s+", " ", str(v or "")).strip()


def month_label(n):
    """Month number (1 = Jul 2024) -> 'Jul 2024'."""
    y, m = MONTH0
    idx = (y * 12 + (m - 1)) + (n - 1)
    return _dt.date(idx // 12, idx % 12 + 1, 1).strftime("%b %Y")


def month_number(d):
    """Date -> proposal month number (Jul 2024 = 1; earlier months give 0 or below)."""
    return (d.year - MONTH0[0]) * 12 + (d.month - MONTH0[1]) + 1


def _cell(row, j):
    return row[j] if j < len(row) else ""


def _find(vals, pred, start=0):
    for i in range(start, len(vals)):
        if pred(vals[i]):
            return i
    return None


def _month_columns(vals):
    """Row holding '1st Month' -> {column index: month number}."""
    i = _find(vals, lambda r: any(_txt(c).lower() == "1st month" for c in r))
    if i is None:
        raise ValueError("no '1st Month' header row")
    cols = {}
    for j, c in enumerate(vals[i]):
        m = re.match(r"^(\d+)\s*(st|nd|rd|th)\b", _txt(c), re.I)
        if m and j >= 2:
            cols[j] = int(m.group(1))
    return i, cols


def _by_month(row, cols):
    out = {}
    for j, n in cols.items():
        v = _num(_cell(row, j))
        if v:
            out[n] = out.get(n, 0) + v
    return out


def _section_amounts(vals, start_pat, end_pat):
    """Rows between a heading and the next heading -> [(label, amount)] with a trailing total."""
    a = _find(vals, lambda r: re.search(start_pat, _txt(_cell(r, 1)) or _txt(_cell(r, 0)), re.I))
    if a is None:
        return []
    items = []
    for r in vals[a + 1:]:
        lab = _txt(_cell(r, 1)) or _txt(_cell(r, 0))
        if end_pat and re.search(end_pat, _txt(_cell(r, 1)) or _txt(_cell(r, 0)), re.I) and lab:
            break
        amt = _num(_cell(r, 2))
        if lab and amt:
            items.append({"label": lab, "amount": int(amt)})
    return items


def parse_sheet(vals):
    """Sheet values -> model dict. Raises ValueError when the layout is not the one this knows."""
    hdr, cols = _month_columns(vals)
    # -- phases: alternating Eggs / Chicken rows under "1. Sales" (quantities) and "2. Revenue" (UGX)
    def phase_rows(from_i, to_i):
        out, cur = [], None
        for i in range(from_i, to_i):
            r = vals[i]
            a, b = _txt(_cell(r, 0)), _txt(_cell(r, 1)).lower()
            m = re.match(r"phase\s*(\d+)\s*\(\s*(\d+)\s*chicken", a, re.I)
            if m:
                cur = {"n": int(m.group(1)), "birds": int(m.group(2)), "name": "Phase %s (%s birds)" % (m.group(1), m.group(2))}
                out.append(cur)
            if cur is not None and b in ("eggs", "chicken"):
                cur[b] = _by_month(r, cols)
        return out
    sales_i = _find(vals, lambda r: _txt(_cell(r, 1)).startswith("1. Sales"))
    rev_i = _find(vals, lambda r: _txt(_cell(r, 1)).startswith("2. Revenue"))
    cos_i = _find(vals, lambda r: _txt(_cell(r, 1)).startswith("3. Cost of Sale"))
    oth_i = _find(vals, lambda r: _txt(_cell(r, 1)).startswith("4. Other"))
    if None in (sales_i, rev_i, cos_i, oth_i):
        raise ValueError("sections 1-4 (Sales, Revenue, Cost of Sale, Other Expences) not found")
    qty = phase_rows(sales_i + 1, rev_i)
    rev = phase_rows(rev_i + 1, cos_i)
    phases = []
    for q in qty:
        rv = next((x for x in rev if x["n"] == q["n"]), {})
        eggs = q.get("eggs", {})
        first_egg = min(eggs) if eggs else None
        phases.append({
            "n": q["n"], "name": q["name"], "birds": q["birds"],
            "start_month": (first_egg - LAY_LAG) if first_egg else None, "first_egg_month": first_egg,
            "eggs": {str(k): int(v) for k, v in eggs.items()}, "birds_sold": {str(k): int(v) for k, v in q.get("chicken", {}).items()},
            "revenue_eggs": {str(k): int(v) for k, v in rv.get("eggs", {}).items()},
            "revenue_birds": {str(k): int(v) for k, v in rv.get("chicken", {}).items()},
        })
    # explicit phase windows from the Summary "Duration" row, where given ("jul-24 to jan-26")
    dur = _find(vals, lambda r: _txt(_cell(r, 1)).lower() == "duration")
    if dur is not None:
        for j, c in enumerate(vals[dur]):
            m = re.match(r"^([a-z]{3})[-\s]*(\d{2})\s+to\s+([a-z]{3})[-\s]*(\d{2})$", _txt(c), re.I)
            if m and j >= 3 and j - 3 < len(phases):
                try:
                    d = _dt.datetime.strptime("%s %s" % (m.group(1), m.group(2)), "%b %y").date()
                    e = _dt.datetime.strptime("%s %s" % (m.group(3), m.group(4)), "%b %y").date()
                except ValueError:
                    continue
                phases[j - 3]["start_month"], phases[j - 3]["end_month"] = month_number(d), month_number(e)
    # -- cost of sale: one block per fleet size (100 / 200 birds): a first-month lump + supplementary food
    block_rows = vals[cos_i + 1:oth_i]
    head = vals[cos_i]
    blocks, cur = {}, None
    starts = [(j, int(re.search(r"(\d+)\s*chicken", _txt(c), re.I).group(1))) for j, c in enumerate(head)
              if re.search(r"\d+\s*chicken", _txt(c), re.I)]
    for k, (j0, size) in enumerate(starts):
        j1 = starts[k + 1][0] if k + 1 < len(starts) else len(head) + 8
        pattern = {}
        for r in block_rows:
            lab = _txt(_cell(r, 1)).lower()
            if lab in ("", "total"):
                continue
            for off, j in enumerate(range(j0, j1)):
                v = _num(_cell(r, j))
                if v:
                    pattern[off] = pattern.get(off, 0) + int(v)
        blocks[str(size)] = {str(o): v for o, v in sorted(pattern.items())}
    # -- other expenses: monthly overheads of the whole project
    other = {}
    for r in vals[oth_i + 1:]:
        lab = _txt(_cell(r, 1))
        if lab.lower() == "total":
            other = {str(k): int(v) for k, v in _by_month(r, cols).items()}
            break
    # -- capital plan: the sections under "Expenditure so far" onward, each with a total
    sections, i = [], 0
    names = [("Expenditure so far", r"^expenditure so far"), ("Extension required", r"^cost of extension required"),
             ("Expansion to 400 birds", r"^cost for expansion"), ("Fencing", r"^fencing"),
             ("Security and lighting", r"^security and lighting"), ("Maggot factory", r"^maggot factory")]
    marks = []
    for nm, pat in names:
        k = _find(vals, lambda r, p=pat: re.search(p, _txt(_cell(r, 1)), re.I) is not None)
        if k is not None:
            marks.append((k, nm))
    marks.sort()
    for idx, (k, nm) in enumerate(marks):
        end = marks[idx + 1][0] if idx + 1 < len(marks) else _find(vals, lambda r: _txt(_cell(r, 1)).lower() == "investment recoupment") or len(vals)
        items = []
        for r in vals[k + 1:end]:
            lab = _txt(_cell(r, 1)) or _txt(_cell(r, 0))
            amt = _num(_cell(r, 2))
            if lab.lower().startswith("total investment") or lab.lower() == "investment recoupment":
                break
            if lab.lower() in ("total", "sub total", "subtotal"):
                continue
            if lab and amt:
                items.append({"label": lab, "amount": int(amt)})
        sections.append({"name": nm, "items": items, "total": sum(x["amount"] for x in items)})
    rec = _find(vals, lambda r: _txt(_cell(r, 1)).lower() == "total investment")
    investment = int(_num(_cell(vals[rec], 2))) if rec is not None else None
    return {
        "months": max(cols.values()), "month0": "%d-%02d" % MONTH0, "lay_lag": LAY_LAG, "split": SPLIT,
        "phases": phases, "cost_of_sale_blocks": blocks, "other_monthly": other,
        "capital": sections, "investment_total": investment,
    }


def monthly_plan(model):
    """The combined plan by proposal month: {n: {eggs, birds_sold, rev_eggs, rev_birds, cos, other, profit}}."""
    plan = {}

    def slot(n):
        return plan.setdefault(n, {"eggs": 0, "birds_sold": 0, "rev_eggs": 0, "rev_birds": 0, "cos": 0, "other": 0})
    for p in model["phases"]:
        for k, v in p["eggs"].items():
            slot(int(k))["eggs"] += v
        for k, v in p["birds_sold"].items():
            slot(int(k))["birds_sold"] += v
        for k, v in p["revenue_eggs"].items():
            slot(int(k))["rev_eggs"] += v
        for k, v in p["revenue_birds"].items():
            slot(int(k))["rev_birds"] += v
        blk = model["cost_of_sale_blocks"].get(str(p["birds"]))
        if blk and p.get("start_month"):
            for off, v in blk.items():
                slot(p["start_month"] + int(off))["cos"] += v
    for k, v in model["other_monthly"].items():
        slot(int(k))["other"] += v
    for n, s in plan.items():
        s["revenue"] = s["rev_eggs"] + s["rev_birds"]
        s["profit"] = s["revenue"] - s["cos"] - s["other"]
    return plan


def phase_summary(model):
    """Each phase as the sheet's Summary states it (eggs, revenue, cost of sale), for phases that have one."""
    out = []
    for p in model["phases"]:
        rev = sum(p["revenue_eggs"].values()) + sum(p["revenue_birds"].values())
        out.append({"n": p["n"], "name": p["name"], "birds": p["birds"], "start_month": p.get("start_month"),
                    "first_egg_month": p.get("first_egg_month"), "eggs": sum(p["eggs"].values()),
                    "birds_sold": sum(p["birds_sold"].values()), "revenue": rev})
    return out


# ── scoring: ledger actuals against the plan (ADR-033) ───────────────────────────────────────────
COS_CATEGORIES = ("Birds / Stock", "Feed & Nutrition", "Medicine & Vet")      # the plan's "cost of sale"
SCORE_WEIGHTS = (("revenue", 30), ("profit", 30), ("costs", 20), ("yield", 10), ("survival", 10))
RATINGS = ((80, "On track"), (60, "Watch"), (40, "Behind"), (0, "Off plan"))


def _pct(a, b):
    return None if not b else round(100.0 * a / b, 1)


def actual_monthly(rows, treasury, n_now):
    """Ledger rows (+ club treasury pay rows) -> {n: {...}} for months 1..n_now. Pre-launch spending
    (before month 1) is folded into month 1. Capex is kept apart, as in the plan."""
    import ledger as _l
    names = {p["product_id"]: (p["name"] or "").lower() for p in rows["products"]}
    out = {n: {"eggs_sold": 0, "rev_eggs": 0, "rev_birds": 0, "birds_sold": 0, "eggs_made": 0,
               "cos": 0, "other": 0, "capex": 0} for n in range(1, n_now + 1)}

    def at(d):
        return min(max(month_number(d), 1), n_now)
    for s in rows["sales"]:
        m = out[at(s["sale_date"])]
        if names.get(s["product_id"]) == "eggs":
            m["eggs_sold"] += s["qty"]; m["rev_eggs"] += s["total"]
        else:
            m["birds_sold"] += s["qty"]; m["rev_birds"] += s["total"]
    for s in rows["stock"]:
        if s["kind"] == "production":
            out[at(s["event_date"])]["eggs_made"] += s["qty"]
    for e in rows["expenses"]:
        m = out[at(e["expense_date"])]
        if e["kind"] == "capex":
            m["capex"] += e["total"]
        elif _l.expense_category(e["item"]) in COS_CATEGORIES:
            m["cos"] += e["total"]
        else:
            m["other"] += e["total"]
    for t in treasury or []:
        if _l.classify_treasury(t) == "pay":
            out[at(t["txn_date"])]["other"] += t["amount_ugx"]
    for m in out.values():
        m["revenue"] = m["rev_eggs"] + m["rev_birds"]
        m["profit"] = m["revenue"] - m["cos"] - m["other"]
    return out


def _birds_over_time(rows, n_now):
    """Birds in the flock at each month end, and how many of them are old enough to lay."""
    names = {p["product_id"]: (p["name"] or "").lower() for p in rows["products"]}
    birds = {pid for pid, n in names.items() if n != "eggs"}
    layers_by = {pid for pid in birds if names[pid] != "cocks"}
    series = {}
    for n in range(1, n_now + 1):
        y, mo = divmod((MONTH0[0] * 12 + (MONTH0[1] - 1)) + n, 12)      # first day of the NEXT month
        cut = _dt.date(y, mo + 1, 1)
        alive = layers = 0
        for pid in birds:
            got = sum(s["qty"] for s in rows["stock"] if s["product_id"] == pid and s["event_date"] < cut)
            gone = (sum(s["qty"] for s in rows["sales"] if s["product_id"] == pid and s["sale_date"] < cut) +
                    sum(s["qty"] for s in rows["losses"] if s["product_id"] == pid and s["loss_date"] < cut))
            now = max(got - gone, 0)
            alive += now
            if pid in layers_by:
                ly, lm = divmod((cut.year * 12 + cut.month - 1) - LAY_LAG, 12)
                lag_cut = _dt.date(ly, lm + 1, 1)
                old = sum(s["qty"] for s in rows["stock"] if s["product_id"] == pid and s["event_date"] < lag_cut and s["kind"] == "purchase")
                layers += min(now, old)
        series[n] = {"alive": alive, "layers": layers}
    return series


def _rating(score):
    return next(label for floor, label in RATINGS if score >= floor)


def _delivered(model, bought):
    """Allocate the birds actually bought, in order, to the planned phases. -> (status per phase, delivered phases)."""
    due, status, delivered = 0, {}, []
    return due, status, delivered


def score(model, rows, treasury, today):
    """The scorecard: two separate answers. EXECUTION: did the plan's phases happen (birds bought against
    birds planned by now)? PERFORMANCE: how did the phases that did happen perform against the plan for
    those phases (so an expansion that was never funded does not make the farm look bad, and does not
    hide behind a good farm either). Everything is derived from the model and the ledger rows."""
    n_now = max(1, min(month_number(today), model["months"]))
    names = {p["product_id"]: (p["name"] or "").lower() for p in rows["products"]}
    bought = sum(s["qty"] for s in rows["stock"] if s["kind"] == "purchase")
    due, phases, delivered = 0, [], []
    for ph in model["phases"]:
        due += ph["birds"]
        sm = ph.get("start_month") or 0
        started = bought >= due
        if started:
            delivered.append(ph)
        phases.append({"n": ph["n"], "name": ph["name"], "birds": ph["birds"], "start": month_label(sm) if sm else None,
                       "first_eggs": month_label(ph["first_egg_month"]) if ph.get("first_egg_month") else None,
                       "status": "bought" if started else ("overdue" if sm and sm <= n_now else "not due yet")})
    planned_birds_now = sum(ph["birds"] for ph in model["phases"] if (ph.get("start_month") or 0) and ph["start_month"] <= n_now)
    execution = {"birds_planned_by_now": planned_birds_now, "birds_bought": bought,
                 "pct": min(100, round(100.0 * bought / planned_birds_now)) if planned_birds_now else 100}

    plan_w = monthly_plan(model)                                         # the plan as written (all phases)
    plan = monthly_plan(dict(model, phases=delivered)) if delivered else monthly_plan(dict(model, phases=[]))
    for n, v in plan_w.items():                                          # the overhead path belongs to the project, not a phase
        plan.setdefault(n, {"eggs": 0, "birds_sold": 0, "rev_eggs": 0, "rev_birds": 0, "cos": 0, "other": v["other"], "revenue": 0, "profit": 0})
        plan[n]["other"] = v["other"]
        plan[n]["profit"] = plan[n]["revenue"] - plan[n]["cos"] - plan[n]["other"]
    act = actual_monthly(rows, treasury, n_now)
    flock = _birds_over_time(rows, n_now)

    def cum(series, key):
        return sum(series.get(n, {}).get(key, 0) for n in range(1, n_now + 1))
    keys = ("eggs", "rev_eggs", "rev_birds", "revenue", "cos", "other", "profit", "birds_sold")
    P = {k: cum(plan, k) for k in keys}
    W = {k: cum(plan_w, k) for k in keys}
    A = {k: cum(act, k) for k in ("eggs_sold", "rev_eggs", "rev_birds", "revenue", "cos", "other", "profit", "birds_sold", "eggs_made", "capex")}
    plan_costs, act_costs = P["cos"] + P["other"], A["cos"] + A["other"]

    layer_months = sum(f["layers"] for f in flock.values())
    rate = (A["eggs_made"] / (layer_months * 30.0)) if layer_months else None
    plan_rate = 0.6
    rates = [v / (ph["birds"] * 30.0) for ph in model["phases"] if ph["birds"] for v in ph["eggs"].values()]
    if rates:                              # the median: the sheet repeats a few month columns, which spike single months
        rates.sort()
        plan_rate = round(rates[len(rates) // 2], 3)
    died = sum(l["qty"] for l in rows["losses"] if (l.get("kind") or "").lower() == "damaged" and names.get(l["product_id"]) != "eggs")
    survival = (1 - died / bought) if bought else None

    parts = {
        "revenue": min(A["revenue"] / P["revenue"], 1.0) if P["revenue"] else 1.0,
        "profit": 1.0 if A["profit"] >= P["profit"] else max(0.0, 1 - (P["profit"] - A["profit"]) / max(P["revenue"], 1)),
        "costs": 1.0 if act_costs <= plan_costs else (plan_costs / act_costs if act_costs else 1.0),
        "yield": min(rate / plan_rate, 1.0) if rate is not None and plan_rate else 0.0,
        "survival": max(0.0, min(survival, 1.0)) if survival is not None else 0.0,
    }
    total = round(sum(parts[k] * w for k, w in SCORE_WEIGHTS))

    def kpi(key, label, plan_v, written_v, actual_v, higher_better=True, pct_ok=True):
        if higher_better:
            st = "green" if actual_v >= .9 * plan_v else "amber" if actual_v >= .7 * plan_v else "red"
        else:
            st = "green" if actual_v <= 1.1 * plan_v else "amber" if actual_v <= 1.3 * plan_v else "red"
        return {"key": key, "label": label, "plan": plan_v, "plan_as_written": written_v, "actual": actual_v,
                "pct": _pct(actual_v, plan_v) if pct_ok else None, "status": st}
    kpis = [
        kpi("revenue", "Revenue to date", P["revenue"], W["revenue"], A["revenue"]),
        kpi("eggs", "Eggs sold", P["eggs"], W["eggs"], A["eggs_sold"]),
        kpi("birds", "Birds sold", P["birds_sold"], W["birds_sold"], A["birds_sold"]),
        kpi("cos", "Cost of sale (birds, feed, medicine)", P["cos"], W["cos"], A["cos"], higher_better=False),
        kpi("other", "Other expenses (labour, transport, supplies, manager)", P["other"], W["other"], A["other"], higher_better=False),
    ]
    pk = kpi("profit", "Profit to date (before equipment)", P["profit"], W["profit"], A["profit"], pct_ok=P["profit"] > 0)
    pk["status"] = "green" if A["profit"] >= P["profit"] else "amber" if A["profit"] >= P["profit"] - .15 * max(P["revenue"], 1) else "red"
    kpis.append(pk)

    share = SPLIT["club"] + SPLIT["investor"]
    invest = model.get("investment_total") or 0
    cum_plan, payback = 0, None
    for n in range(1, model["months"] + 1):
        cum_plan += plan_w.get(n, {}).get("profit", 0)
        if payback is None and invest and cum_plan * share >= invest:
            payback = n
    months = []
    for n in range(1, min(model["months"], n_now + 6) + 1):
        a = act.get(n)
        months.append({"n": n, "month": month_label(n), "past": n <= n_now,
                       "plan": {k: plan.get(n, {}).get(k, 0) for k in ("eggs", "revenue", "cos", "other", "profit")},
                       "plan_as_written": {k: plan_w.get(n, {}).get(k, 0) for k in ("eggs", "revenue", "cos", "other", "profit")},
                       "actual": ({k: a[k] for k in ("eggs_sold", "revenue", "cos", "other", "profit", "capex")} if a else None)})
    findings = _findings(model, rows, P, W, A, rate, plan_rate, phases, execution, n_now)
    return {
        "as_of": month_label(n_now), "month_now": n_now, "months_total": model["months"],
        "execution": execution,
        "score": {"total": total, "rating": _rating(total), "meaning": "Performance of the phases that were actually bought, against the plan for those phases.",
                  "parts": [{"key": k, "weight": w, "pct": round(parts[k] * 100)} for k, w in SCORE_WEIGHTS]},
        "kpis": kpis,
        "yield": {"actual_rate": round(rate, 3) if rate is not None else None, "plan_rate": plan_rate},
        "flock": {"bought": bought, "died": died, "survival_pct": round(survival * 100, 1) if survival is not None else None},
        "months": months, "phases": phases,
        "capital": {"sections": model["capital"], "plan_total": invest, "capex_to_date": A["capex"],
                    "note": "The sheet's total investment excludes the fencing section." if any(s["name"] == "Fencing" for s in model["capital"]) else ""},
        "recoupment": {"investment": invest, "share": round(share, 2), "plan_payback_month": month_label(payback) if payback else None,
                       "actual_return_to_date": max(0, int(A["profit"] * share))},
        "findings": findings,
    }


def _findings(model, rows, P, W, A, rate, plan_rate, phases, execution, n_now):
    out = []

    def add(sev, text):
        out.append({"severity": sev, "text": text})
    if execution["pct"] < 80:
        add("high", "Execution: %d birds bought against %d planned by now (%d%%). %d planned phase%s not started on time."
            % (execution["birds_bought"], execution["birds_planned_by_now"], execution["pct"],
               sum(1 for p in phases if p["status"] == "overdue"), "" if sum(1 for p in phases if p["status"] == "overdue") == 1 else "s"))
    if P["cos"] and A["cos"] > 1.3 * P["cos"]:
        add("high", "Cost of sale is %d%% of the plan for the phases bought: the proposal budgets feed for the first months of each phase only, so running feed costs sit mostly outside it."
            % round(100.0 * A["cos"] / P["cos"]))
    if P["other"] and A["other"] < .5 * P["other"]:
        add("info", "Other expenses are only %d%% of plan: either the farm runs leaner than the proposal (labour, manager) or those costs are not being recorded in the ledger."
            % round(100.0 * A["other"] / P["other"]))
    if P["revenue"] and A["revenue"] < .7 * P["revenue"]:
        add("high", "Revenue is %d%% of the plan for the phases bought (and %d%% of the plan as written)."
            % (round(100.0 * A["revenue"] / P["revenue"]), round(100.0 * A["revenue"] / W["revenue"]) if W["revenue"] else 0))
    if rate is not None and rate < .85 * plan_rate:
        add("high", "Recorded laying rate is %.0f%% against the planned %.0f%%: check that weekly egg collections are all being recorded." % (rate * 100, plan_rate * 100))
    if P["birds_sold"] and A["birds_sold"] > P["birds_sold"] * 1.2:
        add("info", "More birds sold than planned (%d against %d)." % (A["birds_sold"], P["birds_sold"]))
    if A["profit"] < 0:
        add("info", "No operating profit yet (before equipment).")
    return out


# ── storage and import (the model is family data: it lives in the database, never in the repo) ──
_LOCK_KEY = 778814
_READY = False


def ready():
    global _READY
    if _READY:
        return True
    try:
        from db import db as _db
        with _db() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_KEY,))
                cur.execute("""CREATE TABLE IF NOT EXISTS project_projection (
                    id SERIAL PRIMARY KEY, project_id TEXT NOT NULL, version INTEGER NOT NULL,
                    source_url TEXT, source_title TEXT, model JSONB NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
                    imported_by TEXT NOT NULL DEFAULT 'import', imported_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
                cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS project_projection_active_uq ON project_projection(project_id) WHERE active")
        _READY = True
    except Exception as _e:
        import logging
        logging.getLogger("uvicorn.error").warning("projection table unavailable: %s", _e)
    return _READY


def save_model(project_id, model, source_url, source_title, who="import"):
    """A new version replaces the active one (older versions are kept, inactive)."""
    from psycopg2.extras import Json
    from db import db as _db
    if not ready():
        raise RuntimeError("projection table unavailable")
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_KEY,))
            cur.execute("SELECT coalesce(max(version),0) FROM project_projection WHERE project_id=%s", (project_id,))
            v = cur.fetchone()[0] + 1
            cur.execute("UPDATE project_projection SET active=FALSE WHERE project_id=%s AND active", (project_id,))
            cur.execute("INSERT INTO project_projection (project_id, version, source_url, source_title, model, imported_by) VALUES (%s,%s,%s,%s,%s,%s)",
                        (project_id, v, source_url, source_title, Json(model), who))
    return v


def load_model(project_id):
    from db import query as _q
    if not ready():
        return None
    r = _q("SELECT model, version, source_url, source_title, imported_at FROM project_projection WHERE project_id=%s AND active", (project_id,))
    return r[0] if r else None


def fetch_sheet(sheet_id, service_account_path):
    import gspread
    from google.oauth2.service_account import Credentials
    import time
    creds = Credentials.from_service_account_file(service_account_path, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"])
    for attempt in range(5):
        try:
            sh = gspread.authorize(creds).open_by_key(sheet_id)
            return sh.title, sh.sheet1.get_all_values(value_render_option="UNFORMATTED_VALUE")
        except gspread.exceptions.APIError:
            if attempt == 4:
                raise
            time.sleep(5 * (attempt + 1))


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "import":   # import <project> <sheet_id>  (run in the app dir, needs DATABASE_URL)
        _title, _vals = fetch_sheet(sys.argv[3], "service-account.json")
        _m = parse_sheet(_vals)
        _v = save_model(sys.argv[2], _m, "https://docs.google.com/spreadsheets/d/%s" % sys.argv[3], _title)
        print("saved projection v%d for %s: %d phases, %d months, investment %s" % (_v, sys.argv[2], len(_m["phases"]), _m["months"], _m["investment_total"]))
        sys.exit(0)
    if len(sys.argv) == 3 and sys.argv[1] == "show":     # show <sheet_values.json>  (a JSON list of rows)
        data = json.load(open(sys.argv[2]))
        data = data["values"] if isinstance(data, dict) else data
        m = parse_sheet(data)
        print(json.dumps({k: m[k] for k in m if k != "phases"}, indent=1)[:1500])
        for p in phase_summary(m):
            print(p)
    else:
        print(__doc__)
