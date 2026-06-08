"""
KimFam Hub — background notification scheduler.
All scheduled jobs run in-process via APScheduler.

Jobs:
  every 30 min  : poll_action_tracker  — detect sheet changes, fire update alerts
  daily 08:00   : check_action_deadlines — warn 3 and 1 days before due; weekly nudge for overdue with no update
  daily 08:00   : check_loan_due        — warn 7 days before loan repayment
  5th 08:00     : monthly_payment_reminders — families still owing prev month
"""
import os, re, hashlib, sqlite3, logging
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler

import notifications as _notif

log = logging.getLogger(__name__)

KAMPALA = ZoneInfo("Africa/Kampala")
_SIG = "\n\n_(via KimFam Hub)_"
IS_STAGING = os.environ.get("KIMFAM_ENV", "prod") == "staging"

# ── Cache DB (reuse kimfam.db) ─────────────────────────────────────────────
_DB = os.environ.get("KIMFAM_DB_PATH", "/var/www/kimfamhub/data/kimfam.db")

def _db():
    conn = sqlite3.connect(_DB)
    conn.row_factory = sqlite3.Row
    return conn

def _ensure_cache_table():
    with _db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS action_tracker_cache (
                action_id       TEXT PRIMARY KEY,
                row_hash        TEXT NOT NULL,
                last_status     TEXT,
                last_update     TEXT,
                notified_deadline_3d INTEGER DEFAULT 0,
                notified_deadline_1d INTEGER DEFAULT 0,
                notified_overdue_at  TEXT,
                updated_at      TEXT
            )
        """)
        conn.commit()
        # Additive migration: add notified_overdue_at if the table was created before this column
        try:
            conn.execute("ALTER TABLE action_tracker_cache ADD COLUMN notified_overdue_at TEXT")
            conn.commit()
        except Exception:
            pass  # column already exists

# ── Name normalisation ─────────────────────────────────────────────────────
ALL_MEMBERS = list(_notif.MEMBER_PHONES.keys())
import family_db as _fdb

_ALL_MEMBERS_SENTINEL = "__ALL_MEMBERS__"

def _parse_responsible(responsible: str):
    return _fdb.parse_responsible(responsible, _ALL_MEMBERS_SENTINEL)

def _phones(names) -> list[str]:
    if names == _ALL_MEMBERS_SENTINEL:
        return [p for p in _notif.MEMBER_PHONES.values() if p]
    return [p for n in (names or []) if (p := _notif.MEMBER_PHONES.get(n))]

def _send_action_notification(responsible: str, msg: str):
    parsed = _parse_responsible(responsible)
    group = _notif.GROUP_KIMFAMTEST if IS_STAGING else _notif.GROUP_KIM_PROJECTS
    if parsed == _ALL_MEMBERS_SENTINEL:
        if IS_STAGING:
            _notif._send(_notif.HILLARY_PHONE, msg)
        _notif._send(group, msg)
    else:
        phones = _phones(parsed)
        seen = set()
        if IS_STAGING:
            phones = [_notif.HILLARY_PHONE]
        for phone in phones:
            if phone and phone not in seen:
                seen.add(phone)
                _notif._send(phone, msg)


# ── Date parsing ──────────────────────────────────────────────────────────────
def _parse_date(s: str):
    """Parse sheet date strings: '31 May 2026', '31/05/2026', '2026-05-31'."""
    if not s or not s.strip():
        return None
    s = s.strip()
    for fmt in ("%d %B %Y", "%d %b %Y", "%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None

# ── Google Sheet access ──────────────────────────────────────────────────
def _get_action_rows():
    """Fetch all rows from Action Tracker sheet."""
    try:
        import gspread
        from google.oauth2.service_account import Credentials
        SCOPES = ["https://www.googleapis.com/auth/spreadsheets",
                  "https://www.googleapis.com/auth/drive"]
        SA_PATH = os.environ.get("GOOGLE_SA_PATH", "/var/www/kimfamhub/service-account.json")
        creds = Credentials.from_service_account_file(SA_PATH, scopes=SCOPES)
        gc = gspread.authorize(creds)
        SHEET_ID = os.environ.get("SHEET_ID", "1R3_j2ArvMZsfiLDvFwEQURJBXEPaW3mmWU-FyUwrqPg")
        rows = gc.open_by_key(SHEET_ID).worksheet("Action Tracker").get_all_records()
        return rows
    except Exception as e:
        log.warning("Action Tracker fetch failed: %s", e)
        return []

def _get_meeting_rows():
    try:
        import gspread
        from google.oauth2.service_account import Credentials
        SCOPES = ["https://www.googleapis.com/auth/spreadsheets",
                  "https://www.googleapis.com/auth/drive"]
        SA_PATH = os.environ.get("GOOGLE_SA_PATH", "/var/www/kimfamhub/service-account.json")
        creds = Credentials.from_service_account_file(SA_PATH, scopes=SCOPES)
        gc = gspread.authorize(creds)
        SHEET_ID = os.environ.get("SHEET_ID", "1R3_j2ArvMZsfiLDvFwEQURJBXEPaW3mmWU-FyUwrqPg")
        rows = gc.open_by_key(SHEET_ID).worksheet("2026 Meeting Register").get_all_records()
        return rows
    except Exception as e:
        log.warning("Meeting Register fetch failed: %s", e)
        return []

# ─────────────────────────────────────────────────────────────────────────────
# JOB 1: Poll Action Tracker for changes (every 30 min)
# ─────────────────────────────────────────────────────────────────────────────
def poll_action_tracker():
    log.info("Scheduler: polling Action Tracker sheet")
    rows = _get_action_rows()
    if not rows:
        return
    with _db() as conn:
        for r in rows:
            action_id   = str(r.get("Action ID", "")).strip()
            if not action_id:
                continue
            status      = str(r.get("Status", "")).strip()
            latest_upd  = str(r.get("Latest Update", "")).strip()
            responsible = str(r.get("Responsible", "")).strip()
            description = str(r.get("Action Description", "")).strip()
            deadline    = str(r.get("Deadline", "")).strip()

            row_hash = hashlib.md5(f"{status}|{latest_upd}".encode()).hexdigest()

            cached = conn.execute(
                "SELECT row_hash, last_status, last_update FROM action_tracker_cache WHERE action_id=?",
                (action_id,)
            ).fetchone()

            now_str = datetime.now(KAMPALA).isoformat()

            if cached is None:
                # First time seeing this row — store, no notification
                conn.execute("""
                    INSERT INTO action_tracker_cache
                      (action_id, row_hash, last_status, last_update, updated_at)
                    VALUES (?,?,?,?,?)
                """, (action_id, row_hash, status, latest_upd, now_str))
                conn.commit()
                continue

            if cached["row_hash"] == row_hash:
                continue  # no change

            # Something changed — determine what
            old_status = cached["last_status"] or ""
            old_update = cached["last_update"] or ""
            changes = []
            if status != old_status:
                changes.append(f"Status: {old_status} → {status}")
            if latest_upd != old_update and latest_upd:
                changes.append(f"Update: {latest_upd}")

            conn.execute("""
                UPDATE action_tracker_cache
                SET row_hash=?, last_status=?, last_update=?, updated_at=?
                WHERE action_id=?
            """, (row_hash, status, latest_upd, now_str, action_id))
            conn.commit()

            if not changes:
                continue

            # Only notify for open actions — skip Done/Closed/Carried Over
            if status in ("Done", "Closed", "Carried Over"):
                continue

            env = " [STAGING]" if IS_STAGING else ""
            msg = (
                f"*KimFam Action Update{env}*\n"
                f"*Ref:* {action_id}\n"
                f"*Action:* {description}\n"
                + "\n".join(changes) +
                (f"\n*Deadline:* {deadline}" if deadline else "")
            )
            _send_action_notification(responsible, msg)
            log.info("Action update notified: %s", action_id)

# ─────────────────────────────────────────────────────────────────────────────
# JOB 2: Deadline warnings — 3 days and 1 day before (daily 08:00)
# ─────────────────────────────────────────────────────────────────────────────
def check_action_deadlines():
    log.info("Scheduler: checking action deadlines")
    rows = _get_action_rows()
    if not rows:
        return
    today = datetime.now(KAMPALA).date()
    with _db() as conn:
        for r in rows:
            action_id = str(r.get("Action ID", "")).strip()
            if not action_id:
                continue
            status = str(r.get("Status", "")).strip()
            if status in ("Done", "Closed", "Carried Over"):
                continue
            deadline_str  = str(r.get("Deadline", "")).strip()
            responsible   = str(r.get("Responsible", "")).strip()
            description   = str(r.get("Action Description", "")).strip()
            deadline_date = _parse_date(deadline_str)
            if not deadline_date:
                continue
            days_left = (deadline_date - today).days

            # ── Overdue nudge (weekly, only if no Latest Update recorded) ──
            if days_left < 0:
                latest_update = str(r.get("Latest Update", "")).strip()
                if latest_update:
                    continue  # someone has logged progress — don't spam
                cached = conn.execute(
                    "SELECT notified_overdue_at FROM action_tracker_cache WHERE action_id=?",
                    (action_id,)
                ).fetchone()
                if cached is None:
                    row_hash = hashlib.md5(f"{status}|".encode()).hexdigest()
                    conn.execute("""
                        INSERT OR IGNORE INTO action_tracker_cache
                          (action_id, row_hash, last_status, updated_at)
                        VALUES (?,?,?,?)
                    """, (action_id, row_hash, status, datetime.now(KAMPALA).isoformat()))
                    conn.commit()
                    cached = conn.execute(
                        "SELECT notified_overdue_at FROM action_tracker_cache WHERE action_id=?",
                        (action_id,)
                    ).fetchone()
                last_sent = cached["notified_overdue_at"] if cached else None
                if last_sent:
                    days_since = (today - date.fromisoformat(last_sent[:10])).days
                    if days_since < 7:
                        continue
                days_overdue = abs(days_left)
                env = " [STAGING]" if IS_STAGING else ""
                msg = (
                    f"*KimFam Overdue Action{env}* ⚠️\n"
                    f"*Ref:* {action_id}\n"
                    f"*Action:* {description}\n"
                    f"*Assigned to:* {responsible}\n"
                    f"*Was due:* {deadline_str} ({days_overdue} day{'s' if days_overdue != 1 else ''} overdue)\n"
                    f"_No update recorded. Please log progress on kimfamhub.com_" + _SIG
                )
                _send_action_notification(responsible, msg)
                conn.execute(
                    "UPDATE action_tracker_cache SET notified_overdue_at=? WHERE action_id=?",
                    (today.isoformat(), action_id)
                )
                conn.commit()
                log.info("Overdue nudge sent: %s (%d days overdue)", action_id, days_overdue)
                continue

            if days_left not in (3, 1):
                continue

            col  = "notified_deadline_3d" if days_left == 3 else "notified_deadline_1d"
            cached = conn.execute(
                f"SELECT {col} FROM action_tracker_cache WHERE action_id=?",
                (action_id,)
            ).fetchone()

            # Ensure row exists in cache
            if cached is None:
                row_hash = hashlib.md5(f"{status}|".encode()).hexdigest()
                conn.execute("""
                    INSERT OR IGNORE INTO action_tracker_cache
                      (action_id, row_hash, last_status, updated_at)
                    VALUES (?,?,?,?)
                """, (action_id, row_hash, status, datetime.now(KAMPALA).isoformat()))
                conn.commit()
                cached = conn.execute(
                    f"SELECT {col} FROM action_tracker_cache WHERE action_id=?",
                    (action_id,)
                ).fetchone()

            if cached and cached[col]:
                continue  # already notified for this threshold

            urgency = "tomorrow" if days_left == 1 else "in 3 days"
            env = " [STAGING]" if IS_STAGING else ""
            latest_update = str(r.get("Latest Update", "")).strip()
            update_line = f"_Last update: {latest_update}_" if latest_update else "_No update recorded yet._"
            msg = (
                f"*KimFam Deadline Reminder{env}* \u23f0\n"
                f"*Ref:* {action_id}\n"
                f"*Action:* {description}\n"
                f"*Assigned to:* {responsible}\n"
                f"*Due:* {deadline_str} ({urgency})\n"
                f"{update_line}" + _SIG
            )
            _send_action_notification(responsible, msg)
            conn.execute(
                f"UPDATE action_tracker_cache SET {col}=1 WHERE action_id=?",
                (action_id,)
            )
            conn.commit()
            log.info("Deadline reminder sent: %s (%d days)", action_id, days_left)

# ─────────────────────────────────────────────────────────────────────────────
# JOB 3: Monthly payment reminders — 5th of each month 08:00
# ─────────────────────────────────────────────────────────────────────────────
def monthly_payment_reminders():
    log.info("Scheduler: sending monthly payment reminders")
    try:
        import sys as _sys
        _sys.path.insert(0, "/var/www/kimfamhub")
        from contributions import get_ledger
    except Exception as e:
        log.warning("monthly_payment_reminders import error: %s", e)
        return

    today = datetime.now(KAMPALA).date()
    month_label = today.strftime("%B %Y")
    env = " [STAGING]" if IS_STAGING else ""

    try:
        ledger = get_ledger()
    except Exception as e:
        log.warning("monthly_payment_reminders ledger error: %s", e)
        return

    for row in ledger:
        combined = row.get("combined_balance", 0) or 0
        if combined <= 0:
            # In credit or fully paid up — no reminder
            continue

        family_name = row["family_name"]
        phones = _notif._phones_for_family(family_name)
        if not phones:
            continue

        monthly_bal = row.get("current_balance", 0) or 0
        initial_bal = row.get("initial_balance", 0) or 0
        rate = row.get("current_monthly_rate", 0) or 0

        # Build balance breakdown
        lines = []
        if monthly_bal > 0:
            lines.append(f"  Monthly arrears: UGX {monthly_bal:,}")
        if initial_bal > 0:
            lines.append(f"  Opening balance: UGX {initial_bal:,}")
        lines.append(f"  *Total outstanding: UGX {combined:,}*")
        if rate:
            lines.append(f"  Current monthly rate: UGX {rate:,}")
        balance_block = "\n".join(lines)

        msg = (
            f"\U0001f4c5 *KimFam Monthly Reminder{env}*\n"
            f"*Family:* {family_name} | *Month:* {month_label}\n\n"
            f"{balance_block}\n\n"
            f"Please pay to ABSA *6004961127* (TUSIIME HELLEN) by the 10th.\n"
            f"Log in at kimfamhub.com to submit your payment.\n\n"
            f"_KimFam Hub_"
        )

        # Payment reminders are personal — send to family DMs only, not the group
        seen = set()
        if IS_STAGING:
            phones = [_notif.HILLARY_PHONE]
        for phone in phones:
            if phone and phone not in seen:
                seen.add(phone)
                _notif._send(phone, msg)
        log.info("Monthly reminder sent: %s (owes UGX %s)", family_name, f"{combined:,}")

# ─────────────────────────────────────────────────────────────────────────────
# JOB 4a: Meeting reminder — day before at 08:00 Kampala
# ─────────────────────────────────────────────────────────────────────────────
def check_meeting_reminders():
    log.info("Scheduler: checking meeting reminders (day-before)")
    rows = _get_meeting_rows()
    if not rows:
        return
    tomorrow = (datetime.now(KAMPALA) + timedelta(days=1)).date()
    env = " [STAGING]" if IS_STAGING else ""
    for r in rows:
        date_str = str(r.get("Date", "") or r.get("Meeting Date", "")).strip()
        ref      = str(r.get("Meeting Ref", "") or r.get("Ref", "")).strip()
        venue    = str(r.get("Venue", "") or r.get("Location", "")).strip()
        d = _parse_date(date_str)
        if d == tomorrow:
            msg = (
                f"📋 *KimFam Meeting Tomorrow{env}*\n"
                f"*Ref:* {ref}\n"
                f"*Date:* {date_str}\n"
                f"*Time:* 4:30pm EAT\n"
                + (f"*Venue:* {venue}\n" if venue else "") +
                f"_Come prepared. Minutes and actions tracked on kimfamhub.com_ 💻"
                + _SIG
            )
            all_phones = [p for p in _notif.MEMBER_PHONES.values() if p]
            _notif._broadcast(all_phones, msg)
            log.info("Day-before meeting reminder sent for %s", ref)
            break


# JOB 4b: Meeting reminder — same day at 16:30 Kampala
# ─────────────────────────────────────────────────────────────────────────────
def check_meeting_today():
    log.info("Scheduler: checking meeting reminders (same-day 4:30pm)")
    rows = _get_meeting_rows()
    if not rows:
        return
    today = datetime.now(KAMPALA).date()
    env = " [STAGING]" if IS_STAGING else ""
    for r in rows:
        date_str = str(r.get("Date", "") or r.get("Meeting Date", "")).strip()
        ref      = str(r.get("Meeting Ref", "") or r.get("Ref", "")).strip()
        venue    = str(r.get("Venue", "") or r.get("Location", "")).strip()
        d = _parse_date(date_str)
        if d == today:
            msg = (
                f"🔔 *KimFam Meeting Today{env}*\n"
                f"*Ref:* {ref}\n"
                f"*Time:* 4:30pm EAT — starting now\n"
                + (f"*Venue:* {venue}\n" if venue else "") +
                f"_Track minutes and actions live on kimfamhub.com_ 💻"
                + _SIG
            )
            all_phones = [p for p in _notif.MEMBER_PHONES.values() if p]
            _notif._broadcast(all_phones, msg)
            log.info("Same-day meeting reminder sent for %s", ref)
            break

# ─────────────────────────────────────────────────────────────────────────────
# Scheduler startup
# ─────────────────────────────────────────────────────────────────────────────
_scheduler = None

def start():
    global _scheduler
    # Use a PostgreSQL advisory lock so only one gunicorn worker runs the scheduler.
    # pg_try_advisory_lock(key) returns true if this process acquired it; false otherwise.
    # The lock is released automatically when the DB connection closes (worker dies).
    try:
        import psycopg2
        _lock_conn = psycopg2.connect(os.environ.get("DATABASE_URL", ""))
        _lock_conn.autocommit = True
        cur = _lock_conn.cursor()
        cur.execute("SELECT pg_try_advisory_lock(987654321)")
        acquired = cur.fetchone()[0]
        if not acquired:
            log.info("Scheduler PG lock held by another worker — skipping")
            return
        log.info("Scheduler PG advisory lock acquired")
    except Exception as e:
        log.warning("Scheduler PG lock error, running anyway: %s", e)
    _ensure_cache_table()
    _scheduler = BackgroundScheduler(timezone=KAMPALA)
    # Action tracker poll: every 30 minutes
    _scheduler.add_job(poll_action_tracker, "interval", minutes=30,
                       id="poll_actions", replace_existing=True)
    # Daily jobs at 08:00 Kampala
    _scheduler.add_job(check_action_deadlines, "cron", hour=8, minute=0,
                       id="deadline_check", replace_existing=True)
    _scheduler.add_job(check_meeting_reminders, "cron", hour=8, minute=0,
                       id="meeting_reminder", replace_existing=True)
    _scheduler.add_job(check_meeting_today, "cron", hour=16, minute=30,
                       id="meeting_today", replace_existing=True)
    _scheduler.add_job(check_loan_due, "cron", hour=8, minute=5,
                       id="loan_due", replace_existing=True)
    # Monthly on 5th at 08:00
    _scheduler.add_job(monthly_payment_reminders, "cron", day=5, hour=8, minute=0,
                       id="monthly_reminder", replace_existing=True)
    _scheduler.start()
    log.info("KimFam scheduler started (%s mode)", "STAGING" if IS_STAGING else "PROD")

def stop():
    if _scheduler:
        _scheduler.shutdown(wait=False)

# ─────────────────────────────────────────────────────────────────────────────
# JOB 5: Loan due warning — 7 days before (daily 08:05)
# ─────────────────────────────────────────────────────────────────────────────
def check_loan_due():
    log.info("Scheduler: checking loan due dates")
    try:
        import psycopg2, psycopg2.extras
        conn = psycopg2.connect(os.environ.get("DATABASE_URL", ""))
        cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT ld.id, ld.member_name, ld.amount_ugx, ld.due_date,
                   COALESCE(SUM(lp.amount_ugx),0) AS total_paid
            FROM loan_disbursements ld
            LEFT JOIN loan_payments lp ON lp.loan_id = ld.id
            GROUP BY ld.id, ld.member_name, ld.amount_ugx, ld.due_date
            HAVING COALESCE(SUM(lp.amount_ugx),0) < ld.amount_ugx
               AND ld.due_date IS NOT NULL
        """)
        loans = cur.fetchall()
        conn.close()
    except Exception as e:
        log.warning("check_loan_due DB error: %s", e)
        return
    today = datetime.now(KAMPALA).date()
    env   = " [STAGING]" if IS_STAGING else ""
    for loan in loans:
        due = loan["due_date"]
        if hasattr(due, "date"):
            due = due.date()
        days_left = (due - today).days
        if days_left != 7:
            continue
        member = loan["member_name"] or ""
        phone  = _notif.MEMBER_PHONES.get(member)
        balance = loan["amount_ugx"] - (loan["total_paid"] or 0)
        msg = (
            f"💳 *KimFam Loan Reminder{env}*\n"
            f"*Member:* {member}\n"
            f"*Balance due:* UGX {balance:,}\n"
            f"*Due date:* {due.strftime('%d %B %Y')} _(7 days)_\n"
            f"_Please repay to ABSA *6004961127* (TUSIIME HELLEN)_ 🏦"
            + _SIG
        )
        phones = [phone] if phone else []
        _notif._broadcast(phones, msg)
        log.info("Loan due reminder sent: %s", member)
