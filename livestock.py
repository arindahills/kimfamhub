"""
livestock.py — one tracker engine for every livestock project (sheep, goats, next dairy and
rabbits). See ADR-029.

Storage is the existing sheep_* tables (ADR-026) with a `project_id` column (existing rows are
'sheep'), an `owner` column, and soft-delete columns. Every read, write and delete is scoped by
project_id, so a goats URL can never touch a sheep row.

Two ownership models:
  * owned_by="club"   (sheep): the club's animals; purchases are club capital, sales club income.
  * owned_by="owners" (goats): each family member owns their own goats. Money from a sale or a
    purchase belongs to that OWNER, never the club, so no club P&L is produced; counts and money are
    reported per owner, and death/sale checks run against that owner's own count.

The pure functions here are unit-tested without a database (tests/test_api.py::TestLivestock*).
"""
import datetime as _dt

import sheep as _sheep   # the shared tables, the shared ready() and the sheep-only extras live there

# Family members who own goats: "all members except Solomon and Hellen" (goats project card).
# Canonical login names are stored; the UI shows display names.
GOAT_OWNERS = ("Israel", "Merab", "Hillary", "Alex", "Priscilla", "Max", "Janet", "Viola",
               "Simon", "Esther", "Lawi")

LIVESTOCK = {
    "sheep": {
        "noun": "sheep", "plural": "sheep", "label": "Sheep (Dorper)",
        "writers": ("Solomon",),                       # + admins
        "event_types": ("opening", "death", "birth", "sale", "purchase"),   # opening = count adjustment
        "expense_categories": _sheep.EXPENSE_CATEGORIES,
        "owned_by": "club", "owners": (),
        "mortality_alert_count": 2,                     # small flock: 2 deaths in 90 days is a signal
        "dry_season_note": "prepare silage and consider moving animals to the home farm (KIM 015 contingency).",
    },
    "goats": {
        "noun": "goat", "plural": "goats", "label": "Goats",
        # Recording is done by the farm team for everyone's goats (KIM/11/26-4, KIM/12/26-16):
        # Solomon and Mum, plus admins (Dad is an admin). Owners themselves read, they do not write.
        "writers": ("Solomon", "Merab"),
        "event_types": ("opening", "death", "birth", "sale", "purchase"),
        "expense_categories": ("vet", "feed", "pasture", "transport", "labour", "other"),
        "owned_by": "owners", "owners": GOAT_OWNERS,
        "mortality_alert_count": 4,                     # ~55 head: 4 in 90 days is the comparable signal
        "dry_season_note": "prepare feed and water for the dry spell.",
    },
}

EVENT_ALL = ("opening", "birth", "death", "sale", "purchase")


def config(project_id):
    return LIVESTOCK.get(project_id)


def can_write(project_id, payload):
    """payload = verified JWT payload. Admins write everything; otherwise the project's writers."""
    cfg = config(project_id)
    if not cfg or not payload:
        return False
    return payload.get("role") == "admin" or payload.get("sub") in cfg["writers"]


# ── pure maths (unit-tested) ──────────────────────────────────────────────────
def compute_by_owner(events):
    """events with owner/event_type/count/amount_ugx -> {owner: {alive, births, deaths, sold,
    bought, opening, sales_ugx, purchases_ugx}}. Owner None is reported as 'unassigned'."""
    out = {}
    for e in events:
        o = e.get("owner") or "unassigned"
        b = out.setdefault(o, {"opening": 0, "births": 0, "bought": 0, "deaths": 0, "sold": 0,
                               "sales_ugx": 0, "purchases_ugx": 0})
        c = int(e.get("count") or 0)
        t = e.get("event_type")
        if t == "opening":  b["opening"] += c
        elif t == "birth":  b["births"] += c
        elif t == "purchase":
            b["bought"] += c; b["purchases_ugx"] += int(e.get("amount_ugx") or 0)
        elif t == "death":  b["deaths"] += c
        elif t == "sale":
            b["sold"] += c; b["sales_ugx"] += int(e.get("amount_ugx") or 0)
    for b in out.values():
        b["alive"] = b["opening"] + b["births"] + b["bought"] - b["deaths"] - b["sold"]
    return out


def owner_alive(events, owner):
    return compute_by_owner(events).get(owner or "unassigned", {}).get("alive", 0)


def compute_alerts(events, cfg, today=None):
    """Mortality (per-project threshold, noun from config) + dry-season flag."""
    if today is None:
        today = _dt.date.today()
    alerts = []
    cutoff = today - _dt.timedelta(days=90)
    recent, causes = 0, set()
    for e in events:
        if e.get("event_type") != "death":
            continue
        try:
            ed = _dt.date.fromisoformat(str(e.get("event_date") or e.get("date"))[:10])
            cnt = int(e.get("count") or 0)
        except (ValueError, TypeError):
            continue
        if ed >= cutoff:
            recent += cnt
            causes.add(e.get("cause") or "unknown")
    if recent >= cfg["mortality_alert_count"]:
        cause_txt = ("cause unknown — investigate & vaccinate" if causes == {"unknown"}
                     else "causes: " + ", ".join(sorted(causes)))
        alerts.append({"level": "warn", "kind": "mortality",
                       "text": "%d %s deaths in the last 90 days (%s)." % (recent, cfg["noun"], cause_txt)})
    if today.month in (6, 7, 8, 9):
        alerts.append({"level": "info", "kind": "drought",
                       "text": "Dry-season window (Jun–Sep) — " + cfg["dry_season_note"]})
    return alerts


def validate_write(project_id, event_type, count, amount_ugx, owner, events):
    """Project-aware checks on top of sheep.validate_event. Returns (ok, error)."""
    cfg = config(project_id)
    if event_type not in cfg["event_types"]:
        return False, "event_type must be one of %s for %s" % (cfg["event_types"], cfg["plural"])
    ok, err = _sheep.validate_event("purchase" if event_type == "opening" else event_type, count,
                                    amount_ugx if event_type != "opening" else 0)
    if not ok:
        return False, err
    if cfg["owned_by"] == "owners":
        if owner and owner not in cfg["owners"]:
            return False, "owner must be one of the family members who own %s" % cfg["plural"]
        if event_type == "opening":
            if not owner:
                return False, "an opening count needs the owner"
            if any(e.get("event_type") == "opening" and e.get("owner") == owner for e in events):
                return False, ("%s already has an opening count. To correct it, delete that entry "
                               "and enter it again." % owner)
        if event_type in ("death", "sale") and owner and int(count) > owner_alive(events, owner):
            return False, "%s has only %d %s on record" % (owner, owner_alive(events, owner), cfg["plural"])
    if event_type in ("death", "sale"):
        alive = _sheep.compute_flock(events)["alive"]
        if int(count) > alive:
            return False, "only %d %s alive on record" % (alive, cfg["plural"])
    return True, None


# ── DB layer ───────────────────────────────────────────────────────────────────
def ready():
    """Shared readiness (sheep.ready creates tables, seeds sheep, migrates the livestock columns)."""
    return _sheep.ready() and _sheep.livestock_cols_ready()


def _rows(sql, params):
    from db import query as _q
    return _sheep._fmt_rows(_q(sql, params))


def events(project_id):
    return _rows("SELECT id, event_type, event_date, count, cause, amount_ugx, counterparty, owner, note, "
                 "created_by, created_at FROM sheep_events WHERE project_id=%s AND deleted_at IS NULL "
                 "ORDER BY event_date DESC, id DESC", (project_id,))


def expenses(project_id):
    return _rows("SELECT id, category, amount_ugx, spent_on, paid_by, owner, note, created_by, created_at "
                 "FROM sheep_expenses WHERE project_id=%s AND deleted_at IS NULL "
                 "ORDER BY spent_on DESC, id DESC", (project_id,))


def insert_event(project_id, b, created_by):
    from db import execute as _exec
    r = _exec("INSERT INTO sheep_events (project_id, event_type, event_date, count, cause, amount_ugx, "
              "counterparty, owner, note, created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
              (project_id, b.event_type, b.event_date, int(b.count), b.cause,
               b.amount_ugx if b.event_type in ("sale", "purchase") else None,
               b.counterparty, b.owner, b.note, created_by))
    return r[0] if r else None


def insert_expense(project_id, b, created_by):
    from db import execute as _exec
    r = _exec("INSERT INTO sheep_expenses (project_id, category, amount_ugx, spent_on, paid_by, owner, note, "
              "created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
              (project_id, b.category, int(b.amount_ugx), b.spent_on, b.paid_by, b.owner, b.note, created_by))
    return r[0] if r else None


def soft_delete(project_id, kind, row_id, actor):
    """Scoped by project and never physical: five people write against other people's animals,
    so every removal keeps who and when."""
    from db import execute as _exec
    table = "sheep_events" if kind == "event" else "sheep_expenses"
    r = _exec("UPDATE %s SET deleted_at=now(), deleted_by=%%s WHERE id=%%s AND project_id=%%s "
              "AND deleted_at IS NULL RETURNING id" % table, (actor, int(row_id), project_id))
    return r[0] if r else None


def _recent(rows, date_key):
    """Recent rows for the UI: id + `date` (the UI's key), no internal columns."""
    out = []
    for r in rows[:12]:
        d = {k: v for k, v in r.items() if k not in ("created_at", date_key)}
        d["date"] = r.get(date_key)
        out.append(d)
    return out


def detail_data(project_id):
    """Generic live detail for a livestock project (goats; sheep adds its extras in sheep.py)."""
    cfg = config(project_id)
    ev, ex = events(project_id), expenses(project_id)
    flock = _sheep.compute_flock(ev)
    deaths_by_cause = {}
    for e in ev:
        if e["event_type"] == "death":
            k = e.get("cause") or "unknown"
            deaths_by_cause[k] = deaths_by_cause.get(k, 0) + int(e.get("count") or 0)
    exp_by_cat = {}
    for x in ex:
        exp_by_cat[x["category"]] = exp_by_cat.get(x["category"], 0) + int(x.get("amount_ugx") or 0)
    out = {
        "summary": {
            "alive": flock["alive"],
            "total_deaths": flock["deaths"],
            "births": flock["births"],
            "sold": flock["sold"],
            "mortality_rate_pct": flock["mortality_rate_pct"],
            "mortality_rate": "%s%% of %s ever recorded" % (flock["mortality_rate_pct"], cfg["plural"]),
            "expenses_to_date": sum(exp_by_cat.values()),
        },
        "flock": {**flock, "scope": "%s recorded in the Hub" % cfg["plural"].capitalize()},
        "mortality": {"total": flock["deaths"], "by_cause": deaths_by_cause},
        "expense_breakdown": exp_by_cat,
        "chart": _sheep.compute_monthly(ev),
        "alerts": compute_alerts(ev, cfg),
        "recent_events": _recent(ev, "event_date"),
        "recent_expenses": _recent(ex, "spent_on"),
        "owned_by": cfg["owned_by"],
    }
    if cfg["owned_by"] == "owners":
        by_owner = compute_by_owner(ev)
        for x in ex:
            o = x.get("owner") or "unassigned"
            by_owner.setdefault(o, {"opening": 0, "births": 0, "bought": 0, "deaths": 0, "sold": 0,
                                    "sales_ugx": 0, "purchases_ugx": 0, "alive": 0})
            by_owner[o]["expenses_ugx"] = by_owner[o].get("expenses_ugx", 0) + int(x.get("amount_ugx") or 0)
        out["by_owner"] = by_owner
        out["money_note"] = ("Goats are owned by individual family members: sale and purchase money "
                             "belongs to each owner, not the club, so there is no club profit or loss here.")
        out["source"] = ("Live from KimFam Hub, entered in-app by the farm team. Counts start from each "
                         "owner's opening count; owners with no opening count are not yet on record.")
    return out
