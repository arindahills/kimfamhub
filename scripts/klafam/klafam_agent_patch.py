#!/usr/bin/env python3
"""
Patch script: add KlaFam group handler to orchestrator.py
Run once: python3 /tmp/klafam_agent_patch.py
"""

ORCHESTRATOR = "/opt/whatsapp-agent/orchestrator.py"

content = open(ORCHESTRATOR).read()

# ── 1. Add KLAFAM_GROUP constant after AI_DATABASE_GROUP line ────────────────
OLD_CONST = 'AI_DATABASE_GROUP = "120363410736057280@g.us"      # Hellen + Lawi AI legal tasks group'
NEW_CONST = (
    'AI_DATABASE_GROUP = "120363410736057280@g.us"      # Hellen + Lawi AI legal tasks group\n'
    'KLAFAM_GROUP      = "256782022899-1613666068@g.us" # Kla famly team(tanda) — KlaFam ROSCA group\n'
    '# KlaFam member JID→slug map (LID digits only, no @lid suffix)\n'
    'KLAFAM_JID_TO_SLUG = {\n'
    '    "248073083211958": "turamyes",   # Max Turamye\n'
    '    "19232913883337":  "priscilla",  # Priscilla Tuhimbise\n'
    '    "167198815477966": "alex",       # Alex Tuhimbise\n'
    '    "256775102684":    "arindas",    # Hillary Arinda (owner phone)\n'
    '    "99183763660922":  "arindas",    # Hillary Arinda (owner LID)\n'
    '}\n'
    'KIMFAMHUB_URL = "https://kimfamhub.com"  # base URL for KlaFam API\n'
    'KIMFAMHUB_INTERNAL = "http://localhost:8000"  # internal for server-side calls\n'
)
assert OLD_CONST in content, "CONST anchor not found"
content = content.replace(OLD_CONST, NEW_CONST, 1)

# ── 2. Add KLAFAM_GROUP to WATCHED_JIDS ──────────────────────────────────────
OLD_WATCHED = 'WATCHED_JIDS = (OWNER_JIDS + KIMFAM_ALL_GROUPS + [MTIC_GROUP, UTIMBER_GROUP, AGENTS_GROUP, AI_DATABASE_GROUP] + list(CONTACTS.keys()) +'
NEW_WATCHED = 'WATCHED_JIDS = (OWNER_JIDS + KIMFAM_ALL_GROUPS + [MTIC_GROUP, UTIMBER_GROUP, AGENTS_GROUP, AI_DATABASE_GROUP, KLAFAM_GROUP] + list(CONTACTS.keys()) +'
assert OLD_WATCHED in content, "WATCHED_JIDS anchor not found"
content = content.replace(OLD_WATCHED, NEW_WATCHED, 1)

# ── 3. Add KlaFam helper functions before the group dispatch block ────────────
KLAFAM_HELPERS = '''
# ── KlaFam helpers ─────────────────────────────────────────────────────────

def _klafam_detect_payment(body: str):
    """Return (slug_payer, amount_ugx) if the message looks like a payment confirmation, else (None, None).
    Handles:
      - MTN MoMo bot: "You have sent UGX 300000 to PRICILLA..."
      - Natural language: "I've sent", "I paid", "nzizye", "natuma", "transferred"
    """
    import re
    b = body.lower().strip()

    # MoMo bot: "You have sent UGX NNNNNN to NAME"
    momo = re.search(r"you have sent ugx\\s*([\\d,]+)\\s+to\\s+(.+?)(?:,|\\.|$)", b)
    if momo:
        amt_str = momo.group(1).replace(",","")
        try: amt = int(float(amt_str))
        except: amt = 0
        return ("__momo__", amt)  # sender already known from JID

    # MoMo receipt: "You have received UGX NNNNNN from NAME"
    rcvd = re.search(r"you have received ugx\\s*([\\d,]+)\\s+from\\s+(.+?)(?:,|\\.|$)", b)
    if rcvd:
        amt_str = rcvd.group(1).replace(",","")
        try: amt = int(float(amt_str))
        except: amt = 0
        return ("__momo_rcvd__", amt)

    # Payment keywords
    keywords = ["i have sent", "i\'ve sent", "i sent", "i paid", "i have paid",
                "natuma", "nzizye", "transferred", "i transferred",
                "nimepeleka", "nimetuma", "sent the money", "paid the money",
                "cleared", "done paying", "paid my", "i have done"]
    if any(k in b for k in keywords):
        # Try to extract amount
        amt_m = re.search(r"(\d[\d,\.]+)", body)
        try: amt = int(float(amt_m.group(1).replace(",",""))) if amt_m else 300000
        except: amt = 300000
        return ("__lang__", amt)

    return (None, None)


def _klafam_get_sender_slug(sender_jid: str) -> str | None:
    """Map a raw JID (with or without @lid) to a KlaFam slug."""
    digits = re.sub(r"\\D", "", (sender_jid or "").split("@")[0])
    return KLAFAM_JID_TO_SLUG.get(digits)


def _klafam_record_payment(slug: str, amount: int, notes: str = "") -> bool:
    """Call the KimFam Hub API (internal) to record a KlaFam payment."""
    import urllib.request, urllib.error, json as _json, datetime
    today = datetime.date.today()
    # Find current cycle year+month
    try:
        req = urllib.request.Request(
            f"{KIMFAMHUB_INTERNAL}/api/klafam/overview",
            headers={"Accept": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            ov = _json.loads(r.read())
        cur = ov.get("current_cycle")
        if not cur:
            return False
        cycle_id = cur["id"]
    except Exception as e:
        log(f"KlaFam API overview failed: {e}")
        return False

    # Record the payment using internal API (no auth token needed for internal call)
    # We'll directly call the DB via a subprocess for server-side reliability
    try:
        import subprocess, sys
        script = f"""
import sys; sys.path.insert(0,"/var/www/kimfamhub")
from db import query, execute
members = query("SELECT id FROM klafam_members WHERE slug=%s", ("{slug}",))
if not members: sys.exit(1)
mid = members[0]["id"]
existing = query("SELECT id FROM klafam_contributions WHERE cycle_id=%s AND member_id=%s", ({cycle_id}, mid))
if existing:
    execute("UPDATE klafam_contributions SET amount=%s,status=%s,paid_date=%s,notes=%s WHERE id=%s",
            ({amount},"paid","{today.isoformat()}","{notes}",existing[0]["id"]))
else:
    execute("INSERT INTO klafam_contributions(cycle_id,member_id,amount,status,paid_date,notes) VALUES(%s,%s,%s,%s,%s,%s)",
            ({cycle_id},mid,{amount},"paid","{today.isoformat()}","{notes}"))
total = query("SELECT COALESCE(SUM(amount),0) as t FROM klafam_contributions WHERE cycle_id=%s AND status=%s",({cycle_id},"paid"))
execute("UPDATE klafam_cycles SET total_collected=%s WHERE id=%s",(int(total[0]["t"]),{cycle_id}))
print("ok")
"""
        r = subprocess.run(
            ["/var/www/kimfamhub/venv/bin/python3", "-c", script],
            capture_output=True, text=True, timeout=10
        )
        return "ok" in r.stdout
    except Exception as e:
        log(f"KlaFam record_payment failed: {e}")
        return False

'''

# Insert helpers just before the group dispatch block
OLD_DISPATCH_MARKER = '                # Mode 2a-mtic: MTIC project group >>'
assert OLD_DISPATCH_MARKER in content, "dispatch marker not found"
content = content.replace(OLD_DISPATCH_MARKER, KLAFAM_HELPERS + '                # Mode 2a-mtic: MTIC project group >>', 1)

# ── 4. Add KlaFam group handler in the dispatch section ──────────────────────
KLAFAM_HANDLER = '''
                # Mode 2a-klafam: KlaFam tanda group — auto-detect payments, notify Hillary for approval
                if chat_jid == KLAFAM_GROUP:
                    if is_from_me:
                        continue

                    sender_slug = _klafam_get_sender_slug(sndr or "")
                    signal, amt = _klafam_detect_payment(body)

                    if signal and sender_slug:
                        member_name = {"arindas":"The Arindas","turamyes":"The Turamyes",
                                       "priscilla":"Priscilla","alex":"Alex"}.get(sender_slug, sender_slug)
                        # Notify Hillary for approval
                        approval_msg = (
                            f"KlaFam: {member_name} appears to have paid UGX {amt:,} for the current cycle.\\n"
                            f"Message: {body[:120]}\\n\\n"
                            f"Reply\\n>> klafam confirm {sender_slug} {amt}\\n"
                            f"to record it, or\\n>> klafam skip\\nto ignore."
                        )
                        send_msg(OWNER_JIDS[0], approval_msg)
                        log(f"KlaFam payment detected from {sender_slug} ({amt:,}), notified Hillary")
                    elif not signal and body.strip():
                        log(f"KlaFam group msg from {sender_slug or sndr} — not a payment signal: {body[:60]}")
                    continue

'''

# Insert before MTIC handler
OLD_MTIC = '                # Mode 2a-mtic: MTIC project group >>'
content = content.replace(OLD_MTIC, KLAFAM_HANDLER + '                # Mode 2a-mtic: MTIC project group >>', 1)

# ── 5. Add >> klafam confirm handler in the owner JID section ────────────────
# Find the owner command section and add klafam confirm parsing
OLD_OWNER_TRIGGER = '                if is_from_me and body.startswith(TRIGGER) and chat_jid not in (HELLEN_JID,) and chat_jid not in _group_jids:'
KLAFAM_CMD_HANDLER = '''
                # KlaFam approval commands from Hillary: >> klafam confirm <slug> <amount>
                if is_from_me and body.strip().lower().startswith(">> klafam "):
                    parts = body.strip().split()
                    # parts: ['>>', 'klafam', 'confirm'/'skip', slug?, amount?]
                    if len(parts) >= 3 and parts[2].lower() == "confirm" and len(parts) >= 5:
                        kl_slug = parts[3].lower()
                        try: kl_amt = int(parts[4].replace(",",""))
                        except: kl_amt = 300000
                        ok = _klafam_record_payment(kl_slug, kl_amt, "Recorded via WhatsApp approval")
                        reply = (f"KlaFam: {kl_slug} marked as paid UGX {kl_amt:,}." if ok
                                 else "KlaFam: recording failed — check the app.")
                        send_msg(chat_jid, reply)
                    elif len(parts) >= 3 and parts[2].lower() == "skip":
                        send_msg(chat_jid, "KlaFam: payment skipped, not recorded.")
                    continue

'''
assert OLD_OWNER_TRIGGER in content, "owner trigger anchor not found"
content = content.replace(OLD_OWNER_TRIGGER, KLAFAM_CMD_HANDLER + '\n' + OLD_OWNER_TRIGGER, 1)

open(ORCHESTRATOR, "w").write(content)
print("Orchestrator patched successfully")
print(f"  - KLAFAM_GROUP constant added")
print(f"  - KLAFAM_JID_TO_SLUG map added")
print(f"  - KLAFAM_GROUP added to WATCHED_JIDS")
print(f"  - _klafam_detect_payment, _klafam_get_sender_slug, _klafam_record_payment added")
print(f"  - KlaFam group handler added to dispatch")
print(f"  - >> klafam confirm/skip command handler added")
