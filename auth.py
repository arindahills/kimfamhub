"""
KimFam Hub — Member Authentication
Username (first name) + password login, bcrypt hashed, JWT 30-day sessions.
Hillary sets initial passwords per member and shares them privately.
Users must change password on first login.
"""
import os
import random
import sqlite3
import bcrypt
import jwt
import requests
from datetime import datetime, timedelta, timezone
from pathlib import Path

DB_PATH = os.environ.get("KIMFAM_DB_PATH", "/var/www/kimfamhub/data/kimfam.db")
JWT_SECRET = os.environ.get("JWT_SECRET", "kimfam-change-this-secret")
JWT_ALGO = "HS256"
JWT_DAYS = 30

WHATSAPP_BRIDGE_URL = os.environ.get("WHATSAPP_BRIDGE_URL", "http://localhost:8080")
STAGING_OTP_PHONE   = os.environ.get("STAGING_OTP_PHONE", "256775102684")  # Hillary
IS_STAGING          = os.environ.get("KIMFAM_ENV", "prod") == "staging"

MEMBER_PHONES = {
    "Hillary":   "256775102684",
    "Hellen":    "254716595631",
    "Alex":      "256782576807",
    "Israel":    "256772625387",
    "Simon":     "256706397738",
    "Esther":    "256775368069",
    "Janet":     "256773134913",
    "Lawi":      "254708602681",
    "Max":       "256782190580",
    "Priscilla": "256702022899",
    "Solomon":   "256779324208",
    "Viola":     "256706769733",
    "Merab":     None,  # not on WhatsApp yet
}

MEMBERS = [
    {"name": "Israel",    "display": "Dad (Israel)",  "role": "admin"},
    {"name": "Merab",     "display": "Mum (Merab)",   "role": "member"},
    {"name": "Alex",      "display": "Alex",          "role": "member"},
    {"name": "Priscilla", "display": "Priscilla",     "role": "member"},
    {"name": "Max",       "display": "Max",           "role": "member"},
    {"name": "Janet",     "display": "Janet",         "role": "member"},
    {"name": "Viola",     "display": "Viola",         "role": "member"},
    {"name": "Simon",     "display": "Simon",         "role": "member"},
    {"name": "Solomon",   "display": "Solomon",       "role": "member"},
    {"name": "Hillary",   "display": "Hillary",       "role": "admin"},
    {"name": "Esther",    "display": "Esther",        "role": "member"},
    {"name": "Hellen",    "display": "Hellen",        "role": "admin"},
    {"name": "Lawi",      "display": "Lawi",          "role": "member"},
]


def _conn():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""CREATE TABLE IF NOT EXISTS members (
        name                TEXT PRIMARY KEY,
        display             TEXT NOT NULL,
        password_hash       TEXT NOT NULL,
        role                TEXT NOT NULL DEFAULT 'member',
        must_change_password INTEGER DEFAULT 1,
        created_at          TEXT DEFAULT (datetime('now'))
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        token      TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used       INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
    )""")
    conn.commit()
    return conn


def _migrate():
    """Add columns and rename legacy columns if upgrading."""
    with _conn() as conn:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(members)").fetchall()]
        if "pin_hash" in cols and "password_hash" not in cols:
            conn.execute("ALTER TABLE members RENAME COLUMN pin_hash TO password_hash")
            conn.commit()
            print("Migrated: pin_hash -> password_hash")
        if "must_change_pin" in cols and "must_change_password" not in cols:
            conn.execute("ALTER TABLE members RENAME COLUMN must_change_pin TO must_change_password")
            conn.commit()
            print("Migrated: must_change_pin -> must_change_password")
        if "display" not in cols:
            conn.execute("ALTER TABLE members ADD COLUMN display TEXT NOT NULL DEFAULT ''")
            conn.commit()
        if "status_message" not in cols:
            conn.execute("ALTER TABLE members ADD COLUMN status_message TEXT DEFAULT ''")
            conn.commit()
        if "is_locked" not in cols:
            conn.execute("ALTER TABLE members ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 1")
            conn.commit()
            rows = conn.execute("SELECT name, password_hash FROM members").fetchall()
            import bcrypt as _bc
            for name, pw_hash in rows:
                if pw_hash and not _bc.checkpw(b"__locked__", pw_hash.encode()):
                    conn.execute("UPDATE members SET is_locked=0 WHERE name=?", (name,))
            conn.commit()
            print("Migrated: added is_locked column")
        if "phone" not in cols:
            conn.execute("ALTER TABLE members ADD COLUMN phone TEXT DEFAULT NULL")
            conn.commit()
            for name, phone in MEMBER_PHONES.items():
                if phone:
                    conn.execute("UPDATE members SET phone=? WHERE name=?", (phone, name))
            conn.commit()
            print("Migrated: added phone column + populated numbers")


def seed_members():
    """Ensure all 13 members exist in DB. New members get no password (must be set by admin)."""
    _migrate()
    with _conn() as conn:
        existing = {r[0] for r in conn.execute("SELECT name FROM members").fetchall()}
        added = []
        for m in MEMBERS:
            if m["name"] not in existing:
                # Placeholder hash — account is locked until admin sets password
                placeholder = bcrypt.hashpw(b"__locked__", bcrypt.gensalt()).decode()
                conn.execute(
                    "INSERT INTO members (name, display, password_hash, role, must_change_password) VALUES (?,?,?,?,1)",
                    (m["name"], m["display"], placeholder, m["role"])
                )
                added.append(m["name"])
        conn.commit()
    if added:
        print(f"Added new members (password not set): {added}")


def set_password(name: str, new_password: str) -> bool:
    """Admin function: set (or reset) a member's password. Marks must_change_password=1."""
    if len(new_password) < 6:
        return False
    with _conn() as conn:
        row = conn.execute("SELECT name FROM members WHERE name=?", (name,)).fetchone()
        if not row:
            return False
        h = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
        conn.execute(
            "UPDATE members SET password_hash=?, must_change_password=1, is_locked=0 WHERE name=?",
            (h, name)
        )
        conn.commit()
    return True


def login(name: str, password: str) -> dict | None:
    """Validate username + password. Returns JWT token dict or None."""
    with _conn() as conn:
        row = conn.execute(
            "SELECT password_hash, role, display, must_change_password, COALESCE(status_message,'') as status_message, COALESCE(is_locked,1) FROM members WHERE name=?",
            (name,)
        ).fetchone()
    if not row:
        return None
    password_hash, role, display, must_change, status_message, is_locked = row
    if is_locked:
        return None
    if not bcrypt.checkpw(password.encode(), password_hash.encode()):
        return None
    payload = {
        "sub": name,
        "display": display,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_DAYS),
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)
    with _conn() as conn:
        conn.execute("UPDATE members SET last_login=datetime('now') WHERE name=?", (name,))
        conn.commit()
    return {
        "token": token,
        "name": name,
        "display": display,
        "role": role,
        "must_change_password": bool(must_change),
        "status_message": status_message,
    }


def verify_token(token: str) -> dict | None:
    """Decode and verify JWT. Returns payload or None."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except Exception:
        return None


def change_password(name: str, old_password: str, new_password: str) -> bool:
    """Change a member's password after verifying the old one."""
    if len(new_password) < 6:
        return False
    with _conn() as conn:
        row = conn.execute("SELECT password_hash FROM members WHERE name=?", (name,)).fetchone()
        if not row or not bcrypt.checkpw(old_password.encode(), row[0].encode()):
            return False
        new_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
        conn.execute(
            "UPDATE members SET password_hash=?, must_change_password=0 WHERE name=?",
            (new_hash, name)
        )
        conn.commit()
    return True




def get_members_status() -> list[dict]:
    """Admin: return all members with their password status."""
    _migrate()
    with _conn() as conn:
        rows = conn.execute(
            "SELECT name, display, role, must_change_password, COALESCE(is_locked,1) FROM members"
        ).fetchall()
    return [
        {
            "name": name,
            "display": display,
            "role": role,
            "must_change_password": bool(must_change),
            "locked": bool(locked),
        }
        for name, display, role, must_change, locked in rows
    ]


def update_status(name: str, status_message: str) -> bool:
    """Update a member status message."""
    with _conn() as conn:
        conn.execute(
            "UPDATE members SET status_message=? WHERE name=?",
            (status_message[:120], name)
        )
        conn.commit()
    return True

def get_status(name: str) -> str:
    with _conn() as conn:
        row = conn.execute("SELECT COALESCE(status_message,'') FROM members WHERE name=?", (name,)).fetchone()
    return row[0] if row else ""

def send_otp(name: str) -> dict:
    """Generate a 6-digit OTP, store it, send via WhatsApp. Returns {ok, error}."""
    phone = MEMBER_PHONES.get(name)
    if not phone:
        return {"ok": False, "error": "No WhatsApp number on file for this account. Ask Hillary or Hellen to reset your password."}
    # On staging, always send to Hillary so real members aren't messaged during tests
    dest = STAGING_OTP_PHONE if IS_STAGING else phone
    code = str(random.randint(100000, 999999))
    expires = (datetime.now(timezone.utc) + timedelta(minutes=10)).strftime("%Y-%m-%d %H:%M:%S")
    with _conn() as conn:
        # Invalidate any previous unused tokens for this member
        conn.execute("UPDATE password_reset_tokens SET used=1 WHERE name=? AND used=0", (name,))
        conn.execute(
            "INSERT INTO password_reset_tokens (name, token, expires_at) VALUES (?,?,?)",
            (name, code, expires)
        )
        conn.commit()
    env_label = " [STAGING]" if IS_STAGING else ""
    message = (
        f"KimFam Hub{env_label} password reset\n\n"
        f"Your one-time code is: *{code}*\n\n"
        f"This code expires in 10 minutes. Do not share it with anyone."
    )
    try:
        resp = requests.post(
            f"{WHATSAPP_BRIDGE_URL}/api/send",
            json={"recipient": dest, "message": message},
            timeout=10
        )
        if resp.status_code == 200:
            return {"ok": True}
        return {"ok": False, "error": f"WhatsApp send failed: {resp.text}"}
    except Exception as e:
        return {"ok": False, "error": f"WhatsApp bridge unreachable: {e}"}


def verify_otp(name: str, token: str, new_password: str) -> dict:
    """Verify OTP and set new password. Returns {ok, token} or {ok, error}."""
    if len(new_password) < 6:
        return {"ok": False, "error": "Password must be at least 6 characters."}
    # Check it's not the same as the current password
    with _conn() as _chk:
        _row = _chk.execute("SELECT password_hash FROM members WHERE name=?", (name,)).fetchone()
        if _row and bcrypt.checkpw(new_password.encode(), _row[0].encode()):
            return {"ok": False, "error": "New password must be different from your current password."}
    with _conn() as conn:
        row = conn.execute(
            "SELECT id, expires_at, used FROM password_reset_tokens WHERE name=? AND token=? ORDER BY id DESC LIMIT 1",
            (name, token)
        ).fetchone()
        if not row:
            return {"ok": False, "error": "Invalid code."}
        rid, expires_at, used = row
        if used:
            return {"ok": False, "error": "This code has already been used."}
        if datetime.now(timezone.utc) > datetime.strptime(expires_at, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc):
            return {"ok": False, "error": "Code has expired. Request a new one."}
        # All good — set new password
        pw_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
        conn.execute(
            "UPDATE members SET password_hash=?, must_change_password=0, is_locked=0 WHERE name=?",
            (pw_hash, name)
        )
        conn.execute("UPDATE password_reset_tokens SET used=1 WHERE id=?", (rid,))
        conn.commit()
    # Return a fresh JWT so the member is logged in immediately
    member = conn.execute(
        "SELECT display, role FROM members WHERE name=?", (name,)
    )
    # Re-open connection to read after commit
    with _conn() as conn2:
        mrow = conn2.execute("SELECT display, role FROM members WHERE name=?", (name,)).fetchone()
    display, role = mrow
    payload = {
        "sub": name,
        "display": display,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_DAYS),
    }
    token_jwt = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)
    return {"ok": True, "token": token_jwt, "display": display, "role": role}


if __name__ == "__main__":
    seed_members()
