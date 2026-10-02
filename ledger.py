"""
ledger.py — one project ledger that replaces the AppSheet (ADR-032).

Pure part (this file, no database): parse an AppSheet snapshot into ledger rows and compute the
AppSheet's own Financial Statement from them, so the import can be proven equal to the sheet's
figures to the shilling before anything is switched.

The snapshot is {tab title: rows as read with value_render_option=UNFORMATTED_VALUE}. Dates are the
sheet's serial numbers (never the formatted strings: the sheet mixes m/d/Y and d/m/Y).

    python3 ledger.py parity <snapshot.json>      # prints computed vs sheet, exits 1 on any difference
    python3 ledger.py snapshot <sheet_id> <out>   # read the AppSheet workbook (run in the app dir)
    python3 ledger.py import <project> <snap>     # one-time import; refuses unless parity holds, and a second snapshot

Formulas (ADR-032 decision 3), the AppSheet's own:
    sales            = sum of sales totals
    spoilt           = sum of loss totals AS ENTERED
    qty available    = stocked - sold - lost, per product
    stock at cost    = qty available x sell price for products valued at sell (eggs), else x cost price
    expected sales   = qty available x sell price
    opex / capex     = sum of expense totals by Expense Type
    depreciation     = capex / 10
    gross            = sales - spoilt - opex
    net (capex)      = gross - capex
    net (deprec.)    = gross - depreciation
"""
import datetime as _dt
import hashlib
import json
import re
import sys

EPOCH = _dt.date(1899, 12, 30)

TAB_PRODUCTS = "product descriptions"
TAB_EXPENSES = "company expenses"
TAB_SALES = "sales"
TAB_STOCK = "stock details starting may 2024"
TAB_LOSSES = "used or spoilt items not sold"
TAB_STATEMENT = "Financial Statement"
TABS = (TAB_PRODUCTS, TAB_EXPENSES, TAB_SALES, TAB_STOCK, TAB_LOSSES, TAB_STATEMENT)

# Products the sheet values at SELL price in "available stock" (an inconsistency kept for parity:
# ADR-032 decision 3; correcting it is Hillary's decision, not the importer's).
VALUED_AT_SELL = ("eggs",)


def serial_date(v):
    """Sheet serial number (45460 or 45460.6) -> date. Anything else -> None."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return EPOCH + _dt.timedelta(days=int(v))


def to_int(v):
    """Money/quantity cell -> int. Blank and the sheet's '-' placeholder -> 0. Mixed formats
    ('1,376,800') are accepted; a fractional value is rounded, never truncated."""
    if isinstance(v, bool):
        return 0
    if isinstance(v, (int, float)):
        return int(round(v))
    s = str(v or "").replace(",", "").strip()
    if s in ("", "-"):
        return 0
    try:
        return int(round(float(s)))
    except ValueError:
        return 0


def _norm(h):
    return re.sub(r"\s+", " ", str(h or "")).strip().lower()


def _rows(snap, tab):
    """Tab -> list of (row number in sheet, {normalized header: cell}). Blank rows skipped."""
    data = snap.get(tab) or []
    if not data:
        return []
    heads = [_norm(h) for h in data[0]]
    out = []
    for i, r in enumerate(data[1:], start=2):
        if not any(str(c).strip() for c in r):
            continue
        out.append((i, {h: (r[j] if j < len(r) else "") for j, h in enumerate(heads)}))
    return out


def snapshot_hash(snap):
    return hashlib.sha256(json.dumps(snap, sort_keys=True, default=str).encode()).hexdigest()[:16]


def _ref(snap_hash, tab_key, row):
    return "appsheet:%s:%s:%d" % (snap_hash, tab_key, row)


def parse_snapshot(snap):
    """-> {'products','stock','sales','losses','expenses'} lists of dicts (integer UGX), each with
    a stable source_ref and the raw sheet row. Raises ValueError if a row has no usable date, so a
    bad import stops instead of landing on the wrong day."""
    h = snapshot_hash(snap)
    out = {"products": [], "stock": [], "sales": [], "losses": [], "expenses": [], "hash": h}

    for i, r in _rows(snap, TAB_PRODUCTS):
        out["products"].append({
            "product_id": str(r.get("product id", "")).strip(), "name": str(r.get("product description", "")).strip(),
            "uom": str(r.get("uom", "")).strip() or "pc",
            "cost_price": to_int(r.get("u/cost price")), "sell_price": to_int(r.get("u/sell price")),
            "valuation": "sell" if str(r.get("product description", "")).strip().lower() in VALUED_AT_SELL else "cost",
            "sheet_qty_available": to_int(r.get("qty available overall")),
            "sheet_available_stock": to_int(r.get("available stock")),
            "sheet_expected_sales": to_int(r.get("expected sales")),
            "source_ref": _ref(h, "product", i),
        })

    def dated(r, key, tab, i):
        d = serial_date(r.get(key))
        if d is None:
            raise ValueError("%s row %d: no serial date in %r (%r)" % (tab, i, key, r.get(key)))
        return d

    for i, r in _rows(snap, TAB_STOCK):
        pid = str(r.get("product id", "")).strip()
        cost = to_int(r.get("u/cost price"))
        out["stock"].append({
            "product_id": pid, "event_date": dated(r, "purchase date", "stock", i),
            "qty": to_int(r.get("qty stocked")), "unit_cost": cost,
            "total_cost": to_int(r.get("total purchase cost")),
            # weekly egg production is logged as a "purchase" at cost 0: keep it a distinct kind
            "kind": "production" if cost == 0 and not to_int(r.get("total purchase cost")) else "purchase",
            "supplier": str(r.get("purchased from", "")).strip(),
            "source_ref": _ref(h, "stock", i), "raw": r,
        })
    for i, r in _rows(snap, TAB_SALES):
        out["sales"].append({
            "product_id": str(r.get("product id", "")).strip(), "sale_date": dated(r, "date", "sales", i),
            "qty": to_int(r.get("quantity sold")), "unit_price": to_int(r.get("unit selling price")),
            "total": to_int(r.get("total amount sold")), "buyer": str(r.get("name of buyer", "")).strip(),
            "payment": str(r.get("type of sale", "")).strip() or "Cash",
            "source_ref": _ref(h, "sale", i), "raw": r,
        })
    for i, r in _rows(snap, TAB_LOSSES):
        out["losses"].append({
            "product_id": str(r.get("product id", "")).strip(), "loss_date": dated(r, "date", "losses", i),
            "qty": to_int(r.get("quantity used or spoilt")), "total": to_int(r.get("total amount used or spoilt")),
            "kind": str(r.get("usage type", "")).strip(), "reason": str(r.get("reason for usage", "")).strip(),
            "source_ref": _ref(h, "loss", i), "raw": r,
        })
    for i, r in _rows(snap, TAB_EXPENSES):
        kind = str(r.get("expense type", "")).strip().lower()
        if kind not in ("opex", "capex"):
            raise ValueError("expenses row %d: unknown Expense Type %r" % (i, r.get("expense type")))
        out["expenses"].append({
            "expense_date": dated(r, "date", "expenses", i), "item": str(r.get("expense item", "")).strip(),
            "supplier": str(r.get("beneficiary", "")).strip(), "qty": to_int(r.get("quantity")),
            "unit_price": to_int(r.get("unit price")), "total": to_int(r.get("total cost")),
            "kind": kind, "note": str(r.get("others (explain)", "")).strip(),
            "source_ref": _ref(h, "expense", i), "raw": r,
        })
    return out


def qty_available(parsed):
    """{product_id: stocked - sold - lost}."""
    q = {}
    for p in parsed["products"]:
        q[p["product_id"]] = 0
    for s in parsed["stock"]:
        q[s["product_id"]] = q.get(s["product_id"], 0) + s["qty"]
    for s in parsed["sales"]:
        q[s["product_id"]] = q.get(s["product_id"], 0) - s["qty"]
    for s in parsed["losses"]:
        q[s["product_id"]] = q.get(s["product_id"], 0) - s["qty"]
    return q


def statement(parsed):
    """The AppSheet's Financial Statement, computed from ledger rows. Also per product."""
    qty = qty_available(parsed)
    stock_cost = expected = 0
    per_product = {}
    for p in parsed["products"]:
        n = qty.get(p["product_id"], 0)
        val = n * (p["sell_price"] if p["valuation"] == "sell" else p["cost_price"])
        exp = n * p["sell_price"]
        stock_cost += val
        expected += exp
        per_product[p["product_id"]] = {"qty_available": n, "available_stock": val, "expected_sales": exp}
    sales = sum(s["total"] for s in parsed["sales"])
    spoilt = sum(s["total"] for s in parsed["losses"])
    opex = sum(e["total"] for e in parsed["expenses"] if e["kind"] == "opex")
    capex = sum(e["total"] for e in parsed["expenses"] if e["kind"] == "capex")
    dep = capex // 10
    gross = sales - spoilt - opex
    return {
        "sales": sales, "spoilt": spoilt, "available_stock_cost": stock_cost, "expected_sales": expected,
        "opex": opex, "capex": capex, "depreciation": dep, "gross": gross,
        "net_with_capex": gross - capex, "net_with_depreciation": gross - dep,
        "per_product": per_product,
    }


# the sheet's Financial Statement metric labels -> our keys
_STATEMENT_KEYS = {
    "sales": "sales", "spoilt goods (cash loss)": "spoilt", "available stock (cost)": "available_stock_cost",
    "expected sales": "expected_sales", "operating expenses (opex)": "opex", "capital expenses (capex)": "capex",
    "depreciation (per year)": "depreciation", "gross position": "gross",
    "net position (with capex)": "net_with_capex", "net position (with depreciation)": "net_with_depreciation",
}


def sheet_statement(snap):
    """The sheet's own Financial Statement tab as {our key: value}."""
    out = {}
    for _i, r in _rows(snap, TAB_STATEMENT):
        k = _STATEMENT_KEYS.get(_norm(r.get("metric")))
        if k:
            out[k] = to_int(r.get("value"))
    return out


def parity(snap):
    """-> (ok, lines). Compares the computed statement with the sheet's Financial Statement and the
    per-product columns (qty available, available stock, expected sales). ok only if EVERY figure
    is identical and the sheet has all ten."""
    parsed = parse_snapshot(snap)
    mine, theirs = statement(parsed), sheet_statement(snap)
    lines, ok = [], True
    for k in _STATEMENT_KEYS.values():
        a, b = mine[k], theirs.get(k)
        same = a == b
        ok &= same
        lines.append("%-24s ledger %12s   sheet %12s   %s" % (k, "{:,}".format(a), "{:,}".format(b) if b is not None else "MISSING", "OK" if same else "DIFF"))
    for p in parsed["products"]:
        m = mine["per_product"][p["product_id"]]
        for key, sheet_key in (("qty_available", "sheet_qty_available"), ("available_stock", "sheet_available_stock"),
                               ("expected_sales", "sheet_expected_sales")):
            same = m[key] == p[sheet_key]
            ok &= same
            if not same:
                lines.append("product %-9s %-16s ledger %s sheet %s DIFF" % (p["product_id"], key, m[key], p[sheet_key]))
    return ok, lines


# ── read models: the shapes the Hub's chicken endpoints already serve (ADR-032 decision 9) ───────
# (card label as the sheet spelled it, statement key, description shown on the card)
STATEMENT_LABELS = (
    ("sales", "sales", "All cash from selling eggs/chickens"),
    ("Spoilt Goods (Cash Loss)", "spoilt", "Value lost to spoilage"),
    ("Available Stock (Cost)", "available_stock_cost", "Inventory at cost value"),
    ("Expected Sales", "expected_sales", "Potential sales if all inventory sold"),
    ("Operating Expenses (OPEX)", "opex", "Running costs"),
    ("Capital Expenses (CapEx)", "capex", "Coop and equipment"),
    ("Depreciation (per year)", "depreciation", "Coop and equipment/10 years"),
    ("Gross Position", "gross", "sales -spoilt goods - opex"),
    ("Net Position (with CapEx)", "net_with_capex", "Gross position - Capex"),
    ("Net Position (with Depreciation)", "net_with_depreciation", "Gross position - Depreciation (per year)"),
)

_BIRD_ITEM = re.compile(r"^(chicken|chickens|hen|hens|cock|cocks|pullet|pullets|chick|chicks|bird|birds)$", re.I)


def expense_category(item):
    """Breakdown category for an expense item. Fixed in code (the old keyword order counted
    "Transport for chicken" and "Medicine for chicken" as birds): anything that names what it is
    for (transport, medicine, feed, labour) goes there first; only an item that IS a bird purchase
    is 'Birds / Stock'."""
    it = (item or "").strip().lower()
    if "transport" in it:
        return "Transport"
    if any(k in it for k in ("medicine", "s-dime", "interflox", "dudu", "lime", "vaccine", "drug")):
        return "Medicine & Vet"
    if any(k in it for k in ("mash", "maize", "feed", "kyacu", "grower", "layer", "concentrate",
                             "sunflower", "sun flower", "milling", "broken")):
        return "Feed & Nutrition"
    if any(k in it for k in ("labour", "salary", "manager", "casual", "workshop")):
        return "Labour"
    if _BIRD_ITEM.match(it):
        return "Birds / Stock"
    return "Equipment & Supplies"


def projects_card(rows):
    """`/api/projects` shape: {label: {value: '8,976,400', desc}} computed from ledger rows."""
    st = statement(rows)
    return {lab: {"value": "{:,}".format(st[key]), "desc": desc} for lab, key, desc in STATEMENT_LABELS}


def _d(d):
    return d.strftime("%d %b %Y")


def chicken_data(rows):
    """The dict `_fetch_chicken_data` builds from the sheet, built from ledger rows instead, so the
    detail endpoint, Ask KimFam and the audit keep working unchanged when reads are switched. Dates
    are unambiguous ('17 Jun 2024'), which also fixes the old m/d/Y-only egg month parsing."""
    st = statement(rows)
    qty = qty_available(rows)
    names = {p["product_id"]: p["name"] for p in rows["products"]}
    products = {}
    for p in rows["products"]:
        pid = p["product_id"]
        products[pid] = {
            "name": p["name"], "available": float(qty.get(pid, 0)),
            "sold": float(sum(s["qty"] for s in rows["sales"] if s["product_id"] == pid)),
            "purchased": float(sum(s["qty"] for s in rows["stock"] if s["product_id"] == pid)),
            "revenue": float(sum(s["total"] for s in rows["sales"] if s["product_id"] == pid)),
            "deaths": float(sum(s["qty"] for s in rows["losses"] if s["product_id"] == pid)),
            "deaths_val": float(sum(s["total"] for s in rows["losses"] if s["product_id"] == pid)),
        }
    sales_by_product = {"a1": [], "a2": [], "a3": []}
    monthly_eggs = {}
    for s in sorted(rows["sales"], key=lambda r: r["sale_date"]):
        if s["product_id"] in sales_by_product:
            sales_by_product[s["product_id"]].append(
                {"date": _d(s["sale_date"]), "qty": float(s["qty"]), "amount": float(s["total"]), "buyer": s.get("buyer") or ""})
        if s["product_id"] == "a1":
            ym = s["sale_date"].strftime("%b %Y")
            monthly_eggs[ym] = monthly_eggs.get(ym, 0) + float(s["qty"])
    deaths_detail = [
        {"product": names.get(s["product_id"], ""), "date": _d(s["loss_date"]), "qty": float(s["qty"]), "reason": s.get("reason") or ""}
        for s in sorted(rows["losses"], key=lambda r: r["loss_date"])
        if s["product_id"] in ("a2", "a3") and (s.get("kind") or "").lower() == "damaged"]
    batches = [
        {"product": names.get(s["product_id"], ""), "date": _d(s["event_date"]), "qty": float(s["qty"]),
         "source": s.get("supplier") or "", "pid": s["product_id"]}
        for s in sorted(rows["stock"], key=lambda r: r["event_date"])
        if s["kind"] == "purchase" and s["product_id"] != "a1"]
    opex_breakdown, monthly_spend, timeline = {}, {}, []
    for e in sorted(rows["expenses"], key=lambda r: r["expense_date"]):
        if not e["total"]:
            continue
        timeline.append({"date": _d(e["expense_date"]), "item": e["item"], "cost": int(e["total"]), "type": e["kind"].capitalize()})
        ym = e["expense_date"].strftime("%b %Y")
        monthly_spend[ym] = int(monthly_spend.get(ym, 0) + e["total"])
        if e["kind"] == "opex":
            cat = expense_category(e["item"])
            opex_breakdown[cat] = int(opex_breakdown.get(cat, 0) + e["total"])
    return {
        "products": products, "sales_by_product": sales_by_product, "monthly_egg_sales": monthly_eggs,
        "deaths_detail": deaths_detail, "batches": batches,
        "financials_raw": {lab.lower(): float(st[key]) for lab, key, _d_ in STATEMENT_LABELS},
        "opex_breakdown": opex_breakdown, "monthly_spend": monthly_spend, "expense_timeline": timeline,
    }


# ── drill-down: tap a summary card to see what is behind it (ADR-032, ticket #99) ────────────────
DRILL_CARDS = ("sales", "spoilt", "opex", "capex", "stock", "expected")
_MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")
_DRILL_LABEL = {"sales": "Total sales", "spoilt": "Spoilt / lost", "opex": "Running costs (OPEX)", "capex": "Equipment (CapEx)",
                "stock": "Stock at cost", "expected": "Expected sales"}


def _drill_source(rows, card):
    """-> (records, date_key, amount_of, group_of, line_of). Each record is a ledger row."""
    names = {p["product_id"]: p["name"].capitalize() for p in rows["products"]}
    if card == "sales":
        return (rows["sales"], "sale_date", lambda r: r["total"], lambda r: names.get(r["product_id"], r["product_id"]),
                lambda r: {"title": names.get(r["product_id"], r["product_id"]), "detail": "%d at %s%s" % (r["qty"], "{:,}".format(r["unit_price"]), (" to " + r["buyer"]) if r.get("buyer") else ""), "amount": r["total"]})
    if card == "spoilt":
        return (rows["losses"], "loss_date", lambda r: r["total"], lambda r: names.get(r["product_id"], r["product_id"]),
                lambda r: {"title": names.get(r["product_id"], r["product_id"]), "detail": "%d %s: %s" % (r["qty"], (r.get("kind") or "").lower(), r.get("reason") or ""), "amount": r["total"]})
    if card in ("opex", "capex"):
        recs = [e for e in rows["expenses"] if e["kind"] == card]
        grp = (lambda r: expense_category(r["item"])) if card == "opex" else (lambda r: r["item"])
        return (recs, "expense_date", lambda r: r["total"], grp,
                lambda r: {"title": r["item"], "detail": " · ".join(x for x in ("%d × %s" % (r["qty"], "{:,}".format(r["unit_price"])) if r["qty"] else "", r.get("supplier") or "",
                           ("paid by " + r["paid_by"]) if r.get("paid_by") else "") if x), "amount": r["total"]})
    raise ValueError("unknown card")


UNITS = ("pc", "kg", "bag", "litre")


def uom_of(r):
    """Unit of measure of an expense row, normalised ('Kg' and 'kg' are one unit)."""
    u = (r.get("uom") or (r.get("raw") or {}).get("unit of measure") or "pc") if isinstance(r, dict) else "pc"
    u = str(u).strip().lower()
    return {"kgs": "kg", "kilo": "kg", "kilos": "kg", "litres": "litre", "liter": "litre", "l": "litre", "pcs": "pc", "piece": "pc", "bags": "bag"}.get(u, u) or "pc"


def drill(rows, card, group=None, year=None, month=None):
    """One level of the drill-down for a summary card. Every level sums to its parent.
    sales / spoilt / opex / capex: total, then by product (or cost category), then year, month, lines.
    stock / expected: total, then per product (quantity on hand and its value), then the movements behind it."""
    if card not in DRILL_CARDS:
        raise ValueError("unknown card")
    st = statement(rows)
    total_key = {"sales": "sales", "spoilt": "spoilt", "opex": "opex", "capex": "capex", "stock": "available_stock_cost", "expected": "expected_sales"}[card]
    crumbs = [{"label": _DRILL_LABEL[card], "params": {}}]
    if card in ("stock", "expected"):
        names = {p["product_id"]: p["name"].capitalize() for p in rows["products"]}
        per = st["per_product"]
        if group is None:
            items = [{"key": names[pid], "label": names[pid], "count": per[pid]["qty_available"],
                      "amount": per[pid]["available_stock" if card == "stock" else "expected_sales"],
                      "note": "%d in stock" % per[pid]["qty_available"]} for pid in names]
            items = [i for i in items if i["amount"] or i["count"]]
            items.sort(key=lambda i: -i["amount"])
            return {"card": card, "label": _DRILL_LABEL[card], "total": st[total_key], "level": "group", "crumbs": crumbs,
                    "rows": _shares(items, st[total_key]), "lines": []}
        pid = next((p for p, n in names.items() if n == group), None)
        mv = [{"date": s["event_date"], "title": "Stocked" if s["kind"] == "purchase" else "Collected / produced", "detail": "", "qty": s["qty"]} for s in rows["stock"] if s["product_id"] == pid]
        mv += [{"date": s["sale_date"], "title": "Sold", "detail": s.get("buyer") or "", "qty": -s["qty"]} for s in rows["sales"] if s["product_id"] == pid]
        mv += [{"date": l["loss_date"], "title": "Lost" if (l.get("kind") or "") != "Used" else "Used", "detail": l.get("reason") or "", "qty": -l["qty"]} for l in rows["losses"] if l["product_id"] == pid]
        mv.sort(key=lambda m: m["date"])
        bal = 0
        lines = []
        for m in mv:
            bal += m["qty"]
            lines.append({"date": m["date"].isoformat(), "title": m["title"], "detail": m["detail"], "amount": m["qty"], "balance": bal, "unit": "pcs"})
        lines.reverse()
        crumbs.append({"label": group, "params": {"group": group}})
        item = per.get(pid, {"qty_available": 0})
        return {"card": card, "label": _DRILL_LABEL[card], "total": per[pid]["available_stock" if card == "stock" else "expected_sales"] if pid else 0,
                "level": "movements", "crumbs": crumbs, "rows": [], "lines": lines, "qty_available": item["qty_available"]}

    recs, dkey, amount_of, group_of, line_of = _drill_source(rows, card)
    qty_of = (lambda r: r["qty"]) if card in ("sales", "spoilt") else None      # items counted only where it is meaningful
    cost = card in ("opex", "capex")                                           # costs average per unit of measure instead
    total = sum(amount_of(r) for r in recs)
    if group is None:
        bucket = {}
        for r in recs:
            b = bucket.setdefault(group_of(r), {"key": group_of(r), "label": group_of(r), "count": 0, "amount": 0, "qty": 0})
            b["count"] += 1; b["amount"] += amount_of(r); b["qty"] += qty_of(r) if qty_of else 0
            if cost:
                u = b.setdefault("_u", {}).setdefault(uom_of(r), [0, 0]); u[0] += r["qty"]; u[1] += amount_of(r)
        items = sorted(bucket.values(), key=lambda i: -i["amount"])
        return {"card": card, "label": _DRILL_LABEL[card], "total": total, "level": "group", "crumbs": crumbs, "rows": _avgs(_shares(items, total), qty_of), "lines": [], **_top(recs, amount_of, qty_of, False, cost)}
    recs = [r for r in recs if group_of(r) == group]
    crumbs.append({"label": group, "params": {"group": group}})
    gtotal = sum(amount_of(r) for r in recs)
    if year is None:
        bucket = {}
        for r in recs:
            y = r[dkey].year
            b = bucket.setdefault(y, {"key": str(y), "label": str(y), "count": 0, "amount": 0, "qty": 0})
            b["count"] += 1; b["amount"] += amount_of(r); b["qty"] += qty_of(r) if qty_of else 0
            if cost:
                u = b.setdefault("_u", {}).setdefault(uom_of(r), [0, 0]); u[0] += r["qty"]; u[1] += amount_of(r)
        items = sorted(bucket.values(), key=lambda i: -int(i["key"]))
        return {"card": card, "label": _DRILL_LABEL[card], "total": gtotal, "level": "year", "crumbs": crumbs, "rows": _avgs(_shares(items, gtotal), qty_of), "lines": [], **_top(recs, amount_of, qty_of, True, cost)}
    recs = [r for r in recs if r[dkey].year == int(year)]
    crumbs.append({"label": str(year), "params": {"group": group, "year": int(year)}})
    ytotal = sum(amount_of(r) for r in recs)
    if month is None:
        bucket = {}
        for r in recs:
            mo = r[dkey].month
            b = bucket.setdefault(mo, {"key": str(mo), "label": _MONTHS[mo - 1], "count": 0, "amount": 0, "qty": 0})
            b["count"] += 1; b["amount"] += amount_of(r); b["qty"] += qty_of(r) if qty_of else 0
            if cost:
                u = b.setdefault("_u", {}).setdefault(uom_of(r), [0, 0]); u[0] += r["qty"]; u[1] += amount_of(r)
        items = sorted(bucket.values(), key=lambda i: -int(i["key"]))
        return {"card": card, "label": _DRILL_LABEL[card], "total": ytotal, "level": "month", "crumbs": crumbs, "rows": _avgs(_shares(items, ytotal), qty_of), "lines": [], **_top(recs, amount_of, qty_of, True, cost)}
    recs = sorted([r for r in recs if r[dkey].month == int(month)], key=lambda r: (r[dkey], r.get("id") or 0), reverse=True)
    crumbs.append({"label": _MONTHS[int(month) - 1], "params": {"group": group, "year": int(year), "month": int(month)}})
    lines = []
    for r in recs:
        ln = line_of(r)
        ln.update({"date": r[dkey].isoformat(), "id": r.get("id"), "receipt_url": r.get("receipt_url")})
        lines.append(ln)
    return {"card": card, "label": _DRILL_LABEL[card], "total": sum(amount_of(r) for r in recs), "level": "lines", "crumbs": crumbs, "rows": [], "lines": lines, **_top(recs, amount_of, qty_of, True, cost)}


def _units(recs, amount_of):
    """[{unit, qty, amount, avg}] for a set of expense rows, one entry per unit of measure, biggest spend first.
    Never mixes units: kilos, bags and litres are averaged apart."""
    acc = {}
    for r in recs:
        a = acc.setdefault(uom_of(r), [0, 0])
        a[0] += r["qty"]; a[1] += amount_of(r)
    out = [{"unit": u, "qty": q, "amount": amt, "avg": round(amt / q) if q else None} for u, (q, amt) in acc.items()]
    return sorted(out, key=lambda x: -x["amount"])


def _top(recs, amount_of, qty_of, single_product, cost=False):
    """Items and the average per item for the top card. For sales and spoilt the average is only given where the rows
    are one product (an average across eggs and hens would mean nothing). For costs the figures are per unit of
    measure (per kg, per bag, per litre, per piece)."""
    if cost:
        return {"qty": None, "avg": None, "units": _units(recs, amount_of)}
    if not qty_of:
        return {"qty": None, "avg": None, "units": []}
    q = sum(qty_of(r) for r in recs)
    return {"qty": q, "avg": round(sum(amount_of(r) for r in recs) / q) if (single_product and q) else None, "units": []}


def _avgs(items, qty_of):
    for i in items:
        i["avg"] = round(i["amount"] / i["qty"]) if (qty_of and i.get("qty")) else None
        i["units"] = sorted(({"unit": u, "qty": q, "amount": a, "avg": round(a / q) if q else None} for u, (q, a) in i.pop("_u", {}).items()),
                            key=lambda x: -x["amount"])
        if not qty_of:
            i.pop("qty", None)
    return items


def _shares(items, total):
    for i in items:
        i["share"] = round(100.0 * i["amount"] / total, 1) if total else 0
    return items


# ── flock by batch: how long each purchase has been held, and its age (ticket #98) ───────────────
def _add_months(d, n):
    y, m = divmod(d.year * 12 + d.month - 1 + n, 12)
    first = _dt.date(y, m + 1, 1)
    last = (_dt.date(y + (m + 1) // 12, (m + 1) % 12 + 1, 1) - _dt.timedelta(days=1)).day
    return first.replace(day=min(d.day, last))


def held_for(start, today):
    """Whole months and days between two dates, in words: '3 months 24 days', '2 years 1 month', '12 days'."""
    if today < start:
        return "not yet"
    months = (today.year - start.year) * 12 + (today.month - start.month)
    if _add_months(start, months) > today:
        months -= 1
    days = (today - _add_months(start, months)).days
    y, m = divmod(months, 12)
    parts = []
    if y:
        parts.append("%d year%s" % (y, "" if y == 1 else "s"))
    if m:
        parts.append("%d month%s" % (m, "" if m == 1 else "s"))
    if days or not parts:
        parts.append("%d day%s" % (days, "" if days == 1 else "s"))
    return " ".join(parts[:2]) if y else " ".join(parts)


def flock_batches(rows, today):
    """One entry per bird purchase (eggs excluded), newest first: when it arrived, how many, how long it
    has been held, and its age (age when bought + time held) where the age at purchase is known.
    Survivors per batch are NOT computed: sales and losses are not tagged to a batch yet."""
    names = {p["product_id"]: p["name"].capitalize() for p in rows["products"]}
    out = []
    for s in rows["stock"]:
        if s["kind"] != "purchase" or (names.get(s["product_id"]) or "").lower() == "eggs":
            continue
        days = max((today - s["event_date"]).days, 0)
        age0 = s.get("age_weeks")
        out.append({"id": s.get("id"), "date": s["event_date"].isoformat(), "product": names.get(s["product_id"], s["product_id"]),
                    "qty": s["qty"], "cost": s["total_cost"], "held_days": days, "held": held_for(s["event_date"], today),
                    "age_at_purchase_weeks": age0, "age_now_weeks": (age0 + days // 7) if age0 is not None else None,
                    "supplier": s.get("supplier") or ""})
    out.sort(key=lambda b: b["date"], reverse=True)
    return out


# ── seeding the lists from the AppSheet workbook (once, idempotent) ───────────────────────────────────────
REFERENCE_TABS = ("expense categories", "suppliers list", "credit buyers", "units of measure", "product categories", "shops data")


def parse_reference(tabs, parsed):
    """tabs = {title: rows} for REFERENCE_TABS; parsed = parse_snapshot() of the transactions. -> the four lists to seed.
    Names that appear in past records but not in the AppSheet's lists (the sheet kept expense beneficiaries as free text)
    are added too, so every old entry maps to a list entry."""
    def rows_of(title):
        data = tabs.get(title) or []
        if not data:
            return []
        heads = [_norm(h) for h in data[0]]
        return [{h: (r[j] if j < len(r) else "") for j, h in enumerate(heads)} for r in data[1:] if any(str(c).strip() for c in r)]
    exp = parsed["expenses"]
    kind_by, uom_by = {}, {}
    for e in exp:
        k = canon(e["item"]).lower()
        kind_by.setdefault(k, {}).setdefault(e["kind"], 0); kind_by[k][e["kind"]] += 1
        uom_by.setdefault(k, {}).setdefault(uom_of(e), 0); uom_by[k][uom_of(e)] += 1
    mode = lambda d, dflt: max(d, key=d.get) if d else dflt
    items = {}
    for r in rows_of("expense categories"):
        nm = canon(r.get("expense item"))
        if nm:
            k = nm.lower()
            items[k] = {"name": nm, "group_name": expense_category(nm), "kind": mode(kind_by.get(k, {}), "opex"),
                        "default_uom": mode(uom_by.get(k, {}), "pc"), "is_birds": bool(_BIRD_ITEM.match(nm))}
    for e in exp:                                          # anything used but not listed
        k = canon(e["item"]).lower()
        if k and k not in items:
            items[k] = {"name": canon(e["item"]), "group_name": expense_category(e["item"]), "kind": mode(kind_by.get(k, {}), "opex"),
                        "default_uom": mode(uom_by.get(k, {}), "pc"), "is_birds": bool(_BIRD_ITEM.match(canon(e["item"])))}
    buyers = {}
    for r in rows_of("credit buyers"):
        nm = canon(r.get("name of buyer"))
        if nm:
            buyers[nm.lower()] = {"name": nm, "phone": canon(r.get("contact of buyer")) or None}
    for sl in parsed["sales"]:
        nm = canon(sl["buyer"])
        if nm and nm.lower() not in buyers:
            buyers[nm.lower()] = {"name": nm, "phone": None}
    sup = {}
    for r in rows_of("suppliers list"):
        nm = canon(r.get("company name"))
        if nm:
            reg = serial_date(r.get("registration date"))
            sup[nm.lower()] = {"name": nm, "contact_name": canon(r.get("contact name")) or None, "title": canon(r.get("contact title")) or None,
                               "phone": canon(r.get("phone number")) or None, "email": canon(r.get("email address")) or None,
                               "address": canon(r.get("physical address")) or None, "country": canon(r.get("country")) or None,
                               "website": canon(r.get("website url")) or None, "payment_terms": canon(r.get("payment terms")) or None,
                               "account_number": canon(r.get("account number")) or None, "category": canon(r.get("supplier category")) or None,
                               "status": canon(r.get("status")) or "Active", "notes": canon(r.get("notes")) or None, "registered_on": reg}
    for nm in [canon(e["supplier"]) for e in exp] + [canon(st["supplier"]) for st in parsed["stock"]]:
        if nm and nm.lower() not in sup:
            sup[nm.lower()] = {"name": nm, "notes": "Added from past records (not on the AppSheet supplier list)", "status": "Active"}
    units = []
    for r in rows_of("units of measure"):
        u = canon(r.get("unit of measure")).lower()
        if u and u not in units:
            units.append(u)
    for u in SEED_UNITS:
        if u not in units:
            units.append(u)
    shops = []
    for r in rows_of("shops data"):
        nm = canon(r.get("shop name"))
        loc = re.findall(r"-?\d+(?:\.\d+)?", str(r.get("gps location") or ""))
        if nm:
            lat, lng = (float(loc[0]), float(loc[1])) if len(loc) >= 2 else (None, None)
            shops.append({"name": nm, "lat": lat, "lng": lng})
    return {"items": list(items.values()), "buyers": list(buyers.values()), "suppliers": list(sup.values()), "units": units, "shops": shops}


def import_reference(project_id, ref, who="appsheet import"):
    """Seed the lists and tie every existing entry to them. Safe to run twice: existing names are left alone.
    -> counts of what was added."""
    from db import db as _db
    if not ready():
        raise RuntimeError("ledger tables unavailable")
    added = {"items": 0, "suppliers": 0, "buyers": 0, "units": 0}
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_KEY,))
            for u in ref["units"]:
                cur.execute("INSERT INTO ledger_units (project_id, name, created_by) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING", (project_id, u, who))
                added["units"] += cur.rowcount
            for sh in ref.get("shops", []):
                cur.execute("INSERT INTO ledger_shops (project_id, created_by, source, name, lat, lng) VALUES (%s,%s,'appsheet_import',%s,%s,%s) ON CONFLICT DO NOTHING",
                            (project_id, who, sh["name"], sh["lat"], sh["lng"]))
                added["shops"] = added.get("shops", 0) + cur.rowcount
            for it in ref["items"]:
                cur.execute("INSERT INTO ledger_items (project_id, created_by, source, name, group_name, kind, default_uom, is_birds) "
                            "VALUES (%s,%s,'appsheet_import',%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                            (project_id, who, it["name"], it["group_name"], it["kind"], it["default_uom"], it["is_birds"]))
                added["items"] += cur.rowcount
            for kind, key in (("supplier", "suppliers"), ("buyer", "buyers")):
                for pr in ref[key]:
                    cols = ["name"] + [c for c in list(PARTY_FIELDS) + ["registered_on"] if pr.get(c) is not None]
                    cur.execute("INSERT INTO ledger_parties (project_id, created_by, source, kind, %s) VALUES (%%s,%%s,'appsheet_import',%%s,%s) ON CONFLICT DO NOTHING"
                                % (", ".join(cols), ", ".join(["%s"] * len(cols))), [project_id, who, kind] + [pr[c] for c in cols])
                    added[key] += cur.rowcount
            # tie existing rows to the lists by name (case-insensitive), without changing what they say
            cur.execute("UPDATE ledger_expenses e SET item_id=i.id FROM ledger_items i WHERE e.project_id=%s AND i.project_id=e.project_id AND lower(i.name)=lower(e.item) AND i.deleted_at IS NULL AND e.item_id IS NULL", (project_id,))
            cur.execute("UPDATE ledger_expenses e SET supplier_id=p.id FROM ledger_parties p WHERE e.project_id=%s AND p.project_id=e.project_id AND p.kind='supplier' AND lower(p.name)=lower(e.supplier) AND p.deleted_at IS NULL AND e.supplier_id IS NULL", (project_id,))
            cur.execute("UPDATE ledger_stock e SET supplier_id=p.id FROM ledger_parties p WHERE e.project_id=%s AND p.project_id=e.project_id AND p.kind='supplier' AND lower(p.name)=lower(e.supplier) AND p.deleted_at IS NULL AND e.supplier_id IS NULL", (project_id,))
            cur.execute("UPDATE ledger_sales e SET buyer_id=p.id FROM ledger_parties p WHERE e.project_id=%s AND p.project_id=e.project_id AND p.kind='buyer' AND lower(p.name)=lower(e.buyer) AND p.deleted_at IS NULL AND e.buyer_id IS NULL", (project_id,))
            cur.execute("UPDATE ledger_expenses SET uom=NULL WHERE FALSE")        # (units already come from each row's raw AppSheet unit)
    return added


def fetch_reference(sheet_id, service_account_path):
    snap = fetch_snapshot(sheet_id, service_account_path, tabs=REFERENCE_TABS)
    return snap


# ── database layer (ADR-032) ──────────────────────────────────────────────────────────────────
_LOCK_KEY = 778813
_READY = False

_COMMON = """
        id          SERIAL PRIMARY KEY,
        project_id  TEXT NOT NULL,
        created_by  TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        source      TEXT NOT NULL DEFAULT 'app',
        source_ref  TEXT,
        raw         JSONB,
        deleted_at  TIMESTAMPTZ,
        deleted_by  TEXT"""

_DDL = [
    """CREATE TABLE IF NOT EXISTS ledger_products (%s,
        product_id TEXT NOT NULL, name TEXT NOT NULL, uom TEXT NOT NULL DEFAULT 'pc',
        cost_price BIGINT NOT NULL DEFAULT 0, sell_price BIGINT NOT NULL DEFAULT 0,
        valuation TEXT NOT NULL DEFAULT 'cost')""" % _COMMON,
    """CREATE TABLE IF NOT EXISTS ledger_stock (%s,
        product_id TEXT NOT NULL, event_date DATE NOT NULL, qty BIGINT NOT NULL,
        unit_cost BIGINT NOT NULL DEFAULT 0, total_cost BIGINT NOT NULL DEFAULT 0,
        kind TEXT NOT NULL DEFAULT 'purchase', supplier TEXT,
        paid_by TEXT, receipt_url TEXT, age_weeks INTEGER)""" % _COMMON,
    """CREATE TABLE IF NOT EXISTS ledger_sales (%s,
        product_id TEXT NOT NULL, sale_date DATE NOT NULL, qty BIGINT NOT NULL,
        unit_price BIGINT NOT NULL DEFAULT 0, total BIGINT NOT NULL DEFAULT 0,
        buyer TEXT, payment TEXT NOT NULL DEFAULT 'Cash', receipt_url TEXT)""" % _COMMON,
    """CREATE TABLE IF NOT EXISTS ledger_losses (%s,
        product_id TEXT NOT NULL, loss_date DATE NOT NULL, qty BIGINT NOT NULL,
        total BIGINT NOT NULL DEFAULT 0, kind TEXT, reason TEXT)""" % _COMMON,
    """CREATE TABLE IF NOT EXISTS ledger_expenses (%s,
        expense_date DATE NOT NULL, item TEXT NOT NULL, supplier TEXT, qty BIGINT NOT NULL DEFAULT 0,
        unit_price BIGINT NOT NULL DEFAULT 0, total BIGINT NOT NULL DEFAULT 0,
        kind TEXT NOT NULL CHECK (kind IN ('opex','capex')), note TEXT,
        paid_by TEXT, receipt_url TEXT)""" % _COMMON,
]
_DDL += [
    """CREATE TABLE IF NOT EXISTS ledger_notes (
        id SERIAL PRIMARY KEY, project_id TEXT NOT NULL, item_key TEXT NOT NULL, body TEXT NOT NULL,
        explained BOOLEAN NOT NULL DEFAULT FALSE, author TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
    """CREATE TABLE IF NOT EXISTS ledger_reimbursements (
        id SERIAL PRIMARY KEY, project_id TEXT NOT NULL, expenditure_id INTEGER NOT NULL,
        table_name TEXT NOT NULL, row_id INTEGER NOT NULL, amount BIGINT NOT NULL,
        created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ)""",
]
_TABLES = ("ledger_products", "ledger_stock", "ledger_sales", "ledger_losses", "ledger_expenses")


_DDL_MASTER = [
    """CREATE TABLE IF NOT EXISTS ledger_parties (%s,
        kind TEXT NOT NULL CHECK (kind IN ('supplier','buyer')), name TEXT NOT NULL,
        contact_name TEXT, title TEXT, phone TEXT, email TEXT, address TEXT, country TEXT, website TEXT,
        payment_terms TEXT, account_number TEXT, category TEXT, status TEXT NOT NULL DEFAULT 'Active', notes TEXT,
        registered_on DATE)""" % _COMMON,
    """CREATE TABLE IF NOT EXISTS ledger_items (%s,
        name TEXT NOT NULL, group_name TEXT, kind TEXT NOT NULL DEFAULT 'opex' CHECK (kind IN ('opex','capex')),
        default_uom TEXT NOT NULL DEFAULT 'pc', is_birds BOOLEAN NOT NULL DEFAULT FALSE)""" % _COMMON,
    """CREATE TABLE IF NOT EXISTS ledger_shops (%s,
        name TEXT NOT NULL, lat DOUBLE PRECISION, lng DOUBLE PRECISION, radius_m INTEGER NOT NULL DEFAULT 1000,
        active BOOLEAN NOT NULL DEFAULT TRUE)""" % _COMMON,
    """CREATE TABLE IF NOT EXISTS ledger_cash_moves (%s,
        move_date DATE NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('opening','handover','banked')),
        from_holder TEXT, to_holder TEXT NOT NULL, amount BIGINT NOT NULL CHECK (amount > 0), note TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','acknowledged','rejected')),
        decided_by TEXT, decided_at TIMESTAMPTZ, decision_note TEXT, receipt_url TEXT)""" % _COMMON,
    """CREATE TABLE IF NOT EXISTS ledger_sale_payments (
        id SERIAL PRIMARY KEY, project_id TEXT NOT NULL, sale_id INTEGER NOT NULL, amount BIGINT NOT NULL,
        paid_on DATE NOT NULL, received_by TEXT NOT NULL, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
    """CREATE TABLE IF NOT EXISTS ledger_units (
        id SERIAL PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'import',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
]


def ready():
    """Create the ledger tables once per process, under an advisory lock (two workers race here).
    Never raises; returns whether the ledger is usable."""
    global _READY
    if _READY:
        return True
    try:
        from db import db as _db
        with _db() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_KEY,))
                for ddl in _DDL:
                    cur.execute(ddl)
                cur.execute("ALTER TABLE ledger_expenses ADD COLUMN IF NOT EXISTS uom TEXT")          # unit of measure, additive
                cur.execute("ALTER TABLE ledger_sales ADD COLUMN IF NOT EXISTS held_by TEXT")      # who holds the cash from a cash sale
                for ddl in _DDL_MASTER:                                                                  # reference data (ticket: dropdowns)
                    cur.execute(ddl)
                cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS ledger_parties_name_uq ON ledger_parties(project_id, kind, lower(name)) WHERE deleted_at IS NULL")
                cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS ledger_items_name_uq ON ledger_items(project_id, lower(name)) WHERE deleted_at IS NULL")
                cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS ledger_units_name_uq ON ledger_units(project_id, lower(name))")
                cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS ledger_cash_moves_dup_uq ON ledger_cash_moves(project_id, created_by, kind, coalesce(from_holder, ''), to_holder, amount, move_date) "
                            "WHERE status='pending' AND deleted_at IS NULL")
                cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS ledger_shops_name_uq ON ledger_shops(project_id, lower(name)) WHERE deleted_at IS NULL")
                for t in ("ledger_expenses", "ledger_sales", "ledger_losses", "ledger_stock"):                       # where it was recorded
                    for col in ("shop_id INTEGER", "gps_lat DOUBLE PRECISION", "gps_lng DOUBLE PRECISION", "gps_accuracy REAL",
                                "gps_note TEXT", "distance_m INTEGER", "gps_away BOOLEAN NOT NULL DEFAULT FALSE"):
                        cur.execute("ALTER TABLE %s ADD COLUMN IF NOT EXISTS %s" % (t, col))
                for alter in ("ALTER TABLE ledger_expenses ADD COLUMN IF NOT EXISTS supplier_id INTEGER",
                              "ALTER TABLE ledger_expenses ADD COLUMN IF NOT EXISTS item_id INTEGER",
                              "ALTER TABLE ledger_stock ADD COLUMN IF NOT EXISTS supplier_id INTEGER",
                              "ALTER TABLE ledger_sales ADD COLUMN IF NOT EXISTS buyer_id INTEGER",
                              "ALTER TABLE ledger_sales ADD COLUMN IF NOT EXISTS due_date DATE",
                              "ALTER TABLE ledger_sales ADD COLUMN IF NOT EXISTS paid_amount BIGINT NOT NULL DEFAULT 0",
                              "ALTER TABLE ledger_sales ADD COLUMN IF NOT EXISTS paid_on DATE"):
                    cur.execute(alter)
                cur.execute("ALTER TABLE ledger_stock ADD COLUMN IF NOT EXISTS age_weeks INTEGER")    # ticket 98, additive
                for t in _TABLES:
                    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS %s_source_ref_uq ON %s(project_id, source_ref) "
                                "WHERE source_ref IS NOT NULL" % (t, t))
                    cur.execute("CREATE INDEX IF NOT EXISTS %s_project ON %s(project_id)" % (t, t))
        _READY = True
    except Exception as _e:
        import logging
        logging.getLogger("uvicorn.error").warning("ledger tables unavailable: %s", _e)
    return _READY


def import_snapshot(project_id, snap, created_by="appsheet import"):
    """One-time, idempotent import of an AppSheet snapshot (ADR-032 decision 8). Refuses unless the
    snapshot reproduces the sheet's own Financial Statement exactly. Rows are inserted with
    source='appsheet_import' and ON CONFLICT DO NOTHING on (project_id, source_ref), so running it
    twice on the same snapshot writes nothing the second time. -> {table: rows inserted}."""
    ok, lines = parity(snap)
    if not ok:
        raise ValueError("snapshot does not reproduce the sheet's Financial Statement:\n" + "\n".join(lines))
    from psycopg2.extras import Json
    from db import db as _db
    parsed = parse_snapshot(snap)
    specs = {
        "ledger_products": ("products", ("product_id", "name", "uom", "cost_price", "sell_price", "valuation")),
        "ledger_stock": ("stock", ("product_id", "event_date", "qty", "unit_cost", "total_cost", "kind", "supplier")),
        "ledger_sales": ("sales", ("product_id", "sale_date", "qty", "unit_price", "total", "buyer", "payment")),
        "ledger_losses": ("losses", ("product_id", "loss_date", "qty", "total", "kind", "reason")),
        "ledger_expenses": ("expenses", ("expense_date", "item", "supplier", "qty", "unit_price", "total", "kind", "note")),
    }
    inserted = {}
    if not ready():
        raise RuntimeError("ledger tables unavailable")
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_KEY,))
            # Import once. A different snapshot would re-insert every row under new source_refs.
            cur.execute("SELECT count(*) FROM ledger_expenses WHERE project_id=%s AND source='appsheet_import' "
                        "AND source_ref NOT LIKE %s", (project_id, "appsheet:%s:%%" % parsed["hash"]))
            if cur.fetchone()[0]:
                raise ValueError("%s was already imported from a different AppSheet snapshot; importing again would duplicate every row" % project_id)
            for table, (key, cols) in specs.items():
                n = 0
                for row in parsed[key]:
                    cur.execute(
                        "INSERT INTO %s (project_id, created_by, source, source_ref, raw, %s) "
                        "VALUES (%%s, %%s, 'appsheet_import', %%s, %%s, %s) "
                        "ON CONFLICT (project_id, source_ref) WHERE source_ref IS NOT NULL DO NOTHING"
                        % (table, ", ".join(cols), ", ".join(["%s"] * len(cols))),
                        [project_id, created_by, row["source_ref"], Json(row.get("raw") or {})] + [row[c] for c in cols])
                    n += cur.rowcount
                inserted[table] = n
    return inserted


def load(project_id):
    """Ledger rows for a project in the same shape parse_snapshot returns, so statement() is the
    single formula path for both the import check and the live read."""
    from db import query as _q
    live = " AND deleted_at IS NULL"
    return {
        "products": _q("SELECT * FROM ledger_products WHERE project_id=%s" + live, (project_id,)),
        "stock": _q("SELECT * FROM ledger_stock WHERE project_id=%s" + live, (project_id,)),
        "sales": _q("SELECT * FROM ledger_sales WHERE project_id=%s" + live, (project_id,)),
        "losses": _q("SELECT * FROM ledger_losses WHERE project_id=%s" + live, (project_id,)),
        "expenses": _q("SELECT * FROM ledger_expenses WHERE project_id=%s" + live, (project_id,)),
    }


# ── native entry (ADR-032 decisions 2, 5) ───────────────────────────────────────────────────
LEDGER_PROJECTS = ("chicken",)
PAID_BY_FARM = "Farm cash (Solomon)"
PAID_BY_CLUB = "Club"
PAID_BY_UNKNOWN = "Unknown (check)"
FIRST_DATE = _dt.date(2024, 1, 1)
LOSS_KINDS = ("Damaged", "Used")


CLUB_ACCOUNT = "Club account"          # the Treasurer's bank account: a holder of cash like any other
HELD_PREFIX = "Held cash: "            # an expense paid from cash someone holds (not their own money)
CUSTODIANS = ("Israel", "Hellen", "Hillary")   # members who can hold farm cash besides Solomon's float


def paid_by_options(member_names):
    held = [HELD_PREFIX + m for m in member_names if m in CUSTODIANS]
    return [PAID_BY_FARM, PAID_BY_CLUB] + held + list(member_names) + [PAID_BY_UNKNOWN]


def holders(member_names=None):
    """Who can hold farm cash: Solomon's float, the custodians, or the club account. (Adding a person here is a decision:
    they can then receive, hold and spend farm cash.)"""
    return [PAID_BY_FARM] + [m for m in CUSTODIANS if member_names is None or m in member_names] + [CLUB_ACCOUNT]


def holder_login(holder):
    """The login name behind a holder string: Solomon's float is Solomon's; the club account is nobody's."""
    if holder == PAID_BY_FARM:
        return "Solomon"
    return None if holder == CLUB_ACCOUNT else holder


def holder_of_expense(paid_by):
    """The holder an expense was paid from, or None when it was paid with someone's own money / by the club."""
    p = paid_by or ""
    if p == PAID_BY_FARM:
        return PAID_BY_FARM
    if p.startswith(HELD_PREFIX):
        return p[len(HELD_PREFIX):]
    return None


def _need_date(v, today):
    try:
        d = _dt.date.fromisoformat(str(v)[:10])
    except ValueError:
        raise ValueError("Date must be a real date (YYYY-MM-DD).")
    if d > today:
        raise ValueError("Date cannot be in the future.")
    if d < FIRST_DATE:
        raise ValueError("Date is before the project began.")
    return d


MAX_AMOUNT = 10 ** 12


def _need_pos(v, what):
    n = to_int(v)
    if n <= 0:
        raise ValueError("%s must be more than zero." % what)
    if n > MAX_AMOUNT:
        raise ValueError("%s is too large." % what)
    return n


def _paid_by(v, allowed):
    v = (str(v or "")).strip()
    if not v:
        raise ValueError("Say who paid (the farm cash, Dad, the club, or a member).")
    if v not in allowed:
        raise ValueError("Unknown payer %r." % v)
    return v


def validate_expense(d, today, allowed_payers, products, units=None):
    """-> clean expense dict (+ optional bird stock effect). A purchase of birds (product_id given)
    is ONE entry with two effects: an expense line and a stock movement (ADR-032 decision 2)."""
    item = str(d.get("item") or "").strip()
    if not item:
        raise ValueError("Say what was bought.")
    kind = str(d.get("kind") or "opex").lower()
    if kind not in ("opex", "capex"):
        raise ValueError("Type must be opex or capex.")
    qty = to_int(d.get("qty")) or 1
    unit = to_int(d.get("unit_price"))
    total = to_int(d.get("total")) or qty * unit
    if total <= 0:
        raise ValueError("Amount must be more than zero.")
    out = {"expense_date": _need_date(d.get("date"), today), "item": item, "supplier": str(d.get("supplier") or "").strip(),
           "qty": qty, "unit_price": unit or total // qty, "total": total, "kind": kind,
           "note": str(d.get("note") or "").strip(), "paid_by": _paid_by(d.get("paid_by"), allowed_payers), "stock": None,
           "uom": (str(d.get("uom") or "pc").strip().lower() if str(d.get("uom") or "pc").strip().lower() in [u.lower() for u in (units or UNITS)] else "pc")}
    pid = str(d.get("product_id") or "").strip()
    if pid:
        if pid not in products:
            raise ValueError("Unknown product %r." % pid)
        n = _need_pos(d.get("stock_qty") or qty, "Number of birds")
        age_raw = d.get("age_weeks")
        age = to_int(age_raw)
        if age_raw not in (None, "") and not 0 <= age <= 150:
            raise ValueError("Age when bought must be between 0 and 150 weeks.")
        out["stock"] = {"product_id": pid, "event_date": out["expense_date"], "qty": n, "unit_cost": total // n,
                        "total_cost": total, "kind": "purchase", "supplier": out["supplier"], "paid_by": out["paid_by"],
                        "age_weeks": age if age_raw not in (None, "") else None}
    return out


def validate_sale(d, today, products, holder_names=None, require_holder=False):
    pid = str(d.get("product_id") or "").strip()
    if pid not in products:
        raise ValueError("Pick what was sold.")
    qty = _need_pos(d.get("qty"), "Quantity")
    price = to_int(d.get("unit_price")) or products[pid]["sell_price"]
    total = to_int(d.get("total")) or qty * price
    if total <= 0:
        raise ValueError("Amount must be more than zero.")
    pay, buyer, due = validate_credit(d, today)
    held = canon(d.get("held_by")) or None
    if pay == "Cash":
        if held is None and require_holder:
            raise ValueError("Say who is holding the cash from this sale.")
        if held is not None and holder_names is not None and held not in holder_names:
            raise ValueError("Unknown holder %r." % held)
    else:
        held = None                                   # credit: the holder is recorded when the money arrives
    return {"product_id": pid, "sale_date": _need_date(d.get("date"), today), "qty": qty, "unit_price": price,
            "total": total, "buyer": buyer, "payment": pay, "due_date": due, "held_by": held}


def validate_loss(d, today, products):
    pid = str(d.get("product_id") or "").strip()
    if pid not in products:
        raise ValueError("Pick what was lost.")
    kind = str(d.get("kind") or "").strip().capitalize()
    if kind not in LOSS_KINDS:
        raise ValueError("Say whether it was Damaged (died, broken) or Used (eaten).")
    reason = str(d.get("reason") or "").strip()
    if not reason:
        raise ValueError("Say what happened.")
    qty = _need_pos(d.get("qty"), "Quantity")
    total = to_int(d.get("total")) if d.get("total") not in (None, "") else qty * products[pid]["cost_price"]
    return {"product_id": pid, "loss_date": _need_date(d.get("date"), today), "qty": qty, "total": total, "kind": kind, "reason": reason}


def validate_stock(d, today, products, allowed_payers):
    """Egg production (weekly) or a purchase of stock without an expense line."""
    pid = str(d.get("product_id") or "").strip()
    if pid not in products:
        raise ValueError("Pick the product.")
    kind = str(d.get("kind") or "production").lower()
    if kind not in ("production", "purchase"):
        raise ValueError("Stock entry must be production or purchase.")
    qty = _need_pos(d.get("qty"), "Quantity")
    out = {"product_id": pid, "event_date": _need_date(d.get("date"), today), "qty": qty, "kind": kind,
           "unit_cost": 0, "total_cost": 0, "supplier": str(d.get("supplier") or "").strip(), "paid_by": None}
    if kind == "purchase":
        out["total_cost"] = _need_pos(d.get("total"), "Amount")
        out["unit_cost"] = out["total_cost"] // qty
        out["paid_by"] = _paid_by(d.get("paid_by"), allowed_payers)
    return out


_INSERT = {
    "ledger_expenses": ("expense_date", "item", "supplier", "qty", "unit_price", "total", "kind", "note", "paid_by", "uom", "item_id", "supplier_id", "shop_id", "gps_lat", "gps_lng", "gps_accuracy", "gps_note", "distance_m", "gps_away"),
    "ledger_sales": ("product_id", "sale_date", "qty", "unit_price", "total", "buyer", "payment", "buyer_id", "due_date", "held_by", "shop_id", "gps_lat", "gps_lng", "gps_accuracy", "gps_note", "distance_m", "gps_away"),
    "ledger_losses": ("product_id", "loss_date", "qty", "total", "kind", "reason", "shop_id", "gps_lat", "gps_lng", "gps_accuracy", "gps_note", "distance_m", "gps_away"),
    "ledger_stock": ("product_id", "event_date", "qty", "unit_cost", "total_cost", "kind", "supplier", "paid_by", "age_weeks", "supplier_id", "shop_id", "gps_lat", "gps_lng", "gps_accuracy", "gps_note", "distance_m", "gps_away"),
}


def insert_row(cur, table, project_id, who, source, source_ref, row):
    """One insert inside the caller's transaction. Replay-safe on (project_id, source_ref):
    returns (id, created). Source_ref None is always a new row."""
    cols = _INSERT[table]
    cur.execute(
        "INSERT INTO %s (project_id, created_by, source, source_ref, %s) VALUES (%%s,%%s,%%s,%%s,%s) "
        "ON CONFLICT (project_id, source_ref) WHERE source_ref IS NOT NULL DO NOTHING RETURNING id"
        % (table, ", ".join(cols), ", ".join(["%s"] * len(cols))),
        [project_id, who, source, source_ref] + [(bool(row.get(c)) if c == "gps_away" else row.get(c)) for c in cols])
    got = cur.fetchone()
    if got:
        return got[0], True
    cur.execute("SELECT id FROM %s WHERE project_id=%%s AND source_ref=%%s" % table, (project_id, source_ref))
    return cur.fetchone()[0], False


def record(project_id, table, row, who, source="app", source_ref=None):
    """Insert one validated entry (and its stock effect for a bird purchase). -> {id, created}."""
    from db import db as _db
    if not ready():
        raise RuntimeError("ledger tables unavailable")
    if table == "ledger_expenses" and row.get("stock") and not source_ref:
        source_ref = "app:" + __import__("uuid").uuid4().hex   # links the expense to its stock effect, so they are removed together
    with _db() as conn:
        with conn.cursor() as cur:
            resolve_names(cur, project_id, who, table, row, source)
            rid, created = insert_row(cur, table, project_id, who, source, source_ref, row)
            if created and table == "ledger_expenses" and row.get("stock"):
                insert_row(cur, "ledger_stock", project_id, who, source, (source_ref + ":stock") if source_ref else None, row["stock"])
    return {"id": rid, "created": created}


def soft_delete(project_id, table, row_id, who):
    from db import db as _db
    if table not in _INSERT:
        raise ValueError("unknown table")
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE %s SET deleted_at=now(), deleted_by=%%s WHERE id=%%s AND project_id=%%s AND deleted_at IS NULL "
                        "RETURNING source_ref" % table, (who, row_id, project_id))
            got = cur.fetchone()
            if got and table == "ledger_expenses" and got[0]:
                # a bird purchase is one entry with two effects: the flock movement goes with it
                cur.execute("UPDATE ledger_stock SET deleted_at=now(), deleted_by=%s WHERE project_id=%s AND source_ref=%s AND deleted_at IS NULL",
                            (who, project_id, got[0] + ":stock"))
            return bool(got)


# ── where it was recorded: GPS that is actually enforced (the AppSheet captured 0,0 for every entry) ──────
GPS_MAX_ACCURACY_M = 300          # a fix worse than this is refused: the phone has not found the sky yet
DEFAULT_SHOP_RADIUS_M = 1000


def haversine_m(lat1, lng1, lat2, lng2):
    """Metres between two points on the Earth."""
    import math
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2
    return int(round(2 * r * math.asin(math.sqrt(a))))


def validate_gps(d, shops, required, is_admin=False):
    """-> (columns for the entry, warning or None). `d` is the request body.
    Entries recorded in the app MUST carry a real location: a missing, 0,0 or wildly imprecise fix is refused.
    An admin may record without one by giving a reason (kept on the entry and listed in the reconciliation).
    Entries from WhatsApp (required=False) are stored without a location and listed as such."""
    g = d.get("gps") if isinstance(d.get("gps"), dict) else None
    cols = {"shop_id": None, "gps_lat": None, "gps_lng": None, "gps_accuracy": None, "gps_note": None, "distance_m": None, "gps_away": False}
    warning = None
    if g:
        try:
            lat, lng, acc = float(g.get("lat")), float(g.get("lng")), float(g.get("accuracy") or 0)
        except (TypeError, ValueError):
            raise ValueError("The location could not be read. Allow location access and try again.")
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            raise ValueError("The location is not a real place on Earth.")
        if abs(lat) < 0.0001 and abs(lng) < 0.0001:
            raise ValueError("The phone reported 0,0 (no location found). Go where there is a signal and try again.")
        if acc <= 0 or acc > GPS_MAX_ACCURACY_M:
            raise ValueError("The location is not accurate enough (%s). Wait a few seconds outdoors and try again." % ("%d m" % acc if acc else "unknown accuracy"))
        cols.update(gps_lat=lat, gps_lng=lng, gps_accuracy=round(acc, 1))
        live = [sh for sh in shops if sh.get("lat") is not None and sh.get("lng") is not None]
        want = d.get("shop_id")
        pick = next((sh for sh in live if str(sh["id"]) == str(want)), None) if want else None
        if pick is None and live:
            pick = min(live, key=lambda sh: haversine_m(lat, lng, sh["lat"], sh["lng"]))
        if pick:
            dist = haversine_m(lat, lng, pick["lat"], pick["lng"])
            cols.update(shop_id=pick["id"], distance_m=dist, gps_away=dist > (pick.get("radius_m") or DEFAULT_SHOP_RADIUS_M))
            if cols["gps_away"]:
                warning = "Recorded %.1f km from %s. If that is right, fine; otherwise check where you are." % (dist / 1000.0, pick["name"])
        return cols, warning
    if required:
        reason = canon(d.get("gps_override_reason"))
        if is_admin and len(reason) >= 5:
            cols["gps_note"] = "No location: " + reason[:200]
            if shops:
                cols["shop_id"] = shops[0]["id"]
            return cols, None
        raise ValueError("Location is required. Allow location access on your phone and try again.")
    if shops:
        cols["shop_id"] = shops[0]["id"]
    cols["gps_note"] = "No location (recorded by message)"
    return cols, None


def validate_shop(d):
    name = canon(d.get("name"))
    if not name:
        raise ValueError("A shop needs a name.")
    out = {"name": name, "lat": None, "lng": None, "radius_m": DEFAULT_SHOP_RADIUS_M}
    if d.get("lat") not in (None, "") or d.get("lng") not in (None, ""):
        try:
            out["lat"], out["lng"] = float(d.get("lat")), float(d.get("lng"))
        except (TypeError, ValueError):
            raise ValueError("Latitude and longitude must be numbers.")
        if not (-90 <= out["lat"] <= 90 and -180 <= out["lng"] <= 180) or (abs(out["lat"]) < 0.0001 and abs(out["lng"]) < 0.0001):
            raise ValueError("That is not a real location.")
    if d.get("radius_m") not in (None, ""):
        r = to_int(d.get("radius_m"))
        if not 50 <= r <= 20000:
            raise ValueError("The radius must be between 50 m and 20 km.")
        out["radius_m"] = r
    return out


def add_shop(project_id, d, who):
    from db import db as _db
    row = validate_shop(d)
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM ledger_shops WHERE project_id=%s AND lower(name)=lower(%s) AND deleted_at IS NULL", (project_id, row["name"]))
            if cur.fetchone():
                raise ValueError("%s already exists." % row["name"])
            cur.execute("INSERT INTO ledger_shops (project_id, created_by, source, name, lat, lng, radius_m) VALUES (%s,%s,'app',%s,%s,%s,%s) RETURNING id",
                        (project_id, who, row["name"], row["lat"], row["lng"], row["radius_m"]))
            return cur.fetchone()[0]


# ── reference data: items, suppliers, buyers, units (the AppSheet's pick-lists), credit sales ────────────
PARTY_FIELDS = ("contact_name", "title", "phone", "email", "address", "country", "website",
                "payment_terms", "account_number", "category", "status", "notes")
PARTY_KINDS = ("supplier", "buyer")
SEED_UNITS = ("tray", "pc", "litre", "kg", "bag")
PAYMENT_TYPES = ("Cash", "Credit")


def canon(v):
    """One spelling per thing: trimmed, single spaces. Matching ignores case, so 'layer mash' finds 'Layer mash'."""
    return re.sub(r"\s+", " ", str(v or "")).strip()


def validate_party(kind, d):
    if kind not in PARTY_KINDS:
        raise ValueError("A party is a supplier or a buyer.")
    name = canon(d.get("name"))
    if not name:
        raise ValueError("A name is required.")
    if len(name) > 120:
        raise ValueError("Name is too long.")
    out = {"name": name}
    for f in PARTY_FIELDS:
        out[f] = canon(d.get(f)) or None
    if out["email"] and "@" not in out["email"]:
        raise ValueError("That email does not look right.")
    if out["phone"] and not re.fullmatch(r"[0-9+()\-\s]{6,20}", out["phone"]):
        raise ValueError("Phone should be digits (with + or spaces), 6 to 20 characters.")
    st = (out["status"] or "Active").capitalize()
    if st not in ("Active", "Inactive"):
        raise ValueError("Status is Active or Inactive.")
    out["status"] = st
    reg = d.get("registered_on")
    out["registered_on"] = None
    if reg:
        try:
            out["registered_on"] = _dt.date.fromisoformat(str(reg)[:10])
        except ValueError:
            raise ValueError("Registration date must be a real date.")
    return out


def validate_item(d, units):
    name = canon(d.get("name"))
    if not name:
        raise ValueError("A name is required.")
    kind = str(d.get("kind") or "opex").lower()
    if kind not in ("opex", "capex"):
        raise ValueError("An item is a running cost (opex) or equipment (capex).")
    uom = canon(d.get("default_uom") or "pc").lower()
    if units and uom not in [u.lower() for u in units]:
        raise ValueError("Unknown unit %r." % uom)
    return {"name": name, "group_name": canon(d.get("group_name")) or expense_category(name), "kind": kind,
            "default_uom": uom, "is_birds": bool(d.get("is_birds"))}


def validate_unit(d, units):
    name = canon(d.get("name")).lower()
    if not name or len(name) > 20:
        raise ValueError("A unit is a short word such as kg, bag or tray.")
    if name in [u.lower() for u in units]:
        raise ValueError("That unit already exists.")
    return {"name": name}


def _get_or_create(cur, table, project_id, who, name, create_cols, source="app"):
    """Match by name ignoring case; create when missing (the 'add new' that keeps the lists growing but consistent).
    -> (id, canonical name, created)."""
    name = canon(name)
    cur.execute("SELECT id, name FROM %s WHERE project_id=%%s AND lower(name)=lower(%%s) AND deleted_at IS NULL" % table, (project_id, name))
    got = cur.fetchone()
    if got:
        return got[0], got[1], False
    cols = ["project_id", "created_by", "source", "name"] + list(create_cols)
    vals = [project_id, who, source, name] + [create_cols[c] for c in create_cols]
    cur.execute("INSERT INTO %s (%s) VALUES (%s) RETURNING id" % (table, ", ".join(cols), ", ".join(["%s"] * len(cols))), vals)
    return cur.fetchone()[0], name, True


def resolve_names(cur, project_id, who, table, row, source):
    """Inside the entry's transaction: tie the typed item / supplier / buyer to the shared lists, creating a missing
    one on the spot, and put the canonical spelling back on the row so analysis groups cleanly."""
    if table == "ledger_expenses":
        if row.get("item"):
            iid, nm, _c = _get_or_create(cur, "ledger_items", project_id, who, row["item"],
                                         {"group_name": expense_category(row["item"]), "kind": row.get("kind") or "opex",
                                          "default_uom": row.get("uom") or "pc", "is_birds": bool(row.get("stock"))}, source)
            row["item_id"], row["item"] = iid, nm
        if row.get("supplier"):
            sid, nm, _c = _get_or_create(cur, "ledger_parties", project_id, who, row["supplier"], {"kind": "supplier"}, source)
            row["supplier_id"], row["supplier"] = sid, nm
            if row.get("stock"):
                row["stock"]["supplier"], row["stock"]["supplier_id"] = nm, sid
    elif table == "ledger_stock" and row.get("supplier"):
        sid, nm, _c = _get_or_create(cur, "ledger_parties", project_id, who, row["supplier"], {"kind": "supplier"}, source)
        row["supplier_id"], row["supplier"] = sid, nm
    elif table == "ledger_sales" and row.get("buyer"):
        bid, nm, _c = _get_or_create(cur, "ledger_parties", project_id, who, row["buyer"], {"kind": "buyer"}, source)
        row["buyer_id"], row["buyer"] = bid, nm


def masterdata(project_id):
    """All four lists, for the dropdowns and the Lists tab."""
    from db import query as _q
    live = " AND deleted_at IS NULL"
    return {
        "items": _q("SELECT id, name, group_name, kind, default_uom, is_birds FROM ledger_items WHERE project_id=%s" + live + " ORDER BY lower(name)", (project_id,)),
        "suppliers": _q("SELECT id, name, " + ", ".join(PARTY_FIELDS) + ", registered_on FROM ledger_parties WHERE project_id=%s AND kind='supplier'" + live + " ORDER BY lower(name)", (project_id,)),
        "buyers": _q("SELECT id, name, " + ", ".join(PARTY_FIELDS) + ", registered_on FROM ledger_parties WHERE project_id=%s AND kind='buyer'" + live + " ORDER BY lower(name)", (project_id,)),
        "units": [r["name"] for r in _q("SELECT name FROM ledger_units WHERE project_id=%s ORDER BY id", (project_id,))],
        "shops": _q("SELECT id, name, lat, lng, radius_m, active FROM ledger_shops WHERE project_id=%s" + live + " ORDER BY id", (project_id,)),
    }


def add_party(project_id, kind, d, who):
    from db import db as _db
    row = validate_party(kind, d)
    cols = ("name",) + PARTY_FIELDS + ("registered_on",)
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM ledger_parties WHERE project_id=%s AND kind=%s AND lower(name)=lower(%s) AND deleted_at IS NULL", (project_id, kind, row["name"]))
            if cur.fetchone():
                raise ValueError("%s already exists." % row["name"])
            cur.execute("INSERT INTO ledger_parties (project_id, created_by, source, kind, %s) VALUES (%%s,%%s,'app',%%s,%s) RETURNING id"
                        % (", ".join(cols), ", ".join(["%s"] * len(cols))), [project_id, who, kind] + [row[c] for c in cols])
            return cur.fetchone()[0]


def update_party(project_id, party_id, d, who):
    from db import db as _db
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT kind FROM ledger_parties WHERE id=%s AND project_id=%s AND deleted_at IS NULL", (party_id, project_id))
            got = cur.fetchone()
            if not got:
                return False
            row = validate_party(got[0], d)
            cols = ("name",) + PARTY_FIELDS + ("registered_on",)
            cur.execute("UPDATE ledger_parties SET %s WHERE id=%%s" % ", ".join("%s=%%s" % c for c in cols), [row[c] for c in cols] + [party_id])
            return True


def add_item(project_id, d, who, units):
    from db import db as _db
    row = validate_item(d, units)
    with _db() as conn:
        with conn.cursor() as cur:
            iid, _nm, created = _get_or_create(cur, "ledger_items", project_id, who, row["name"],
                                               {"group_name": row["group_name"], "kind": row["kind"], "default_uom": row["default_uom"], "is_birds": row["is_birds"]})
            if not created:
                raise ValueError("%s already exists." % row["name"])
            return iid


def add_unit(project_id, d, who):
    from db import db as _db
    units = [u for u in masterdata(project_id)["units"]]
    row = validate_unit(d, units)
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO ledger_units (project_id, name, created_by) VALUES (%s,%s,%s)", (project_id, row["name"], who))
    return row["name"]


def retire(project_id, kind, row_id, who):
    """Soft-delete a list entry (items and parties). Past entries keep their spelling; the dropdown stops offering it."""
    from db import db as _db
    table = {"item": "ledger_items", "supplier": "ledger_parties", "buyer": "ledger_parties"}[kind]
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE %s SET deleted_at=now(), deleted_by=%%s WHERE id=%%s AND project_id=%%s AND deleted_at IS NULL" % table, (who, row_id, project_id))
            return cur.rowcount == 1


# credit sales: a sale to a named buyer, paid later (the AppSheet's 'type of sale' and 'proposed payment date')
def validate_credit(d, today):
    """-> (payment, buyer, due_date). Credit needs a buyer; the due date is optional but cannot be in the past."""
    pay = canon(d.get("payment") or "Cash").capitalize()
    if pay not in PAYMENT_TYPES:
        raise ValueError("A sale is Cash or Credit.")
    buyer = canon(d.get("buyer"))
    due = None
    if pay == "Credit":
        if not buyer:
            raise ValueError("A credit sale needs the buyer's name.")
        if d.get("due_date"):
            try:
                due = _dt.date.fromisoformat(str(d["due_date"])[:10])
            except ValueError:
                raise ValueError("The due date must be a real date.")
            if due < today:
                raise ValueError("The due date is in the past.")
    return pay, buyer, due


def receivables(rows, today):
    """Credit sales not yet fully paid, per buyer: what the farm is owed. Cash sales are never owed."""
    by = {}
    for s in rows["sales"]:
        if (s.get("payment") or "Cash") != "Credit":
            continue
        owed = s["total"] - (s.get("paid_amount") or 0)
        if owed <= 0:
            continue
        b = by.setdefault(s.get("buyer") or "(no name)", {"buyer": s.get("buyer") or "(no name)", "owed": 0, "count": 0, "overdue": 0, "oldest": None})
        b["owed"] += owed; b["count"] += 1
        due = s.get("due_date")
        if due and due < today:
            b["overdue"] += owed
        d0 = s["sale_date"]
        b["oldest"] = d0 if b["oldest"] is None or d0 < b["oldest"] else b["oldest"]
    out = sorted(by.values(), key=lambda b: -b["owed"])
    for b in out:
        b["oldest"] = b["oldest"].isoformat() if b["oldest"] else None
    return {"total": sum(b["owed"] for b in out), "overdue": sum(b["overdue"] for b in out), "buyers": out}


def record_payment(project_id, sale_id, amount, when, who, today, received_by=None, holder_names=None):
    """Money received on a credit sale. Never more than is owed. -> {'owed': remaining}."""
    from db import db as _db
    amt = _need_pos(amount, "Amount")
    d = _need_date(when or today.isoformat(), today)
    rb = canon(received_by) or None
    if holder_names is not None and (rb is None or rb not in holder_names):
        raise ValueError("Say who received the money.")
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT total, paid_amount, payment FROM ledger_sales WHERE id=%s AND project_id=%s AND deleted_at IS NULL FOR UPDATE", (sale_id, project_id))
            got = cur.fetchone()
            if not got:
                raise LookupError("Sale not found")
            total, paid, pay = got
            if pay != "Credit":
                raise ValueError("That sale was paid in cash.")
            if amt > total - paid:
                raise ValueError("That is more than is owed (%s)." % "{:,}".format(total - paid))
            cur.execute("UPDATE ledger_sales SET paid_amount=paid_amount+%s, paid_on=%s WHERE id=%s", (amt, d, sale_id))
            cur.execute("INSERT INTO ledger_sale_payments (project_id, sale_id, amount, paid_on, received_by, created_by) VALUES (%s,%s,%s,%s,%s,%s)",
                        (project_id, sale_id, amt, d, rb or PAID_BY_FARM, who))
            return {"owed": total - paid - amt}


# ── cash custody: who is holding the farm's cash (ADR-035) ───────────────────────────────────────────────
# The same shape as monthly contributions: a person SUBMITS (a handover or a banking, with a slip), the receiver
# ACKNOWLEDGES, and only an acknowledged move counts as received. Nobody acknowledges their own submission.
MOVE_KINDS = ("opening", "handover", "banked")


def validate_move(d, today, holder_names):
    kind = canon(d.get("kind")).lower()
    if kind not in MOVE_KINDS:
        raise ValueError("A cash move is an opening declaration, a handover or a banking.")
    to = canon(d.get("to_holder"))
    frm = canon(d.get("from_holder")) or None
    if to not in holder_names:
        raise ValueError("Say who the cash went to.")
    if kind == "opening":
        frm = None                                    # it comes from the AppSheet-period sales, not from a person
    else:
        if frm not in holder_names:
            raise ValueError("Say who the cash came from.")
        if frm == to:
            raise ValueError("From and to cannot be the same.")
        if frm == CLUB_ACCOUNT:
            raise ValueError("Money leaves the club account through the Treasurer's expense record, not here.")
    if kind == "banked" and to != CLUB_ACCOUNT:
        raise ValueError("Banking means paying into the club account.")
    return {"kind": kind, "from_holder": frm, "to_holder": to, "amount": _need_pos(d.get("amount"), "Amount"),
            "move_date": _need_date(d.get("date"), today), "note": canon(d.get("note")) or None}


def can_acknowledge(move, who, name, is_admin, treasurer_names=("Hellen",)):
    """Separation of duties for cash. Nobody acknowledges money they are a party to: not the submitter (`who` is the display
    name stored as created_by), not the giver (from_holder), not the holder in an opening declaration. `name` is the login name.
      * club account: the Treasurer, or an admin who is not a party to it
      * a person receiving a handover: that person only (an admin cannot attest to someone else's receipt)
      * an opening declaration: an admin who is not the submitter or the holder"""
    if move["status"] != "pending" or move.get("created_by") == who or not name:
        return False
    if name == holder_login(move.get("from_holder")):
        return False
    if move["kind"] == "opening":
        return is_admin and name != holder_login(move["to_holder"])
    if move["to_holder"] == CLUB_ACCOUNT:
        return is_admin or name in treasurer_names
    return name == holder_login(move["to_holder"])


def check_opening_cap(amount, unassigned, pending_openings):
    """An opening declaration can only assign cash that has no recorded holder, never more (it would create money)."""
    room = max(unassigned - pending_openings, 0)
    if amount > room:
        raise ValueError("That is more than the cash with no recorded holder (%s)." % "{:,}".format(room))


def cash_position(rows, moves, payments, holder_names):
    """Where the farm's cash is. Received: cash sales and credit payments (to whoever recorded as holding them).
    Moves: a handover or banking leaves the sender when submitted and arrives when acknowledged. Spent: expenses
    paid from a holder's cash. -> {holders:[...], unassigned, pending:[...], total_held_outside_club}."""
    h = {n: {"holder": n, "received": 0, "moved_in": 0, "moved_out": 0, "spent": 0, "in_transit_in": 0, "in_transit_out": 0} for n in holder_names}

    def get(n):
        return h.setdefault(n, {"holder": n, "received": 0, "moved_in": 0, "moved_out": 0, "spent": 0, "in_transit_in": 0, "in_transit_out": 0})
    unassigned = 0
    for sl in rows["sales"]:
        if (sl.get("payment") or "Cash") != "Cash":
            continue
        if sl.get("held_by"):
            get(sl["held_by"])["received"] += sl["total"]
        else:
            unassigned += sl["total"]
    for pm in payments or []:
        get(pm["received_by"])["received"] += pm["amount"]
    opening_ack = 0
    for m in moves or []:
        if m["status"] == "rejected":
            continue
        if m["kind"] == "opening":
            if m["status"] == "acknowledged":
                get(m["to_holder"])["moved_in"] += m["amount"]; opening_ack += m["amount"]
            else:
                get(m["to_holder"])["in_transit_in"] += m["amount"]
            continue
        get(m["from_holder"])["moved_out"] += m["amount"]          # it has left the sender's hands either way
        if m["status"] == "acknowledged":
            get(m["to_holder"])["moved_in"] += m["amount"]
        else:
            get(m["to_holder"])["in_transit_in"] += m["amount"]; get(m["from_holder"])["in_transit_out"] += m["amount"]
    for e in rows["expenses"]:
        src = holder_of_expense(e.get("paid_by"))
        if src:
            get(src)["spent"] += e["total"]
    out = []
    for n, x in h.items():
        x["balance"] = x["received"] + x["moved_in"] - x["moved_out"] - x["spent"]
        if any(v for k, v in x.items() if k != "holder") or n in holder_names:
            out.append(x)
    held_outside = sum(max(x["balance"], 0) for x in out if x["holder"] != CLUB_ACCOUNT)
    return {"holders": out, "unassigned": max(unassigned - opening_ack, 0), "unassigned_total": unassigned,
            "over_declared": max(opening_ack - unassigned, 0), "pending_openings": sum(m["amount"] for m in (moves or []) if m["kind"] == "opening" and m["status"] == "pending"),
            "pending": [m for m in (moves or []) if m["status"] == "pending"], "held_outside_club": held_outside}


def check_giver(row, name, is_admin):
    """The person whose cash goes down is the one who submits the move; an admin may submit for someone else, with a note."""
    if row["kind"] != "opening" and holder_login(row["from_holder"]) != name:
        if not (is_admin and row["note"] and len(row["note"]) >= 5):
            raise ValueError("Only the person handing the cash over submits it. An admin may submit for someone else with a note saying why.")


def submit_move(project_id, d, who, name, is_admin, today, holder_names):
    """Submit a move. The person handing cash over is the one who submits it (an admin may submit for someone else, with
    a note saying why). An opening declaration cannot exceed the cash with no recorded holder."""
    from db import db as _db
    row = validate_move(d, today, holder_names)
    check_giver(row, name, is_admin)
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_KEY + 1,))        # one cash submission at a time
            if row["kind"] == "opening":
                rows = load(project_id)
                moves, payments = load_cash(project_id)
                pos = cash_position(rows, moves, payments, holder_names)
                check_opening_cap(row["amount"], pos["unassigned"], pos["pending_openings"])
            try:
                cur.execute("INSERT INTO ledger_cash_moves (project_id, created_by, source, move_date, kind, from_holder, to_holder, amount, note) "
                            "VALUES (%s,%s,'app',%s,%s,%s,%s,%s,%s) RETURNING id",
                            (project_id, who, row["move_date"], row["kind"], row["from_holder"], row["to_holder"], row["amount"], row["note"]))
            except Exception as e:                                                    # the unique index on identical pending submissions
                if "ledger_cash_moves_dup_uq" in str(e):
                    raise ValueError("You already submitted exactly this and it is still waiting.")
                raise
            return cur.fetchone()[0]


def decide_move(project_id, move_id, approve, note, who, name, is_admin):
    """Acknowledge or reject a pending move, under the rules in can_acknowledge. -> new status."""
    from db import db as _db
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT kind, to_holder, status, created_by, from_holder FROM ledger_cash_moves WHERE id=%s AND project_id=%s AND deleted_at IS NULL FOR UPDATE", (move_id, project_id))
            got = cur.fetchone()
            if not got:
                raise LookupError("Not found")
            m = {"kind": got[0], "to_holder": got[1], "status": got[2], "created_by": got[3], "from_holder": got[4]}
            if m["status"] != "pending":
                raise ValueError("That move has already been %s." % m["status"])
            if not can_acknowledge(m, who, name, is_admin):
                raise PermissionError("You cannot acknowledge this one: not your own submission, not cash you hold or hand over. The receiver or the Treasurer does.")
            st = "acknowledged" if approve else "rejected"
            cur.execute("UPDATE ledger_cash_moves SET status=%s, decided_by=%s, decided_at=now(), decision_note=%s WHERE id=%s", (st, who, canon(note) or None, move_id))
            return st


def load_cash(project_id):
    from db import query as _q
    return (_q("SELECT * FROM ledger_cash_moves WHERE project_id=%s AND deleted_at IS NULL ORDER BY move_date DESC, id DESC", (project_id,)),
            _q("SELECT p.sale_id, p.amount, p.paid_on, p.received_by FROM ledger_sale_payments p JOIN ledger_sales s ON s.id=p.sale_id AND s.deleted_at IS NULL WHERE p.project_id=%s", (project_id,)))


# ── reconciliation (ADR-032 decisions 4-6) ──────────────────────────────────────────────────
def bird_open_items(rows):
    """Bird purchases that appear in only one place, or on different dates. A bird purchase is
    one expense line AND one stock movement; matching is by amount, nearest date first.
    -> [{key, title, amount, detail}]."""
    exps = [e for e in rows["expenses"] if expense_category(e["item"]) == "Birds / Stock"]
    stk = [s for s in rows["stock"] if s["kind"] == "purchase"]
    pairs = sorted(((abs((e["expense_date"] - s["event_date"]).days), i, j) for i, e in enumerate(exps) for j, s in enumerate(stk)
                    if e["total"] == s["total_cost"]))
    used_e, used_s, items = set(), set(), []
    for diff, i, j in pairs:
        if i in used_e or j in used_s:
            continue
        used_e.add(i); used_s.add(j)
        if diff > 3:
            e, s = exps[i], stk[j]
            items.append({"key": "birds:date:%s" % e.get("id", i), "title": "Bird purchase dates differ by %d days" % diff,
                          "amount": e["total"], "detail": "Expense dated %s, stock entry dated %s (same amount)." % (_d(e["expense_date"]), _d(s["event_date"]))})
    for i, e in enumerate(exps):
        if i not in used_e:
            items.append({"key": "birds:expense_only:%s" % e.get("id", i), "title": "Birds bought but not in the flock",
                          "amount": e["total"], "detail": "%s: %s, %d at %s each. In expenses, no matching stock entry." % (_d(e["expense_date"]), e["item"], e["qty"], "{:,}".format(e["unit_price"]))})
    for j, s in enumerate(stk):
        if j not in used_s:
            items.append({"key": "birds:stock_only:%s" % s.get("id", j), "title": "Birds in the flock with no expense",
                          "amount": s["total_cost"], "detail": "%s: %d birds at %s each. In stock, no matching expense." % (_d(s["event_date"]), s["qty"], "{:,}".format(s["unit_cost"]))})
    return items


def classify_treasury(r):
    """Club treasury row for the project -> capital | pay | refund | other."""
    d = (r.get("description") or "").lower()
    if d.startswith("refund") or "reimburs" in d:
        return "refund"
    if r.get("category") == "staff" or " pay" in d:
        return "pay"
    if r.get("category") == "project_investment" and (r.get("recorded_by") == "system_import" or "capital" in d or "investment" in d):
        return "capital"
    return "other"


def build_reconciliation(rows, treasury, links, notes, moves=None, payments=None, holder_names=None):
    """Pure. rows = ledger rows, treasury = club expenditure rows for the project, links =
    reimbursement links [{expenditure_id, amount}], notes = [{item_key, body, explained, author, created_at}].
    Two accounts, never merged: the farm cash box (the ledger) and the club treasury."""
    st = statement(rows)
    kinds = {t["id"]: classify_treasury(t) for t in treasury}
    capital = sum(t["amount_ugx"] for t in treasury if kinds[t["id"]] == "capital")
    owed = receivables(rows, _dt.date.today())["total"]                     # credit sales not yet paid are not cash in
    cash_in = capital + st["sales"] - owed
    cash_out = st["opex"] + st["capex"]
    by_key = {}
    for n in sorted(notes, key=lambda n: n["created_at"]):
        by_key.setdefault(n["item_key"], []).append(n)
    linked = {}
    for l in links:
        linked[l["expenditure_id"]] = linked.get(l["expenditure_id"], 0) + l["amount"]

    def item(key, title, amount, detail, explained=False):
        ns = by_key.get(key, [])
        done = explained or bool(ns and ns[-1]["explained"])
        return {"key": key, "title": title, "amount": amount, "detail": detail, "explained": done,
                "notes": [{"body": n["body"], "author": n["author"], "at": n["created_at"], "explained": n["explained"]} for n in ns]}

    items = []
    for t in treasury:
        k = kinds[t["id"]]
        if k in ("refund", "other"):
            cov = linked.get(t["id"], 0)
            items.append(item("treasury:%d" % t["id"],
                              "%s paid by the club" % ("Refund" if k == "refund" else "Payment"), t["amount_ugx"],
                              "%s, %s (recorded by %s). Backed by %s of expense lines." % (_d(t["txn_date"]), t["description"], t.get("recorded_by") or "?", "{:,}".format(cov)),
                              explained=cov >= t["amount_ugx"]))
    for b in bird_open_items(rows):
        items.append(item(b["key"], b["title"], b["amount"], b["detail"]))
    pre = [e for e in rows["expenses"] if not e.get("paid_by")]
    if pre:
        items.append(item("preledger:unattributed", "Who paid is not recorded for the AppSheet period",
                          sum(e["total"] for e in pre),
                          "%d expense lines from the AppSheet carry no payer and no receipt. Treated as one opening item." % len(pre)))
    native = [e for k in ("expenses", "sales", "losses", "stock") for e in rows[k] if e.get("source") != "appsheet_import"]
    noloc = [e for e in native if e.get("gps_lat") is None]
    if noloc:
        items.append(item("gps:missing", "Entries without a location", len(noloc),
                          "%d entries recorded since the ledger went live carry no GPS location (recorded by message, or an admin override with a reason)." % len(noloc)))
    away = [e for e in native if e.get("gps_away")]
    if away:
        items.append(item("gps:away", "Entries recorded away from the farm", len(away),
                          "%d entries were recorded more than the shop's radius from its location. Fine when travelling to buy or sell; worth a look otherwise." % len(away)))
    nr = [e for e in rows["expenses"] if e.get("source") != "appsheet_import" and not e.get("receipt_url")]
    if nr:
        items.append(item("receipts:missing", "Expenses without a receipt", sum(e["total"] for e in nr),
                          "%d expense lines recorded in the Hub have no receipt photo yet." % len(nr)))
    gap = cash_out - cash_in
    items.append(item("gap", "Farm spent more than it was given and earned" if gap > 0 else "Farm holds more than it spent",
                      abs(gap), "Capital %s + sales %s in, opex %s + capex %s out." % tuple("{:,}".format(x) for x in (capital, st["sales"], st["opex"], st["capex"]))))
    cash = cash_position(rows, moves, payments, holder_names or [PAID_BY_FARM, CLUB_ACCOUNT])
    if cash["unassigned"] > 0:
        items.append(item("cash:unassigned", "Cash sales with no recorded holder", cash["unassigned"],
                          "%s of cash sales (the AppSheet period and sales recorded by message) have no recorded holder. Declare who holds it under Cash, "
                          "then the Treasurer acknowledges." % "{:,}".format(cash["unassigned"])))
    if cash["over_declared"] > 0:
        items.append(item("cash:over-declared", "More cash declared than was sold", cash["over_declared"],
                          "Acknowledged opening declarations exceed the cash sales with no recorded holder by %s. Some of it did not come from sales." % "{:,}".format(cash["over_declared"])))
    for m in cash["pending"]:
        items.append(item("cash:pending:%d" % m["id"], "Waiting for acknowledgement", m["amount"],
                          "%s: %s to %s, submitted by %s on %s." % (m["kind"].capitalize(), m.get("from_holder") or "AppSheet-period sales", m["to_holder"], m.get("created_by"), _d(m["move_date"]))))
    for x in cash["holders"]:
        if x["balance"] < 0 and x["holder"] != CLUB_ACCOUNT:
            items.append(item("cash:negative:" + x["holder"], "Spent more cash than is recorded as held", -x["balance"],
                              "%s has spent %s from held cash but is recorded as receiving %s. Either some receipts or handovers are missing, or it was paid with their own money." % (x["holder"], "{:,}".format(x["spent"]), "{:,}".format(x["received"] + x["moved_in"]))))
    pay = {}
    for e in rows["expenses"]:
        w = e.get("paid_by") or "Pre-ledger, unattributed"
        b = pay.setdefault(w, {"who": w, "count": 0, "total": 0})
        b["count"] += 1; b["total"] += e["total"]
    return {
        "statement": {k: v for k, v in st.items() if k != "per_product"},
        "farm_box": {"in": {"capital": capital, "sales": st["sales"] - owed, "owed_by_buyers": owed, "total": cash_in},
                     "out": {"opex": st["opex"], "capex": st["capex"], "total": cash_out}, "gap": gap},
        "treasury": [{"id": t["id"], "date": _d(t["txn_date"]), "description": t["description"], "amount": t["amount_ugx"],
                      "kind": kinds[t["id"]], "recorded_by": t.get("recorded_by")} for t in treasury],
        "paid_by": sorted(pay.values(), key=lambda b: -b["total"]),
        "custody": {"holders": cash["holders"], "held_outside_club": cash["held_outside_club"], "unassigned": cash["unassigned"]},
        "open_items": items,
        "open_count": sum(1 for i in items if not i["explained"]),
    }


def reconciliation(project_id):
    from db import query as _q
    rows = load(project_id)
    treasury = _q("SELECT id, txn_date, description, amount_ugx, category, recorded_by FROM expenditure_records "
                  "WHERE project=%s ORDER BY txn_date, id", (project_id,))
    links = _q("SELECT expenditure_id, amount FROM ledger_reimbursements WHERE project_id=%s AND deleted_at IS NULL", (project_id,))
    notes = _q("SELECT item_key, body, explained, author, created_at FROM ledger_notes WHERE project_id=%s", (project_id,))
    moves = _q("SELECT * FROM ledger_cash_moves WHERE project_id=%s AND deleted_at IS NULL ORDER BY move_date, id", (project_id,))
    payments = _q("SELECT p.sale_id, p.amount, p.paid_on, p.received_by FROM ledger_sale_payments p JOIN ledger_sales s ON s.id=p.sale_id AND s.deleted_at IS NULL WHERE p.project_id=%s", (project_id,))
    return build_reconciliation(rows, treasury, links, notes, moves, payments)


def fetch_snapshot(sheet_id, service_account_path, tabs=None):
    """Read the AppSheet workbook's tabs with UNFORMATTED values (serial dates, plain numbers)."""
    import gspread
    from google.oauth2.service_account import Credentials
    creds = Credentials.from_service_account_file(service_account_path, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"])
    import time

    def once():
        sh = gspread.authorize(creds).open_by_key(sheet_id)
        return {t: sh.worksheet(t).get_all_values(value_render_option="UNFORMATTED_VALUE") for t in (tabs or TABS)}
    for attempt in range(5):                     # Google answers 503 now and then
        try:
            return once()
        except gspread.exceptions.APIError:
            if attempt == 4:
                raise
            time.sleep(5 * (attempt + 1))


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "snapshot":          # snapshot <sheet_id> <out.json>   (run in the app dir)
        _snap = fetch_snapshot(sys.argv[2], "service-account.json")
        with open(sys.argv[3], "w") as f:
            json.dump(_snap, f)
        print("snapshot", snapshot_hash(_snap), {k: len(v) for k, v in _snap.items()})
        sys.exit(0)
    if len(sys.argv) == 4 and sys.argv[1] == "import-reference":  # import-reference <project> <sheet_id>  (app dir, needs DATABASE_URL)
        _tabs = fetch_reference(sys.argv[3], "service-account.json")
        _rows = load(sys.argv[2])
        _parsed = {"expenses": [dict(e, uom=e.get("uom")) for e in _rows["expenses"]], "sales": _rows["sales"], "stock": _rows["stock"]}
        _ref = parse_reference(_tabs, _parsed)
        print(import_reference(sys.argv[2], _ref), {k: len(v) for k, v in _ref.items()})
        sys.exit(0)
    if len(sys.argv) == 4 and sys.argv[1] == "import":            # import <project> <snapshot.json>  (needs DATABASE_URL)
        with open(sys.argv[3]) as f:
            print(import_snapshot(sys.argv[2], json.load(f)))
        sys.exit(0)
    if len(sys.argv) == 3 and sys.argv[1] == "parity":
        with open(sys.argv[2]) as f:
            _ok, _lines = parity(json.load(f))
        print("\n".join(_lines))
        print("PARITY", "OK" if _ok else "FAILED")
        sys.exit(0 if _ok else 1)
    print(__doc__)
