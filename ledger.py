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
        paid_by TEXT, receipt_url TEXT)""" % _COMMON,
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


def paid_by_options(member_names):
    return [PAID_BY_FARM, PAID_BY_CLUB] + list(member_names) + [PAID_BY_UNKNOWN]


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


def _need_pos(v, what):
    n = to_int(v)
    if n <= 0:
        raise ValueError("%s must be more than zero." % what)
    return n


def _paid_by(v, allowed):
    v = (str(v or "")).strip()
    if not v:
        raise ValueError("Say who paid (the farm cash, Dad, the club, or a member).")
    if v not in allowed:
        raise ValueError("Unknown payer %r." % v)
    return v


def validate_expense(d, today, allowed_payers, products):
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
           "note": str(d.get("note") or "").strip(), "paid_by": _paid_by(d.get("paid_by"), allowed_payers), "stock": None}
    pid = str(d.get("product_id") or "").strip()
    if pid:
        if pid not in products:
            raise ValueError("Unknown product %r." % pid)
        n = _need_pos(d.get("stock_qty") or qty, "Number of birds")
        out["stock"] = {"product_id": pid, "event_date": out["expense_date"], "qty": n, "unit_cost": total // n,
                        "total_cost": total, "kind": "purchase", "supplier": out["supplier"], "paid_by": out["paid_by"]}
    return out


def validate_sale(d, today, products):
    pid = str(d.get("product_id") or "").strip()
    if pid not in products:
        raise ValueError("Pick what was sold.")
    qty = _need_pos(d.get("qty"), "Quantity")
    price = to_int(d.get("unit_price")) or products[pid]["sell_price"]
    total = to_int(d.get("total")) or qty * price
    if total <= 0:
        raise ValueError("Amount must be more than zero.")
    return {"product_id": pid, "sale_date": _need_date(d.get("date"), today), "qty": qty, "unit_price": price,
            "total": total, "buyer": str(d.get("buyer") or "").strip(), "payment": str(d.get("payment") or "Cash").strip() or "Cash"}


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
    "ledger_expenses": ("expense_date", "item", "supplier", "qty", "unit_price", "total", "kind", "note", "paid_by"),
    "ledger_sales": ("product_id", "sale_date", "qty", "unit_price", "total", "buyer", "payment"),
    "ledger_losses": ("product_id", "loss_date", "qty", "total", "kind", "reason"),
    "ledger_stock": ("product_id", "event_date", "qty", "unit_cost", "total_cost", "kind", "supplier", "paid_by"),
}


def insert_row(cur, table, project_id, who, source, source_ref, row):
    """One insert inside the caller's transaction. Replay-safe on (project_id, source_ref):
    returns (id, created). Source_ref None is always a new row."""
    cols = _INSERT[table]
    cur.execute(
        "INSERT INTO %s (project_id, created_by, source, source_ref, %s) VALUES (%%s,%%s,%%s,%%s,%s) "
        "ON CONFLICT (project_id, source_ref) WHERE source_ref IS NOT NULL DO NOTHING RETURNING id"
        % (table, ", ".join(cols), ", ".join(["%s"] * len(cols))),
        [project_id, who, source, source_ref] + [row.get(c) for c in cols])
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


def build_reconciliation(rows, treasury, links, notes):
    """Pure. rows = ledger rows, treasury = club expenditure rows for the project, links =
    reimbursement links [{expenditure_id, amount}], notes = [{item_key, body, explained, author, created_at}].
    Two accounts, never merged: the farm cash box (the ledger) and the club treasury."""
    st = statement(rows)
    kinds = {t["id"]: classify_treasury(t) for t in treasury}
    capital = sum(t["amount_ugx"] for t in treasury if kinds[t["id"]] == "capital")
    cash_in = capital + st["sales"]
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
    nr = [e for e in rows["expenses"] if e.get("source") != "appsheet_import" and not e.get("receipt_url")]
    if nr:
        items.append(item("receipts:missing", "Expenses without a receipt", sum(e["total"] for e in nr),
                          "%d expense lines recorded in the Hub have no receipt photo yet." % len(nr)))
    gap = cash_out - cash_in
    items.append(item("gap", "Farm spent more than it was given and earned" if gap > 0 else "Farm holds more than it spent",
                      abs(gap), "Capital %s + sales %s in, opex %s + capex %s out." % tuple("{:,}".format(x) for x in (capital, st["sales"], st["opex"], st["capex"]))))
    pay = {}
    for e in rows["expenses"]:
        w = e.get("paid_by") or "Pre-ledger, unattributed"
        b = pay.setdefault(w, {"who": w, "count": 0, "total": 0})
        b["count"] += 1; b["total"] += e["total"]
    return {
        "statement": {k: v for k, v in st.items() if k != "per_product"},
        "farm_box": {"in": {"capital": capital, "sales": st["sales"], "total": cash_in},
                     "out": {"opex": st["opex"], "capex": st["capex"], "total": cash_out}, "gap": gap},
        "treasury": [{"id": t["id"], "date": _d(t["txn_date"]), "description": t["description"], "amount": t["amount_ugx"],
                      "kind": kinds[t["id"]], "recorded_by": t.get("recorded_by")} for t in treasury],
        "paid_by": sorted(pay.values(), key=lambda b: -b["total"]),
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
    return build_reconciliation(rows, treasury, links, notes)


def fetch_snapshot(sheet_id, service_account_path):
    """Read the AppSheet workbook's tabs with UNFORMATTED values (serial dates, plain numbers)."""
    import gspread
    from google.oauth2.service_account import Credentials
    creds = Credentials.from_service_account_file(service_account_path, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"])
    import time

    def once():
        sh = gspread.authorize(creds).open_by_key(sheet_id)
        return {t: sh.worksheet(t).get_all_values(value_render_option="UNFORMATTED_VALUE") for t in TABS}
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
