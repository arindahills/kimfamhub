"""
sheep.py — native (Postgres) tracker for the Sheep & Dorper RAM project.

Data is entered via in-app forms into Postgres — NOT Google Sheets / AppSheet
(see Epic #16). Three tables, created idempotently at app startup (the kimfam role
has CREATE on the public schema, same mechanism that created project_updates):

  sheep_animals   — notable individuals (the Dorper ram, breeding ewes): type, tag, status
  sheep_events    — the log: opening | birth | death(+cause) | sale(+amount,buyer) | purchase(+amount,seller)
  sheep_expenses  — categorized spend: sourcing | ear_tag | pasture | feed_silage | vet | transport | labour | other

Flock size at any date = opening + births + purchases − deaths − sales (from sheep_events).
Everything the club needs to know "how the project is doing" — mortalities, vaccines (vet),
capital in, money sent to buy lambs (purchase events + counterparty) — lives here.
"""

# ── enums (validated by the API layer) ───────────────────────────────────────
ANIMAL_TYPES = ("ram", "ewe", "lamb")
ANIMAL_STATUSES = ("alive", "sold", "dead")
EVENT_TYPES = ("opening", "birth", "death", "sale", "purchase")
EXPENSE_CATEGORIES = ("sourcing", "ear_tag", "pasture", "feed_silage", "vet",
                      "transport", "labour", "other")

_SEED_TAG = "KIM015 seed"   # marker in note → seed runs exactly once

_DDL = [
    """
    CREATE TABLE IF NOT EXISTS sheep_animals (
        id          SERIAL PRIMARY KEY,
        type        TEXT NOT NULL,
        tag         TEXT,
        dob         DATE,
        status      TEXT NOT NULL DEFAULT 'alive',
        acquired_on DATE,
        note        TEXT,
        created_by  TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    "CREATE UNIQUE INDEX IF NOT EXISTS sheep_animals_tag_uq ON sheep_animals(tag) WHERE tag IS NOT NULL",
    """
    CREATE TABLE IF NOT EXISTS sheep_events (
        id           SERIAL PRIMARY KEY,
        event_type   TEXT NOT NULL,
        event_date   DATE NOT NULL,
        count        INTEGER NOT NULL DEFAULT 1,
        cause        TEXT,
        amount_ugx   BIGINT,
        counterparty TEXT,
        animal_id    INTEGER REFERENCES sheep_animals(id) ON DELETE SET NULL,
        note         TEXT,
        created_by   TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS sheep_events_date ON sheep_events(event_date)",
    """
    CREATE TABLE IF NOT EXISTS sheep_expenses (
        id          SERIAL PRIMARY KEY,
        category    TEXT NOT NULL,
        amount_ugx  BIGINT NOT NULL,
        spent_on    DATE NOT NULL,
        paid_by     TEXT,
        note        TEXT,
        created_by  TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS sheep_expenses_date ON sheep_expenses(spent_on)",
]


def baseline_seed_rows():
    """Pure: the documented Dorper-line baseline. Amounts & counts are documented; dates that
    are not on record are marked 'date approx' in the note. The wider (non-Dorper) flock and
    valuation are shown as CONTEXT in sheep_detail_data, not fabricated as events. Unit-tested."""
    animals = []  # the new breeding ram is still being sourced (open action) — not seeded as acquired
    events = [
        # capital: initial Dorper purchase — documented (16 Aug 2024, via Hellen to Priscilla)
        {"event_type": "purchase", "event_date": "2024-08-16", "count": 17, "cause": None,
         "amount_ugx": 1_710_000, "counterparty": "Tuhimbise Pricilla Arinaitwe",
         "note": _SEED_TAG + " — initial Dorper flock, paid via Hellen (ABSA→Stanbic), ref KIM PROJECT DORPER SHEEP"},
        # 1 young Dorper sold to fund ear-tagging — documented amount; date approx
        {"event_type": "sale", "event_date": "2026-06-01", "count": 1, "cause": None,
         "amount_ugx": 200_000, "counterparty": None,
         "note": _SEED_TAG + " — young Dorper sold to fund ear-tagging (date approx)"},
    ] + [
        # 3 lamb deaths, cause unknown — the documented mortality the tracker exists to surface (date approx)
        {"event_type": "death", "event_date": "2026-08-30", "count": 1, "cause": "unknown",
         "amount_ugx": None, "counterparty": None,
         "note": _SEED_TAG + " — lamb death reported at KIM 015, cause unknown (date approx)"}
        for _ in range(3)
    ]
    # documented expense (project_update id 2, 2026-05-31, processed via Hellen)
    expenses = [
        {"category": "pasture", "amount_ugx": 1_853_000, "spent_on": "2026-05-31",
         "paid_by": "Hellen",
         "note": _SEED_TAG + " — pasture ploughing: 5.751 acres @ 230,000 = 1,583,000 + shrub clearing 60,000 + tractor fuel 210,000"},
    ]
    return {"animals": animals, "events": events, "expenses": expenses}


# ── pure aggregation (unit-tested; DB wrappers below call these) ──────────────
def compute_flock(events):
    """events: list of {event_type, count}. Returns flock counts derived from the log.
    Flock alive = opening + births + purchases − deaths − sales."""
    def _sum(t):
        return sum(int(e.get("count") or 0) for e in events if e.get("event_type") == t)
    inflow = _sum("opening") + _sum("birth") + _sum("purchase")
    births, purchases = _sum("birth"), _sum("purchase")
    deaths, sales = _sum("death"), _sum("sale")
    alive = inflow - deaths - sales
    denom = inflow  # animals that were ever in the flock
    return {
        "alive": max(0, alive),
        "births": births,
        "purchases": purchases,
        "deaths": deaths,
        "sold": sales,
        "ever_held": inflow,
        "mortality_rate_pct": round(100.0 * deaths / denom, 1) if denom else 0.0,
    }


def compute_financials(events, expenses):
    """events + expenses rows → capital in, sales income, expense total & breakdown, net."""
    capital_in = sum(int(e.get("amount_ugx") or 0) for e in events if e.get("event_type") == "purchase")
    sales_income = sum(int(e.get("amount_ugx") or 0) for e in events if e.get("event_type") == "sale")
    by_cat = {}
    for x in expenses:
        by_cat[x["category"]] = by_cat.get(x["category"], 0) + int(x.get("amount_ugx") or 0)
    expense_total = sum(by_cat.values())
    return {
        "capital_invested": capital_in,
        "sales_income": sales_income,
        "expense_total": expense_total,
        "expense_by_category": by_cat,
        # cash view: what's gone out (capital + expenses) vs what's come back (sales)
        "net_cash_position": sales_income - capital_in - expense_total,
    }


_READY = False


def ensure_sheep_tables():
    """Idempotent — create the sheep tables + indexes at app startup."""
    from db import execute as _exec
    for ddl in _DDL:
        _exec(ddl)


def ready():
    """Ensure tables exist + baseline seeded, at most once per process. Safe to call at the
    top of every sheep handler (mirrors the _ensure_*_cols idiom). Never raises; returns
    whether the tracker is usable so the handler can 503 cleanly instead of 500."""
    global _READY
    if _READY:
        return True
    try:
        ensure_sheep_tables()
        seed_sheep_baseline()
        _READY = True
    except Exception as _e:
        import logging
        logging.getLogger("uvicorn.error").warning("sheep.ready() failed: %s", _e)
    return _READY


_SEED_LOCK_KEY = 778811   # arbitrary fixed key for pg_advisory_xact_lock


def seed_sheep_baseline():
    """Idempotent, atomic, concurrency-safe — insert the baseline exactly once.
    All inserts run in ONE transaction (mid-seed failure rolls the whole thing back → no
    partial/duplicate seed), serialized by a transaction-scoped advisory lock (two gunicorn
    workers hitting ready() at once cannot both seed), with the marker re-checked inside."""
    from db import db as _db
    rows = baseline_seed_rows()
    with _db() as conn:                                  # commits once on exit, rolls back on error
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(%s)", (_SEED_LOCK_KEY,))  # held until commit/rollback
            cur.execute("SELECT 1 FROM sheep_expenses WHERE note LIKE %s LIMIT 1", (_SEED_TAG + "%",))
            if cur.fetchone():
                return False
            for a in rows["animals"]:
                cur.execute(
                    "INSERT INTO sheep_animals (type, tag, dob, status, acquired_on, note, created_by) "
                    "VALUES (%s,%s,%s,%s,%s,%s,'seed')",
                    (a["type"], a["tag"], a["dob"], a["status"], a["acquired_on"], a["note"]))
            for e in rows["events"]:
                cur.execute(
                    "INSERT INTO sheep_events (event_type, event_date, count, cause, amount_ugx, counterparty, note, created_by) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,'seed')",
                    (e["event_type"], e["event_date"], e["count"], e["cause"], e["amount_ugx"], e["counterparty"], e["note"]))
            for x in rows["expenses"]:                   # the marker (KIM015 seed) lives on the expense row, inserted last
                cur.execute(
                    "INSERT INTO sheep_expenses (category, amount_ugx, spent_on, paid_by, note, created_by) "
                    "VALUES (%s,%s,%s,%s,%s,'seed')",
                    (x["category"], x["amount_ugx"], x["spent_on"], x["paid_by"], x["note"]))
    return True


# ── live detail (DB → nested dict rendered by the generic DetailModal) ────────
def _fmt_rows(rows):
    out = []
    for r in rows:
        d = dict(r)
        for k, v in list(d.items()):
            if hasattr(v, "isoformat"):
                d[k] = v.isoformat()
        out.append(d)
    return out


def sheep_detail_data():
    """Live analytics for the sheep card, computed from sheep_* tables. Assembles a
    well-named nested dict; DetailModal renders KPI rows / feeds / hero metrics generically."""
    from db import query as _q
    events = _fmt_rows(_q("SELECT event_type, event_date, count, cause, amount_ugx, counterparty, note "
                          "FROM sheep_events ORDER BY event_date DESC, id DESC"))
    expenses = _fmt_rows(_q("SELECT category, amount_ugx, spent_on, paid_by, note "
                            "FROM sheep_expenses ORDER BY spent_on DESC, id DESC"))
    flock = compute_flock(events)
    fin = compute_financials(events, expenses)

    deaths_by_cause = {}
    for e in events:
        if e["event_type"] == "death":
            deaths_by_cause[e.get("cause") or "unknown"] = deaths_by_cause.get(e.get("cause") or "unknown", 0) + int(e.get("count") or 0)

    # Estimated flock value (illustrative) so the cash figures have an asset counterweight —
    # the family should not read the project as pure loss. Per-head is an estimate, labelled.
    est_per_head = 150_000
    dorper_alive = flock["alive"]
    flock_value_est = dorper_alive * est_per_head
    # asset-inclusive net worth (matches the old endpoint's positive `net_position` lens)
    net_position = flock_value_est + fin["sales_income"] - fin["capital_invested"] - fin["expense_total"]
    pending_pipeline_ugx = 12 * 200_000   # 12 ewes ear-tagged @ 200K, action KIM/07/26-4

    return {
        "summary": {
            "dorper_line_alive": dorper_alive,
            "total_deaths": flock["deaths"],
            "mortality_rate": f"{flock['mortality_rate_pct']}% (Dorper line)",
            "capital_invested": fin["capital_invested"],
            "expenses_to_date": fin["expense_total"],
            "sales_income": fin["sales_income"],
            "net_cash_out": -fin["net_cash_position"] if fin["net_cash_position"] < 0 else 0,
            "net_position": net_position,   # asset-inclusive (est. flock value − cash out) → the hero KPI
        },
        "flock": {**flock, "scope": "Dorper line (from tracked events)",
                  "wider_flock_note": "Prior records indicate ~40 total head incl. non-Dorper sheep — confirm current composition with Solomon."},
        "financials": fin,
        "valuation": {
            "est_value_per_head": est_per_head,
            "dorper_alive": dorper_alive,
            "flock_value_est": flock_value_est,
            "basis": "Illustrative: ~150K/head (Dorper premium; Mum's flat ref 200K). Confirm at sale.",
        },
        "mortality": {
            "total": flock["deaths"],
            "rate": f"{flock['mortality_rate_pct']}% of Dorper animals ever held",
            "by_cause": deaths_by_cause,
            "note": "Lamb deaths of unknown cause flagged at KIM 015 — investigate & vaccinate.",
        },
        "pending_pipeline": {
            "item": "12 old ewes ear-tagged; payment being processed via Hellen",
            "action_id": "KIM/07/26-4",
            "amount_ugx": pending_pipeline_ugx,
            "status": "in flight",
        },
        "expense_breakdown": fin["expense_by_category"],
        "recent_events": events[:12],
        "recent_expenses": expenses[:12],
        "next_steps": [
            {"step": "Replough paddocks", "target": "Sep 2026"},
            {"step": "Broadcast pasture seeds", "target": "Sep 2026"},
            {"step": "Source new breeding ram", "target": "TBD", "note": "Existing ram cannot breed with its own offspring"},
            {"step": "Settle KIM/07/26-4 ear-tagging payment", "target": "overdue"},
        ],
        "breeding_model": {
            "gestation_days": 150, "lambs_per_birth": "1-3", "cycles_per_year": "1-2",
            "harvest_age_months": 6, "harvest_weight_kg": 30,
            "note": "Dorper is a hair sheep — no shearing, hardy in tropical climate.",
        },
        "source": "Live from KimFam Hub (sheep_events / sheep_expenses) — entered in-app, not a spreadsheet. Valuation & wider-flock figures are context, to be confirmed with Solomon.",
    }


# ── request models (in sheep.py so they're hermetically unit-testable) ────────
from typing import Optional as _Optional
from pydantic import BaseModel as _BM


class SheepEventIn(_BM):
    event_type: str
    event_date: str
    count: int = 1
    cause: _Optional[str] = None          # Optional so the frontend's explicit JSON null is accepted
    amount_ugx: _Optional[int] = None
    counterparty: _Optional[str] = None
    note: _Optional[str] = None


class SheepExpenseIn(_BM):
    category: str
    amount_ugx: int
    spent_on: str
    paid_by: _Optional[str] = None
    note: _Optional[str] = None


# ── writes (Solomon/admin only; validators are pure + unit-tested) ────────────
_MAX_COUNT = 1000
_MAX_AMOUNT = 10_000_000_000   # 10 billion UGX — well below BIGINT overflow, above any real entry


def validate_event(event_type, count, amount_ugx):
    """Pure. Returns (ok: bool, error: str|None). Bounds guard typos + integer overflow."""
    if event_type not in EVENT_TYPES:
        return False, "event_type must be one of %s" % (EVENT_TYPES,)
    try:
        c = int(count)
    except (TypeError, ValueError):
        return False, "count must be an integer"
    if c < 1:
        return False, "count must be >= 1"
    if c > _MAX_COUNT:
        return False, "count looks too large (max %d) — check the entry" % _MAX_COUNT
    if event_type in ("sale", "purchase"):
        if amount_ugx is None or int(amount_ugx) < 0:
            return False, "amount_ugx (>= 0) is required for a sale or purchase"
        if int(amount_ugx) > _MAX_AMOUNT:
            return False, "amount looks too large — check the entry"
    return True, None


def validate_expense(category, amount_ugx):
    """Pure. Returns (ok: bool, error: str|None)."""
    if category not in EXPENSE_CATEGORIES:
        return False, "category must be one of %s" % (EXPENSE_CATEGORIES,)
    if amount_ugx is None or int(amount_ugx) <= 0:
        return False, "amount_ugx must be > 0"
    if int(amount_ugx) > _MAX_AMOUNT:
        return False, "amount looks too large — check the entry"
    return True, None


def current_alive():
    """Dorper-line alive count from the event log (for the death/sale sanity check)."""
    from db import query as _q
    rows = _q("SELECT event_type, count FROM sheep_events")
    return compute_flock([dict(r) for r in rows])["alive"]


def delete_event(event_id, actor):
    from db import execute as _exec
    r = _exec("DELETE FROM sheep_events WHERE id=%s RETURNING id", (int(event_id),))
    return r[0] if r else None


def delete_expense(expense_id, actor):
    from db import execute as _exec
    r = _exec("DELETE FROM sheep_expenses WHERE id=%s RETURNING id", (int(expense_id),))
    return r[0] if r else None


def insert_event(event_type, event_date, count, cause, amount_ugx, counterparty, note, created_by):
    from db import execute as _exec
    r = _exec(
        "INSERT INTO sheep_events (event_type, event_date, count, cause, amount_ugx, counterparty, note, created_by) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
        (event_type, event_date, int(count), cause, amount_ugx, counterparty, note, created_by))
    return r[0] if r else None   # plain cursor → tuple; use r[0], never r["id"]


def insert_expense(category, amount_ugx, spent_on, paid_by, note, created_by):
    from db import execute as _exec
    r = _exec(
        "INSERT INTO sheep_expenses (category, amount_ugx, spent_on, paid_by, note, created_by) "
        "VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
        (category, int(amount_ugx), spent_on, paid_by, note, created_by))
    return r[0] if r else None
