"""Unit tests for sheep.py pure logic — run: python3 test_sheep.py"""
from datetime import date
from sheep import (baseline_seed_rows, compute_flock, compute_financials, compute_monthly,
                   compute_alerts, validate_event, validate_expense,
                   EVENT_TYPES, EXPENSE_CATEGORIES, ANIMAL_TYPES, ANIMAL_STATUSES, _SEED_TAG)


def test_alerts_mortality_and_drought():
    ev = [{"event_type": "death", "event_date": "2026-08-30", "count": 1, "cause": "unknown"} for _ in range(3)]
    a = compute_alerts(ev, today=date(2026, 9, 3))   # Sep = dry month; 3 recent deaths
    kinds = {x["kind"] for x in a}
    assert "mortality" in kinds and "drought" in kinds
    mort = next(x for x in a if x["kind"] == "mortality")
    assert mort["level"] == "warn" and "3 sheep deaths" in mort["text"] and "vaccinate" in mort["text"]


def test_alerts_none_when_quiet_and_wet_season():
    # 1 old death (outside 90d) + non-dry month → no alerts
    ev = [{"event_type": "death", "event_date": "2026-01-01", "count": 1, "cause": "unknown"}]
    assert compute_alerts(ev, today=date(2026, 3, 15)) == []


def test_alerts_drought_only_in_dry_months():
    assert any(x["kind"] == "drought" for x in compute_alerts([], today=date(2026, 7, 1)))
    assert not any(x["kind"] == "drought" for x in compute_alerts([], today=date(2026, 12, 1)))


def test_compute_monthly_flock_trend():
    m = compute_monthly(baseline_seed_rows()["events"])
    # event-months: 2024-08 (purchase 17), 2026-06 (sale 1), 2026-08 (3 deaths)
    assert m["months"] == ["2024-08", "2026-06", "2026-08"]
    assert m["flock"] == [17, 16, 13]              # cumulative: 17 → 16 → 13
    assert m["deaths"] == [0, 0, 3]
    assert m["births"] == [0, 0, 0]


def test_compute_monthly_empty_and_births():
    assert compute_monthly([]) == {"months": [], "flock": [], "births": [], "deaths": []}
    ev = [{"event_type": "opening", "event_date": "2026-01-05", "count": 10},
          {"event_type": "birth", "event_date": "2026-02-10", "count": 4},
          {"event_type": "death", "event_date": "2026-02-20", "count": 1}]
    m = compute_monthly(ev)
    assert m["flock"] == [10, 13]                   # 10, then +4 −1
    assert m["births"] == [0, 4] and m["deaths"] == [0, 1]


def test_validate_event():
    assert validate_event("death", 1, None)[0] is True
    assert validate_event("birth", 3, None)[0] is True
    assert validate_event("sale", 1, 200000)[0] is True
    assert validate_event("purchase", 2, 0)[0] is True            # 0 allowed (>=0)
    assert validate_event("bogus", 1, None)[0] is False           # bad type
    assert validate_event("death", 0, None)[0] is False           # count < 1
    assert validate_event("sale", 1, None)[0] is False            # sale needs amount
    assert validate_event("purchase", 1, -5)[0] is False          # negative amount


def test_validate_expense():
    assert validate_expense("vet", 50000)[0] is True              # vaccines = vet
    assert validate_expense("ear_tag", 1)[0] is True
    assert validate_expense("bogus", 1000)[0] is False            # bad category
    assert validate_expense("vet", 0)[0] is False                 # must be > 0
    assert validate_expense("vet", None)[0] is False


def test_validator_ceilings_block_typos():
    assert validate_event("purchase", 10**6, 1000)[0] is False    # count > 1000
    assert validate_event("sale", 1, 10**11)[0] is False          # amount > 10bn
    assert validate_expense("vet", 10**11)[0] is False


def test_pydantic_models_accept_frontend_explicit_nulls():
    # The regression the reviewer caught: Pydantic v2 must accept explicit JSON null, which the
    # frontend sends for cause/amount_ugx/counterparty/note. `Optional[...]=None` is required.
    from sheep import SheepEventIn, SheepExpenseIn
    e = SheepEventIn(event_type="death", event_date="2026-09-03", count=1,
                     cause=None, amount_ugx=None, counterparty=None, note=None)
    assert e.event_type == "death" and e.cause is None
    x = SheepExpenseIn(category="vet", amount_ugx=50000, spent_on="2026-09-03",
                       paid_by=None, note=None)
    assert x.category == "vet" and x.paid_by is None


def test_seed_is_documented_facts_only():
    r = baseline_seed_rows()
    # the one real, documented expense: pasture ploughing (project_update id 2)
    exp = r["expenses"]
    assert len(exp) == 1
    assert exp[0]["category"] == "pasture"
    assert exp[0]["amount_ugx"] == 1_853_000
    assert exp[0]["spent_on"] == "2026-05-31"
    # breakdown must reconcile: 1,583,000 + 60,000 + 210,000 == 1,853,000
    assert 1_583_000 + 60_000 + 210_000 == exp[0]["amount_ugx"]


def test_seed_three_lamb_deaths_unknown_cause():
    ev = baseline_seed_rows()["events"]
    deaths = [e for e in ev if e["event_type"] == "death"]
    assert len(deaths) == 3
    assert all(d["cause"] == "unknown" for d in deaths)
    assert all(d["count"] == 1 for d in deaths)


def test_seed_does_not_assert_unconfirmed_ram():
    # the new breeding ram is an OPEN sourcing action — must not be seeded as acquired/alive
    assert baseline_seed_rows()["animals"] == []


def test_seed_rows_are_valid_against_enums():
    r = baseline_seed_rows()
    for a in r["animals"]:
        assert a["type"] in ANIMAL_TYPES and a["status"] in ANIMAL_STATUSES
    for e in r["events"]:
        assert e["event_type"] in EVENT_TYPES
    for x in r["expenses"]:
        assert x["category"] in EXPENSE_CATEGORIES


def test_every_seed_row_carries_the_idempotency_marker():
    r = baseline_seed_rows()
    for group in r.values():
        for row in group:
            assert row["note"].startswith(_SEED_TAG)   # so seed_sheep_baseline detects & skips re-seeding


# JUSTIFICATION-A3: net-new test fns for the pure flock/financials aggregators; not a wrap.
def test_flock_math_from_seed():
    ev = baseline_seed_rows()["events"]
    f = compute_flock(ev)
    assert f["purchases"] == 17 and f["deaths"] == 3 and f["sold"] == 1 and f["births"] == 0
    assert f["alive"] == 13                       # 17 in − 3 died − 1 sold
    assert f["ever_held"] == 17
    assert f["mortality_rate_pct"] == 17.6        # 3/17


def test_financials_from_seed():
    r = baseline_seed_rows()
    fin = compute_financials(r["events"], r["expenses"])
    assert fin["capital_invested"] == 1_710_000
    assert fin["sales_income"] == 200_000
    assert fin["expense_total"] == 1_853_000
    assert fin["expense_by_category"] == {"pasture": 1_853_000}
    assert fin["net_cash_position"] == 200_000 - 1_710_000 - 1_853_000   # -3,363,000


def test_flock_never_negative_and_empty_safe():
    assert compute_flock([])["alive"] == 0
    assert compute_flock([])["mortality_rate_pct"] == 0.0
    assert compute_financials([], [])["net_cash_position"] == 0
    assert compute_flock([{"event_type": "death", "count": 5}])["alive"] == 0   # clamps at 0


# JUSTIFICATION-A3: net-new DB-path test — proves seed_sheep_baseline executes its inserts
# cleanly through db.db() (catches the tuple-cursor / partial-commit crash class); not a wrap.
def test_seed_db_path_executes_all_inserts_in_one_transaction():
    # Inject a fake `db` module so no real Postgres is needed (db.py opens a pool at import).
    import sys, types, contextlib
    calls = []

    class _Cur:
        def execute(self, sql, params=None):
            calls.append((" ".join(sql.split())[:40], params))
        def fetchone(self):
            return None                      # marker absent → seed proceeds
        def __enter__(self): return self
        def __exit__(self, *a): return False

    class _Conn:
        def cursor(self): return _Cur()

    @contextlib.contextmanager
    def _fake_db():
        yield _Conn()                        # one connection, one implicit commit — mirrors db.db()

    fake = types.ModuleType("db")
    fake.db = _fake_db
    saved = sys.modules.get("db")
    sys.modules["db"] = fake
    try:
        import sheep as _sheep
        ok = _sheep.seed_sheep_baseline()
    finally:
        if saved is not None:
            sys.modules["db"] = saved
        else:
            sys.modules.pop("db", None)
    assert ok is True
    kinds = [c[0] for c in calls]
    assert any("pg_advisory_xact_lock" in k for k in kinds)          # lock taken first
    assert sum("INSERT INTO sheep_events" in k for k in kinds) == 5   # 1 purchase + 1 sale + 3 deaths
    assert sum("INSERT INTO sheep_expenses" in k for k in kinds) == 1
    assert sum("INSERT INTO sheep_animals" in k for k in kinds) == 0  # no ram


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print("  ok", fn.__name__)
    print("\nAll %d tests passed." % len(fns))
