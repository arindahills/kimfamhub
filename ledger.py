"""
ledger.py — one project ledger that replaces the AppSheet (ADR-032).

Pure part (this file, no database): parse an AppSheet snapshot into ledger rows and compute the
AppSheet's own Financial Statement from them, so the import can be proven equal to the sheet's
figures to the shilling before anything is switched.

The snapshot is {tab title: rows as read with value_render_option=UNFORMATTED_VALUE}. Dates are the
sheet's serial numbers (never the formatted strings: the sheet mixes m/d/Y and d/m/Y).

    python3 ledger.py parity <snapshot.json>      # prints computed vs sheet, exits 1 on any difference

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


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "parity":
        with open(sys.argv[2]) as f:
            _ok, _lines = parity(json.load(f))
        print("\n".join(_lines))
        print("PARITY", "OK" if _ok else "FAILED")
        sys.exit(0 if _ok else 1)
    print(__doc__)
