
# ---------------- main ----------------

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
    momo = re.search(r"you have sent ugx\s*([\d,]+)\s+to\s+(.+?)(?:,|\.|$)", b)
    if momo:
        amt_str = momo.group(1).replace(",","")
        try: amt = int(float(amt_str))
        except: amt = 0
        return ("__momo__", amt)  # sender already known from JID

    # MoMo receipt: "You have received UGX NNNNNN from NAME"
    rcvd = re.search(r"you have received ugx\s*([\d,]+)\s+from\s+(.+?)(?:,|\.|$)", b)
    if rcvd:
        amt_str = rcvd.group(1).replace(",","")
        try: amt = int(float(amt_str))
        except: amt = 0
        return ("__momo_rcvd__", amt)

    # Payment keywords — sender paid
    sent_keywords = ["i have sent", "i've sent", "i sent", "i paid", "i have paid",
                     "natuma", "nzizye", "transferred", "i transferred",
                     "nimepeleka", "nimetuma", "sent the money", "paid the money",
                     "cleared", "done paying", "paid my", "i have done"]
    if any(k in b for k in sent_keywords):
        amt_m = re.search(r"(\d[\d,\.]+)", body)
        try: amt = int(float(amt_m.group(1).replace(",",""))) if amt_m else 300000
        except: amt = 300000
        return ("__lang__", amt)

    # Received keywords — beneficiary confirming receipt; payer is someone else
    # Return special marker so handler can try to parse who paid
    rcvd_keywords = ["have received", "i received", "i got", "received from",
                     "got from", "nateeba", "nakirako", "nimepokea", "nimepata"]
    if any(k in b for k in rcvd_keywords):
        amt_m = re.search(r"(\d[\d,\.]+)", body)
        try: amt = int(float(amt_m.group(1).replace(",",""))) if amt_m else 300000
        except: amt = 300000
        return ("__received__", amt)

    return (None, None)


def _klafam_get_sender_slug(sender_jid: str) -> str | None:
    """Map a raw JID (with or without @lid) to a KlaFam slug."""
    digits = re.sub(r"\D", "", (sender_jid or "").split("@")[0])
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


def _handle_supplier_pricelist(state, message_id, chat_jid, fname, contact):
    import shutil, datetime
    try:
        r = requests.post(BRIDGE_DOWNLOAD, json={"message_id": message_id, "chat_jid": chat_jid}, timeout=120)
        j = r.json()
        if not j.get("success"):
            log("supplier pricelist download failed: %s" % j.get("message"))
            send_text(OWNER_JIDS[0], "SRNE pricelist download failed: %s" % j.get("message", "unknown"))
            return
        src_path = j["path"]
        today_str = datetime.date.today().strftime("%Y-%m-%d")
        ext = os.path.splitext(fname or "pricelist.pdf")[1] or ".pdf"
        supplier_slug = contact.get("session", "supplier").replace("_", "-")
        dest_name = "%s-pricelist-%s%s" % (supplier_slug, today_str, ext)
        dest_dir = "/opt/rincol-erp-deploy/static/docs/pricelists"
        dest_path = os.path.join(dest_dir, dest_name)
        os.makedirs(dest_dir, exist_ok=True)
        shutil.copy2(src_path, dest_path)
        log("pricelist copied to %s" % dest_path)
        # git add + commit + push via gh HTTPS token
        import subprocess as _sp
        repo_dir = "/opt/rincol-erp-deploy"
        tok_r = _sp.run(["gh", "auth", "token"], capture_output=True, text=True)
        token = tok_r.stdout.strip()
        rel_path = "static/docs/pricelists/%s" % dest_name
        _sp.run(["git", "-C", repo_dir, "add", rel_path], check=True)
        _sp.run(["git", "-C", repo_dir,
                 "-c", "user.email=arinda.hillary@gmail.com",
                 "-c", "user.name=WhatsApp Agent",
                 "commit", "-m", "pricelist: auto-upload %s from %s" % (dest_name, contact["name"])],
                check=True, capture_output=True)
        tok = token
        push_url = "https://%s@github.com/RincolTech-Solutions-ltd/rincol-erp.git" % tok
        _sp.run(["git", "-c", "url.https://.insteadOf=git@github.com:",
                 "-C", repo_dir, "push", push_url, "main"],
                check=True, capture_output=True)
        log("pricelist pushed to GitHub: %s" % dest_name)
        send_text(OWNER_JIDS[0],
            "Pricelist auto-uploaded: %s\n"
            "%s received from %s has been pushed to the Rincol ERP app. "
            "Render will deploy in ~2 min." % (dest_name, fname or "document", contact["name"]))
    except Exception as e:
        log("supplier pricelist handler error: %s" % traceback.format_exc())
        send_text(OWNER_JIDS[0], "SRNE pricelist upload failed: %s" % str(e))



def is_likely_reply_or_comment(body, ts_current, recent_msg_ts):
    """Skip messages that are likely replies/comments to recent messages."""
    if not body:
        return True
    body_lower = body.lower()
    if any(word in body_lower for word in ['yes', 'ok', 'got it', 'confirmed', 'correct', 'agree', 'thanks', 'noted', 'understood']):
        if len(body) < 100:
            return True
    if len(body) < 50 and (ts_current - recent_msg_ts) < 300:
        return True
    # Commands always processed, even as replies
    if body.strip().startswith(">>"): return False
    
