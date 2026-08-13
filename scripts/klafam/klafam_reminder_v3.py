#!/usr/bin/env python3
"""
KlaFam daily contribution reminder.
Cron: 0 6 * * * /var/www/kimfamhub/venv/bin/python3 /opt/klafam_reminder.py >> /var/log/klafam_reminder.log 2>&1
(09:00 EAT = 06:00 UTC)

Only fires for the MOST RECENT overdue cycle. Historical missed payments are not chased.
Primary channel: WhatsApp personal message. Fallback: Web Push.
"""

import os, sys, json, logging, requests
from datetime import date

sys.path.insert(0, "/var/www/kimfamhub")

with open("/var/www/kimfamhub/.env") as f:
    for line in f:
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

from db import query, execute as _exec

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("klafam-reminder")

today = date.today()

BRIDGE_SEND = "http://localhost:8080/api/send"

SLUG_TO_JID = {
    "arindas":   "256775102684@s.whatsapp.net",
    "turamyes":  "256782190580@s.whatsapp.net",
    "priscilla": "256702022899@s.whatsapp.net",
    "alex":      "256782576807@s.whatsapp.net",
}

def send_whatsapp(jid: str, text: str) -> bool:
    try:
        r = requests.post(BRIDGE_SEND, json={"recipient": jid, "message": text}, timeout=30)
        return r.status_code < 400
    except Exception as e:
        log.warning(f"WhatsApp send failed to {jid}: {e}")
        return False

def send_push(sub: dict, title: str, body: str) -> bool:
    try:
        from pywebpush import webpush, WebPushException
        priv_key = os.environ.get("VAPID_PRIVATE_KEY", "")
        contact  = os.environ.get("VAPID_CONTACT", "mailto:arinda.hillary@gmail.com")
        payload  = json.dumps({"title": title, "body": body, "icon": "/favicon.ico", "url": "/klafam"})
        webpush(
            subscription_info={"endpoint": sub["endpoint"], "keys": {"p256dh": sub["p256dh"], "auth": sub["auth_key"]}},
            data=payload, vapid_private_key=priv_key, vapid_claims={"sub": contact},
        )
        return True
    except Exception as e:
        from pywebpush import WebPushException
        if isinstance(e, WebPushException) and e.response and e.response.status_code in (404, 410):
            _exec("DELETE FROM push_subscriptions WHERE endpoint = %s", (sub["endpoint"],))
        else:
            log.warning(f"  Push failed for {sub['member_name']}: {e}")
        return False

# Most recent cycle whose due_date has passed and still has unpaid active members
cycles = query(
    """
    SELECT DISTINCT kc.id, kc.month_label, kc.due_date
    FROM klafam_cycles kc
    JOIN klafam_contributions contrib ON contrib.cycle_id = kc.id
    JOIN klafam_members km ON km.id = contrib.member_id
    WHERE kc.due_date <= %s
      AND contrib.status IN ('pending', 'missed')
      AND km.is_active = TRUE
    ORDER BY kc.due_date DESC
    LIMIT 1
    """,
    (today,)
)

if not cycles:
    log.info("No overdue cycle with unpaid members — done")
    sys.exit(0)

cycle = cycles[0]
due_date = cycle["due_date"]
days_overdue = (today - due_date).days

if days_overdue == 0:
    urgency = "Today is the deadline."
elif days_overdue == 1:
    urgency = "1 day overdue."
else:
    urgency = f"{days_overdue} days overdue."

bene_rows = query(
    "SELECT km.display_name FROM klafam_cycles kc "
    "JOIN klafam_members km ON km.id = kc.beneficiary_id WHERE kc.id = %s",
    (cycle["id"],)
)
bene_name = bene_rows[0]["display_name"] if bene_rows else "the beneficiary"

unpaid = query(
    "SELECT km.slug, km.display_name "
    "FROM klafam_contributions kc JOIN klafam_members km ON km.id = kc.member_id "
    "WHERE kc.cycle_id = %s AND kc.status IN ('pending','missed') AND km.is_active = TRUE",
    (cycle["id"],)
)

if not unpaid:
    log.info("All members cleared — done")
    sys.exit(0)

log.info(f"Reminding for {cycle['month_label']} ({urgency}): {[r['display_name'] for r in unpaid]}")

for member in unpaid:
    slug = member["slug"]
    name = member["display_name"]

    msg = (
        f"KlaFam reminder: Please send UGX 300,000 to {bene_name} for {cycle['month_label']}. "
        f"{urgency} "
        f"If you have already paid, confirm it on kimfamhub.com/klafam"
    )

    jid = SLUG_TO_JID.get(slug)
    if jid:
        ok = send_whatsapp(jid, msg)
        log.info(f"  WhatsApp {'sent' if ok else 'FAILED'} to {name}")
    else:
        log.warning(f"  No WhatsApp JID for {slug}")

    subs = query(
        "SELECT endpoint, p256dh, auth_key, member_name FROM push_subscriptions "
        "WHERE klafam_slug = %s AND scope = 'klafam'",
        (slug,)
    )
    for sub in subs:
        ok = send_push(sub, f"KlaFam: {cycle['month_label']} contribution due", msg)
        log.info(f"  Push {'sent' if ok else 'FAILED'} to {sub['member_name']}")

log.info("Done.")
