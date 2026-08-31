"""
Contributions module — Sprint 1
Member submission, Hellen confirmation queue, balance computation from PostgreSQL.
"""
import os
from datetime import date, datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Header, Depends, Request
import notifications as _notif
from pydantic import BaseModel
from db import query, execute, db

router = APIRouter(prefix="/api/contributions", tags=["contributions"])

ABSA_ACCOUNT = {
    "bank": "ABSA Uganda",
    "account_number": "6004961127",
    "account_name": "TUSIIME HELLEN"
}

# ──────────────────────────────────────────────────────────
# Cached rate + composition lookup (fetched once per request)
# ──────────────────────────────────────────────────────────
import time as _time

_rates_cache: dict = {"data": None, "ts": 0.0}
_CACHE_TTL = 300  # 5 minutes

def _get_rates():
    now = _time.time()
    if _rates_cache["data"] is None or now - _rates_cache["ts"] > _CACHE_TTL:
        rows = query("SELECT effective_from, effective_to, adult_rate_ugx, child_rate_ugx FROM club_rate_history ORDER BY effective_from")
        _rates_cache["data"] = [dict(r) for r in rows]
        _rates_cache["ts"] = now
    return _rates_cache["data"]

def _rate_for_month(rates, ym_date):
    for r in reversed(rates):
        if r["effective_from"] <= ym_date and (r["effective_to"] is None or r["effective_to"] >= ym_date):
            return r["adult_rate_ugx"], r["child_rate_ugx"]
    return 0, 0

def _comp_for_month(comps, ym_date):
    for c in reversed(comps):
        if c["effective_from"] <= ym_date and (c["effective_to"] is None or c["effective_to"] >= ym_date):
            return c["num_adults"], c["num_children"]
    return 0, 0


def compute_monthly_obligation(family_id: int, period_month: str) -> int:
    """Return UGX obligation for a family for a given YYYY-MM period (single-month, used by preview)."""
    from datetime import date as _date
    ym_date = _date.fromisoformat(period_month + "-01")
    rates = _get_rates()
    adult_r, child_r = _rate_for_month(rates, ym_date)
    if not adult_r and not child_r:
        return 0
    comp = query("""
        SELECT num_adults, num_children FROM family_composition_history
        WHERE family_id = %s
          AND effective_from <= %s
          AND (effective_to IS NULL OR effective_to >= %s)
        ORDER BY effective_from DESC LIMIT 1
    """, (family_id, ym_date, ym_date))
    if not comp:
        return 0
    return comp[0]["num_adults"] * adult_r + comp[0]["num_children"] * child_r


def compute_family_balance(family_id: int):
    """
    Optimised: fetches rates once (cached 5 min) and compositions once per family.
    No per-month DB queries — O(months) in Python, not O(months * 2) SQL round-trips.
    """
    from datetime import date as _date
    today = _date.today()
    if today.month == 1:
        last_m, last_y = 12, today.year - 1
    else:
        last_m, last_y = today.month - 1, today.year
    end_ym = f"{last_y:04d}-{last_m:02d}"

    rates = _get_rates()
    comps = query("""
        SELECT effective_from, effective_to, num_adults, num_children
        FROM family_composition_history WHERE family_id=%s ORDER BY effective_from
    """, (family_id,))
    comps = [dict(c) for c in comps]

    monthly_obl = 0
    y, m = 2023, 1
    while True:
        ym = f"{y:04d}-{m:02d}"
        ym_date = _date.fromisoformat(ym + "-01")
        adult_r, child_r = _rate_for_month(rates, ym_date)
        adults, children = _comp_for_month(comps, ym_date)
        monthly_obl += adults * adult_r + children * child_r
        if ym == end_ym:
            break
        m += 1
        if m > 12:
            m = 1; y += 1

    init_rows = query("SELECT obligation_ugx, paid_ugx FROM initial_obligations WHERE family_id=%s", (family_id,))
    init_obl  = init_rows[0]["obligation_ugx"] if init_rows else 0
    init_paid = init_rows[0]["paid_ugx"]        if init_rows else 0
    init_bal  = init_obl - init_paid

    paid_rows = query("SELECT COALESCE(SUM(amount_ugx),0) as total FROM contribution_payments WHERE family_id=%s AND status='confirmed'", (family_id,))
    total_paid = int(paid_rows[0]["total"]) if paid_rows else 0

    current_balance  = monthly_obl - (total_paid - init_paid)
    combined_balance = current_balance + init_bal

    return {
        "monthly_obligation_total": monthly_obl,
        "initial_obligation":       init_obl,
        "initial_paid":             init_paid,
        "initial_balance":          init_bal,
        "total_monthly_paid":       total_paid,
        "current_balance":          current_balance,
        "combined_balance":         combined_balance,
    }


# JUSTIFICATION-A3: net-new per-month arrears breakdown (no existing equivalent);
# derives which months are owed / overdue / due-next from the SAME net math as
# compute_family_balance, for the Finances-card clarity fix.
def _month_label(ym: str) -> str:
    """'2026-07' -> 'Jul 2026'."""
    from datetime import date as _date
    return _date.fromisoformat(ym + "-01").strftime("%b %Y")


def _due_date_for(ym: str) -> str:
    """A month's contribution is due the 10th of the FOLLOWING month.
    '2026-08' -> '2026-09-10' (matches the scheduler's 'pay by the 10th')."""
    y, m = int(ym[:4]), int(ym[5:7])
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    return f"{ny:04d}-{nm:02d}-10"


def compute_family_arrears_detail(family_id: int):
    """Month-by-month coverage for a family: which months are still owed (with a
    per-month `overdue` flag = past its 10th deadline), and which month is due
    next. Uses the SAME window and net math as compute_family_balance (obligations
    2023-01 through the last COMPLETED month; monthly pool = total confirmed paid
    minus initial paid, applied oldest-first, UNCLAMPED), so total_arrears always
    equals the monthly portion of the balance. Families paid in advance get a
    future paid_through and next_due."""
    from datetime import date as _date, datetime as _dt
    try:
        from zoneinfo import ZoneInfo
        today = _dt.now(ZoneInfo("Africa/Kampala")).date()
    except Exception:
        today = _date.today()

    # Window through the last COMPLETED month, identical to compute_family_balance.
    if today.month == 1:
        last_m, last_y = 12, today.year - 1
    else:
        last_m, last_y = today.month - 1, today.year
    end_ym = f"{last_y:04d}-{last_m:02d}"

    rates = _get_rates()
    comps = [dict(c) for c in query(
        "SELECT effective_from, effective_to, num_adults, num_children "
        "FROM family_composition_history WHERE family_id=%s ORDER BY effective_from",
        (family_id,))]
    past = []
    y, m = 2023, 1
    while True:
        ym = f"{y:04d}-{m:02d}"
        ymd = _date.fromisoformat(ym + "-01")
        adult_r, child_r = _rate_for_month(rates, ymd)
        adults, children = _comp_for_month(comps, ymd)
        past.append((ym, adults * adult_r + children * child_r))
        if ym == end_ym:
            break
        m += 1
        if m > 12:
            m = 1; y += 1

    init_rows = query("SELECT paid_ugx FROM initial_obligations WHERE family_id=%s", (family_id,))
    init_paid = init_rows[0]["paid_ugx"] if init_rows else 0
    total_paid = int(query(
        "SELECT COALESCE(SUM(amount_ugx),0) t FROM contribution_payments "
        "WHERE family_id=%s AND status='confirmed'", (family_id,))[0]["t"])
    pool = total_paid - init_paid   # UNCLAMPED: matches compute_family_balance exactly

    todays = today.isoformat()
    paid_through = None
    arrears = []
    for ym, amt in past:
        if amt <= 0:
            paid_through = ym
            continue
        if pool >= amt:
            pool -= amt
            paid_through = ym
        else:
            owed = amt - pool   # pool may be negative (init shortfall) -> owed > amt, sum still matches balance
            pool = 0
            due = _due_date_for(ym)
            arrears.append({"month": ym, "label": _month_label(ym),
                            "amount_owed": owed, "due_date": due, "overdue": due < todays})

    # Paid in advance: any leftover pool covers future months -> extend paid_through.
    if not arrears and pool > 0:
        fy, fm = last_y, last_m
        while pool > 0:
            fm += 1
            if fm > 12:
                fm = 1; fy += 1
            fym = f"{fy:04d}-{fm:02d}"
            amt = compute_monthly_obligation(family_id, fym)
            if amt <= 0 or pool < amt:
                break
            pool -= amt
            paid_through = fym

    # Next payment due = current calendar month, or the month after paid_through
    # if the family is paid ahead of the current month.
    cur_ym = f"{today.year:04d}-{today.month:02d}"
    if paid_through and paid_through >= cur_ym:
        py, pm = int(paid_through[:4]), int(paid_through[5:7])
        pm += 1
        if pm > 12:
            pm = 1; py += 1
        nxt = f"{py:04d}-{pm:02d}"
    else:
        nxt = cur_ym
    nxt_amt = compute_monthly_obligation(family_id, nxt)
    next_due = ({"month": nxt, "label": _month_label(nxt),
                 "amount_owed": nxt_amt, "due_date": _due_date_for(nxt)}
                if nxt_amt > 0 else None)

    return {
        "paid_through":       paid_through,
        "paid_through_label": _month_label(paid_through) if paid_through else None,
        "arrears_months":     arrears,
        "total_arrears":      sum(a["amount_owed"] for a in arrears),
        "next_due":           next_due,
    }


# ──────────────────────────────────────────────────────────
# GET /api/contributions/account-info
# ──────────────────────────────────────────────────────────
@router.get("/account-info")
def get_account_info():
    """Returns bank account to display on submission form."""
    return ABSA_ACCOUNT


# ──────────────────────────────────────────────────────────
# GET /api/contributions/summary
# ──────────────────────────────────────────────────────────
@router.get("/summary")
def get_summary():
    """Club-level finance summary computed from PostgreSQL."""
    OPENING_BALANCE = 3895944  # stored constant from sheet row 1

    total_paid_row = query("""
        SELECT COALESCE(SUM(amount_ugx),0) as total
        FROM contribution_payments WHERE status='confirmed'
    """)
    total_paid = int(total_paid_row[0]["total"])

    total_loan_payments_row = query("SELECT COALESCE(SUM(amount_ugx),0) as total FROM loan_payments")
    total_loan_payments = int(total_loan_payments_row[0]["total"])

    total_expenditure_row = query("SELECT COALESCE(SUM(amount_ugx),0) as total FROM expenditure_records")
    total_expenditure = int(total_expenditure_row[0]["total"])

    opening_obligations_row = query("SELECT COALESCE(SUM(obligation_ugx),0) as total FROM initial_obligations")
    opening_obligations = int(opening_obligations_row[0]["total"])

    families_rows = query("SELECT id FROM families ORDER BY id")
    combined_balance_total = 0
    for row in families_rows:
        bal = compute_family_balance(row["id"])
        combined_balance_total += bal["combined_balance"]

    computed_balance = OPENING_BALANCE + total_paid + total_loan_payments - total_expenditure

    # Confirmed bank balance (Hellen-verified)
    cfg = query("SELECT key, value FROM club_config WHERE key IN ('confirmed_bank_balance','confirmed_balance_date')")
    cfg_map = {r['key']: r['value'] for r in cfg}
    confirmed_balance     = int(cfg_map.get('confirmed_bank_balance', '0'))
    confirmed_balance_date = cfg_map.get('confirmed_balance_date', '')

    # For obligations: count only what families owe (positive balances only)
    positive_obligations = sum(
        max(0, compute_family_balance(row['id'])['combined_balance'])
        for row in families_rows
    )

    return {
        "opening_balance":            OPENING_BALANCE,
        "opening_obligations":        opening_obligations,
        "total_contributions_paid":   total_paid,
        "total_loan_payments":        total_loan_payments,
        "total_expenditure":          total_expenditure,
        "computed_balance":           computed_balance,
        "confirmed_bank_balance":     confirmed_balance,
        "confirmed_balance_date":     confirmed_balance_date,
        "current_obligations":        positive_obligations,
        "as_at":                      date.today().isoformat(),
    }


# ──────────────────────────────────────────────────────────
# GET /api/contributions/ledger
# ──────────────────────────────────────────────────────────
@router.get("/ledger")
def get_ledger(request: Request = None):
    """Per-family obligations, payments, and balances. Financial data, so HTTP
    callers must be authenticated; internal callers (scheduler, Ask KimFam) invoke
    get_ledger() with no request and are trusted."""
    if request is not None:
        from auth import verify_token
        if not verify_token(request.cookies.get("kimfam_token", "")):
            raise HTTPException(401, "Not authenticated")
    families = query("SELECT id, family_name, joined_date FROM families ORDER BY family_name")
    result = []
    for fam in families:
        comp = query("""
            SELECT num_adults, num_children FROM family_composition_history
            WHERE family_id=%s AND effective_to IS NULL LIMIT 1
        """, (fam["id"],))
        adults   = comp[0]["num_adults"]   if comp else 0
        children = comp[0]["num_children"] if comp else 0
        bal = compute_family_balance(fam["id"])
        today = date.today()
        monthly_rate = compute_monthly_obligation(fam["id"], today.strftime("%Y-%m"))
        result.append({
            "family_id":            fam["id"],
            "family_name":          fam["family_name"],
            "composition":          f"{adults} adults, {children} children",
            "current_monthly_rate": monthly_rate,
            "arrears_detail":       compute_family_arrears_detail(fam["id"]),
            **bal,
        })
    return result


# ──────────────────────────────────────────────────────────
# GET /api/contributions/family/{family_id}
# ──────────────────────────────────────────────────────────
@router.get("/family/{family_id}")
def get_family_contributions(family_id: int, request: Request):
    """Full payment history for a family, including receipt links. Authenticated
    members only (this returns receipt image URLs and full payment history)."""
    from auth import verify_token
    if not verify_token(request.cookies.get("kimfam_token", "")):
        raise HTTPException(401, "Not authenticated")
    fam = query("SELECT * FROM families WHERE id=%s", (family_id,))
    if not fam:
        raise HTTPException(404, "Family not found")
    payments = query("""
        SELECT id, period_month, amount_ugx, payment_reference,
               receipt_photo_path, receipt_url, status, confirmation_note,
               submitted_at, confirmed_at, is_historical
        FROM contribution_payments
        WHERE family_id=%s
        ORDER BY period_month DESC
    """, (family_id,))
    bal = compute_family_balance(family_id)
    return {
        "family": fam[0],
        "balance": bal,
        "payments": [dict(p) for p in payments],
    }


# ──────────────────────────────────────────────────────────
# POST /api/contributions/submit
# ──────────────────────────────────────────────────────────
class SubmitPaymentRequest(BaseModel):
    family_id:         int
    period_month:      Optional[str] = None  # YYYY-MM; auto-computed if omitted
    declared_through:  Optional[str] = None  # last month family declares coverage through
    amount_ugx:        int
    payment_reference: Optional[str] = None
    apply_to_initial_ugx: Optional[int] = 0  # excess applied to opening balance

@router.post("/submit")
def submit_payment(req: SubmitPaymentRequest, request: Request):
    from auth import verify_token
    user = verify_token(request.cookies.get("kimfam_token", ""))
    if not user:
        raise HTTPException(401, "Not authenticated")

    # Auto-compute period_month if not provided
    if not req.period_month:
        if req.declared_through:
            try:
                datetime.strptime(req.declared_through, "%Y-%m")
                req.period_month = req.declared_through
            except ValueError:
                pass
        if not req.period_month:
            preview = payment_preview(req.family_id, req.amount_ugx)
            req.period_month = preview["suggested_period"]
    else:
        try:
            datetime.strptime(req.period_month, "%Y-%m")
        except ValueError:
            raise HTTPException(400, "period_month must be YYYY-MM")
    if req.amount_ugx <= 0:
        raise HTTPException(400, "amount_ugx must be positive")

    fam = query("SELECT id FROM families WHERE id=%s", (req.family_id,))
    if not fam:
        raise HTTPException(404, "Family not found")

    apply_init = req.apply_to_initial_ugx or 0
    row = execute("""
        INSERT INTO contribution_payments
            (family_id, submitted_by_user_id, period_month, amount_ugx,
             payment_reference, status, apply_to_initial_ugx)
        VALUES (%s, %s, %s, %s, %s, 'pending', %s)
        RETURNING id
    """, (req.family_id, user.get("sub",""), req.period_month,
          req.amount_ugx, req.payment_reference, apply_init))
    _pid = row[0]

    # Notify Hillary, Hellen, and the KimFam group via WhatsApp
    try:
        import os as _os
        _fam_name = fam[0]["family_name"].title() if fam else "Unknown"
        _submitter = user.get("sub", "A member")
        _ref_note = f" · Ref: {req.payment_reference}" if req.payment_reference else ""
        _is_staging = _os.environ.get("KIMFAM_ENV", "prod") == "staging"

        # Private message to Hillary + Hellen only — group gets ONE message after receipt upload
        _private_msg = (
            f"💰 *New KimFam Payment Submitted*\n"
            f"Family: The {_fam_name}\n"
            f"Amount: UGX {req.amount_ugx:,}\n"
            f"Period: {req.period_month}\n"
            f"Submitted by: {_submitter}{_ref_note}\n"
            f"Payment #{_pid} — awaiting your confirmation on the app."
        )

        import requests as _req_lib
        _BRIDGE = "http://localhost:8080/api/send"
        _HILLARY = "256775102684"
        _HELLEN  = "254716595631"

        for _num in [_HILLARY, _HELLEN]:
            try:
                _req_lib.post(_BRIDGE, json={"recipient": _num, "message": _private_msg}, timeout=5)
            except Exception:
                pass
        # NOTE: group notification sent in upload_receipt() after receipt is attached
    except Exception:
        pass  # never block the response over a notification failure

    return {"payment_id": _pid, "status": "pending"}


# ──────────────────────────────────────────────────────────
# GET /api/contributions/my-submissions
# ──────────────────────────────────────────────────────────
# Member name → family name (resolved to ID at query time so IDs can differ across DBs)
_MEMBER_FAMILY_NAME = {
    "Hillary": "ARINDAS", "Esther": "ARINDAS",
    "Viola":   "ARUNGAS", "Simon":  "ARUNGAS",
    "Israel":  "KIKANGIS","Merab":  "KIKANGIS",
    "Max":     "TURAMYES","Janet":  "TURAMYES",
    "Solomon": "ARIHOS",
    "Hellen":  "KOFUNAS", "Lawi":   "KOFUNAS",
    "Alex":    "TUHIMBISES","Priscilla":"TUHIMBISES",
}

@router.get("/my-submissions")
def my_submissions(request: Request):
    from auth import verify_token
    user = verify_token(request.cookies.get("kimfam_token", ""))
    if not user:
        raise HTTPException(401, "Not authenticated")
    name = user.get("sub","")
    family_name = _MEMBER_FAMILY_NAME.get(name)
    if not family_name:
        return {"family_id": None, "family_name": None, "payments": []}
    fam_row = query("SELECT id FROM families WHERE family_name=%s", (family_name,))
    if not fam_row:
        return {"family_id": None, "family_name": family_name, "payments": []}
    family_id = fam_row[0]["id"]
    rows = query("""
        SELECT cp.id, cp.period_month, cp.amount_ugx, cp.payment_reference,
               cp.status, cp.confirmation_note, cp.submitted_at, cp.confirmed_at,
               cp.receipt_url, cp.submitted_by_user_id
        FROM contribution_payments cp
        WHERE cp.family_id=%s AND cp.is_historical=FALSE
        ORDER BY cp.submitted_at DESC
        LIMIT 20
    """, (family_id,))
    fam = query("SELECT family_name FROM families WHERE id=%s", (family_id,))
    return {
        "family_id": family_id,
        "family_name": fam[0]["family_name"] if fam else "",
        "payments": [dict(r) for r in rows],
    }


# ──────────────────────────────────────────────────────────
# GET /api/contributions/pending  (Hellen's queue)
# ──────────────────────────────────────────────────────────
@router.get("/pending")
def get_pending(request: Request):
    from auth import verify_token
    user = verify_token(request.cookies.get("kimfam_token", ""))
    if not user:
        raise HTTPException(401, "Not authenticated")
    rows = query("""
        SELECT cp.id, f.family_name, cp.period_month, cp.amount_ugx,
               cp.payment_reference, cp.submitted_by_user_id, cp.submitted_at, cp.receipt_url
        FROM contribution_payments cp
        JOIN families f ON f.id = cp.family_id
        WHERE cp.status = 'pending'
        ORDER BY cp.submitted_at ASC
    """)
    return [dict(r) for r in rows]


# ──────────────────────────────────────────────────────────
# POST /api/contributions/{payment_id}/confirm
# POST /api/contributions/{payment_id}/reject
# ──────────────────────────────────────────────────────────
class ReviewRequest(BaseModel):
    note: Optional[str] = None

@router.post("/{payment_id}/confirm")
def confirm_payment(payment_id: int, req: ReviewRequest, request: Request):
    from auth import verify_token
    user = verify_token(request.cookies.get("kimfam_token", ""))
    if not user:
        raise HTTPException(401, "Not authenticated")
    if user.get("sub") not in {'Hillary', 'Hellen'}:
        raise HTTPException(403, "Admin only")
    row = query("SELECT * FROM contribution_payments WHERE id=%s", (payment_id,))
    if not row:
        raise HTTPException(404, "Payment not found")
    if row[0]["status"] != "pending":
        raise HTTPException(400, f"Payment is already {row[0]['status']}")
    execute("""
        UPDATE contribution_payments
        SET status='confirmed', confirmed_by_user_id=%s,
            confirmation_note=%s, confirmed_at=NOW()
        WHERE id=%s
    """, (user.get("sub",""), req.note, payment_id))
    # If member allocated excess to opening balance, record that
    apply_init = row[0].get("apply_to_initial_ugx") or 0
    if apply_init > 0:
        execute("""
            UPDATE initial_obligations
            SET paid_ugx = LEAST(paid_ugx + %s, obligation_ugx)
            WHERE family_id = %s
        """, (apply_init, row[0]["family_id"]))
    try:
        _cfn = query("SELECT family_name FROM families WHERE id=%s", (row[0]["family_id"],))
        _notif.notify_payment_confirmed(
            family_name=_cfn[0]["family_name"] if _cfn else "",
            amount_ugx=row[0]["amount_ugx"], period_month=row[0]["period_month"],
            payment_id=payment_id, note=req.note,
        )
    except Exception: pass
    return {"status": "confirmed"}

class BankBalanceRequest(BaseModel):
    balance_ugx: int
    note: Optional[str] = None

@router.post("/admin/bank-balance")
def update_bank_balance(req: BankBalanceRequest, request: Request):
    """Treasurer updates the verified ABSA bank balance."""
    from auth import verify_token
    user = verify_token(request.cookies.get("kimfam_token", ""))
    if not user:
        raise HTTPException(401, "Not authenticated")
    if user.get("sub") not in {"Hillary", "Hellen"}:
        raise HTTPException(403, "Treasurer only")
    if req.balance_ugx < 0:
        raise HTTPException(400, "Balance cannot be negative")
    today = date.today().isoformat()
    execute("""
        INSERT INTO club_config (key, value, updated_by, updated_at)
        VALUES ('confirmed_bank_balance', %s, %s, NOW())
        ON CONFLICT (key) DO UPDATE SET value=%s, updated_by=%s, updated_at=NOW()
    """, (str(req.balance_ugx), user.get("sub",""), str(req.balance_ugx), user.get("sub","")))
    execute("""
        INSERT INTO club_config (key, value, updated_by, updated_at)
        VALUES ('confirmed_balance_date', %s, %s, NOW())
        ON CONFLICT (key) DO UPDATE SET value=%s, updated_by=%s, updated_at=NOW()
    """, (today, user.get("sub",""), today, user.get("sub","")))
    return {"ok": True, "balance_ugx": req.balance_ugx, "date": today}

class BankBalanceRequest(BaseModel):
    balance_ugx: int
    note: Optional[str] = None

@router.post("/admin/bank-balance")
def update_bank_balance(req: BankBalanceRequest, request: Request):
    """Treasurer updates the verified ABSA bank balance."""
    from auth import verify_token
    user = verify_token(request.cookies.get("kimfam_token", ""))
    if not user:
        raise HTTPException(401, "Not authenticated")
    if user.get("sub") not in {"Hillary", "Hellen"}:
        raise HTTPException(403, "Treasurer only")
    if req.balance_ugx < 0:
        raise HTTPException(400, "Balance cannot be negative")
    today = date.today().isoformat()
    execute("""
        INSERT INTO club_config (key, value, updated_by, updated_at)
        VALUES ('confirmed_bank_balance', %s, %s, NOW())
        ON CONFLICT (key) DO UPDATE SET value=%s, updated_by=%s, updated_at=NOW()
    """, (str(req.balance_ugx), user.get("sub",""), str(req.balance_ugx), user.get("sub","")))
    execute("""
        INSERT INTO club_config (key, value, updated_by, updated_at)
        VALUES ('confirmed_balance_date', %s, %s, NOW())
        ON CONFLICT (key) DO UPDATE SET value=%s, updated_by=%s, updated_at=NOW()
    """, (today, user.get("sub",""), today, user.get("sub","")))
    return {"ok": True, "balance_ugx": req.balance_ugx, "date": today}

@router.post("/{payment_id}/reject")
def reject_payment(payment_id: int, req: ReviewRequest, request: Request):
    from auth import verify_token
    user = verify_token(request.cookies.get("kimfam_token", ""))
    if not user:
        raise HTTPException(401, "Not authenticated")
    if user.get("sub") not in {'Hillary', 'Hellen'}:
        raise HTTPException(403, "Admin only")
    if not req.note or not req.note.strip():
        raise HTTPException(400, "A rejection reason is required")
    row = query("SELECT * FROM contribution_payments WHERE id=%s", (payment_id,))
    if not row:
        raise HTTPException(404, "Payment not found")
    if row[0]["status"] != "pending":
        raise HTTPException(400, f"Payment is already {row[0]['status']}")
    execute("""
        UPDATE contribution_payments
        SET status='rejected', confirmed_by_user_id=%s,
            confirmation_note=%s, confirmed_at=NOW()
        WHERE id=%s
    """, (user.get("sub",""), req.note, payment_id))
    try:
        _rfn = query("SELECT family_name FROM families WHERE id=%s", (row[0]["family_id"],))
        _notif.notify_payment_rejected(
            family_name=_rfn[0]["family_name"] if _rfn else "",
            amount_ugx=row[0]["amount_ugx"], period_month=row[0]["period_month"],
            payment_id=payment_id, reason=req.note,
            submitted_by=row[0].get("submitted_by_user_id",""),
        )
    except Exception: pass
    return {"status": "rejected"}


# ──────────────────────────────────────────────────────────
# GET /api/contributions/expenditure
# ──────────────────────────────────────────────────────────
@router.get("/expenditure")
def get_expenditure():
    rows = query("""
        SELECT id, txn_date, description, amount_ugx, category, project, recorded_by,
               is_historical, receipt_url, created_at
        FROM expenditure_records
        ORDER BY txn_date DESC, id DESC
    """)
    return [dict(r) for r in rows]


# ──────────────────────────────────────────────────────────
# POST /api/contributions/expenditure  (Hellen records spend)
# ──────────────────────────────────────────────────────────
class ExpenditureRequest(BaseModel):
    txn_date:    str
    description: str
    amount_ugx:  int
    category:    str
    project:     Optional[str] = None

_EXPENSE_ADMINS = {"Hillary", "Hellen"}

@router.post("/expenditure")
def add_expenditure(req: ExpenditureRequest, request: Request):
    from auth import verify_token
    user = verify_token(request.cookies.get("kimfam_token", ""))
    if not user:
        raise HTTPException(401, "Not authenticated")
    if user.get("sub") not in _EXPENSE_ADMINS:
        raise HTTPException(403, "Only Hillary and Hellen can record expenses")
    try:
        _dt = datetime.strptime(req.txn_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "txn_date must be YYYY-MM-DD")
    if _dt > date.today():
        raise HTTPException(400, "Date cannot be in the future")
    desc = (req.description or "").strip()
    if not desc:
        raise HTTPException(400, "Description is required")
    if req.amount_ugx is None or req.amount_ugx <= 0:
        raise HTTPException(400, "Amount must be greater than zero")
    VALID_CATEGORIES = {"project_investment", "staff", "event", "loan", "other"}
    if req.category not in VALID_CATEGORIES:
        raise HTTPException(400, f"category must be one of {sorted(VALID_CATEGORIES)}")
    row = execute("""
        INSERT INTO expenditure_records
            (txn_date, description, amount_ugx, category, project, recorded_by)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id
    """, (req.txn_date, desc, req.amount_ugx,
          req.category, req.project, user.get("sub","")))
    return {"expenditure_id": row[0]}


# ──────────────────────────────────────────────────────────
# POST /api/contributions/expenditure/{id}/receipt — file upload
# ──────────────────────────────────────────────────────────
@router.post("/expenditure/{expense_id}/receipt")
async def upload_expenditure_receipt(expense_id: int, request: Request):
    from auth import verify_token
    from fastapi import UploadFile, File as FastAPIFile
    from pathlib import Path as _Path
    import os as _os, re as _re
    user = verify_token(request.cookies.get("kimfam_token", ""))
    if not user:
        raise HTTPException(401, "Not authenticated")
    if user.get("sub") not in _EXPENSE_ADMINS:
        raise HTTPException(403, "Only Hillary and Hellen can attach receipts")
    form = await request.form()
    file = form.get("file")
    if not file:
        raise HTTPException(400, "No file uploaded")
    row = query("SELECT id FROM expenditure_records WHERE id=%s", (expense_id,))
    if not row:
        raise HTTPException(404, "Expenditure not found")
    _BASE = "/var/www/kimfamhub-staging" if _os.environ.get("KIMFAM_ENV")=="staging" else "/var/www/kimfamhub"
    EXP_DIR = _Path(_BASE + "/static/expenditures")
    EXP_DIR.mkdir(exist_ok=True)
    safe_name = _re.sub(r"[^A-Za-z0-9._-]", "_", file.filename or "receipt")
    dest = EXP_DIR / f"{expense_id}_{safe_name}"
    contents = await file.read()
    with open(dest, "wb") as f:
        f.write(contents)
    url = f"/static/expenditures/{expense_id}_{safe_name}"
    execute("UPDATE expenditure_records SET receipt_url=%s WHERE id=%s", (url, expense_id))
    return {"ok": True, "expenditure_id": expense_id, "receipt_url": url}


# ──────────────────────────────────────────────────────────
# GET /api/contributions/family/{family_id}/preview
# ──────────────────────────────────────────────────────────
@router.get("/family/{family_id}/preview")
def payment_preview(family_id: int, amount: int = 0):
    """Given a family and optional amount, return balance info + coverage breakdown."""
    fam = query("SELECT family_name FROM families WHERE id=%s", (family_id,))
    if not fam:
        raise HTTPException(404, "Family not found")

    bal = compute_family_balance(family_id)
    combined = bal["combined_balance"]
    monthly_paid_net = bal["total_monthly_paid"] - bal["initial_paid"]

    today = date.today()
    current_ym = today.strftime("%Y-%m")
    monthly_rate = compute_monthly_obligation(family_id, current_ym)

    # Find oldest unpaid month (FIFO)
    if today.month == 1:
        end_y, end_m = today.year - 1, 12
    else:
        end_y, end_m = today.year, today.month - 1
    end_ym = f"{end_y:04d}-{end_m:02d}"

    y, m = 2023, 1
    cumulative = 0
    suggested_period = None
    while True:
        ym = f"{y:04d}-{m:02d}"
        obl = compute_monthly_obligation(family_id, ym)
        cumulative += obl
        if cumulative > monthly_paid_net:
            suggested_period = ym
            break
        if ym == end_ym:
            break
        m += 1
        if m > 12:
            m = 1; y += 1

    if not suggested_period:
        nm = end_m + 1; ny = end_y
        if nm > 12: nm = 1; ny += 1
        suggested_period = f"{ny:04d}-{nm:02d}"

    coverage = None
    if amount > 0 and monthly_rate > 0:
        new_balance = combined - amount
        if combined > 0:
            coverage = {
                "new_balance": new_balance,
                "months_cleared_approx": round(amount / monthly_rate, 1),
                "fully_clears_arrears": amount >= combined
            }
        else:
            coverage = {
                "new_balance": new_balance,
                "months_ahead": round(abs(new_balance) / monthly_rate, 1)
            }

    return {
        "family_id":            family_id,
        "family_name":          fam[0]["family_name"],
        "combined_balance":     combined,
        "initial_balance":      bal["initial_balance"],
        "current_balance":      bal["current_balance"],
        "current_monthly_rate": monthly_rate,
        "suggested_period":     suggested_period,
        "coverage":             coverage,
    }


# ──────────────────────────────────────────────────────────
# POST /api/contributions/{payment_id}/receipt
# ──────────────────────────────────────────────────────────
@router.post("/{payment_id}/receipt")
async def upload_receipt(payment_id: int, request: Request):
    """Upload a bank receipt photo and link it to a pending payment."""
    import re as _re
    from pathlib import Path as _Path
    from auth import verify_token
    user = verify_token(request.cookies.get("kimfam_token", ""))
    if not user:
        raise HTTPException(401, "Not authenticated")
    payment = query("SELECT id, status FROM contribution_payments WHERE id=%s", (payment_id,))
    if not payment:
        raise HTTPException(404, "Payment not found")
    # Attaching to a pending payment is the normal submit flow (any member). Back-filling
    # a receipt onto an already-confirmed payment is an admin (Hellen/Hillary) action.
    if payment[0]["status"] == "confirmed" and user.get("sub") not in {'Hillary', 'Hellen'}:
        raise HTTPException(403, "Only Hellen or Hillary can attach a receipt to a confirmed payment")
    form = await request.form()
    receipt_file = form.get("file")
    if not receipt_file:
        raise HTTPException(400, "No file provided")
    import os as _os; _BASE = "/var/www/kimfamhub-staging" if _os.environ.get("KIMFAM_ENV")=="staging" else "/var/www/kimfamhub"; RECEIPTS_DIR = _Path(_BASE+"/static/receipts")
    RECEIPTS_DIR.mkdir(exist_ok=True)
    safe_name = _re.sub(r'[^\w.]', '_', receipt_file.filename or 'receipt.jpg')
    dest = RECEIPTS_DIR / f"{payment_id}_{safe_name}"
    contents = await receipt_file.read()
    with open(str(dest), "wb") as f_out:
        f_out.write(contents)
    url = f"/static/receipts/{payment_id}_{safe_name}"
    execute("UPDATE contribution_payments SET receipt_url=%s WHERE id=%s", (url, payment_id))

    _row = query(
        "SELECT cp.amount_ugx, cp.period_month, cp.status, f.family_name"
        " FROM contribution_payments cp JOIN families f ON f.id=cp.family_id WHERE cp.id=%s",
        (payment_id,)
    )
    _r = _row[0] if _row else None

    # Also file the receipt into Documents -> Receipts so it is browsable in the
    # document library, not only via the payment row. Best-effort: a filing failure
    # must never fail the receipt upload itself.
    if _r:
        try:
            from main import _store_document_bytes
            _ext = _Path(safe_name).suffix.lower() or ".jpg"
            _fam = _r["family_name"].title()
            _period = str(_r["period_month"])
            _yr = _period[:4] if len(_period) >= 4 and _period[:4].isdigit() else ""
            _docname = f"The {_fam} - {_period} - UGX {_r['amount_ugx']:,}{_ext}"
            _store_document_bytes(contents, "receipts", _docname,
                                  subgroup=(f"KimFam ({_yr})" if _yr else "KimFam"))
        except Exception:
            pass

    # WhatsApp notice ONLY for a pending payment (a fresh submission awaiting
    # confirmation). Back-filling a receipt onto an already-confirmed / historical
    # payment must not spam the group with "awaiting Hellen's confirmation".
    if _r and _r["status"] == "pending":
        try:
            import os as _os2, requests as _req_lib2
            _is_stg = _os2.environ.get("KIMFAM_ENV", "prod") == "staging"
            _base_url = "https://staging.kimfamhub.com" if _is_stg else "https://kimfamhub.com"
            _receipt_full = f"{_base_url}{url}"
            _group = "120363429341325971@g.us" if _is_stg else "254716595631-1631997730@g.us"
            _receipt_msg = (
                f"📎 Receipt attached for The {_r['family_name'].title()}'s payment of UGX {_r['amount_ugx']:,} "
                f"(Period: {_r['period_month']}).\n"
                f"View receipt: {_receipt_full}\n"
                f"Payment #{payment_id} — awaiting Hellen's confirmation."
            )
            _req_lib2.post("http://localhost:8080/api/send",
                           json={"recipient": _group, "message": _receipt_msg}, timeout=5)
        except Exception:
            pass
    return {"url": url}
