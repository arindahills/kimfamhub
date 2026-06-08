"""
KimFam Hub — WhatsApp notification module.
All outbound WhatsApp messages go through this module.

Routing:
  Staging  → Hillary only + kimfamtest group
  Prod     → intended recipients + KIM FAM PROJECTS group
"""
import os, requests, logging

log = logging.getLogger(__name__)

BRIDGE_URL      = os.environ.get("WHATSAPP_BRIDGE_URL", "http://localhost:8080")
IS_STAGING      = os.environ.get("KIMFAM_ENV", "prod") == "staging"

# Group JIDs
GROUP_KIMFAMTEST   = "120363429341325971@g.us"      # staging test group
GROUP_KIM_PROJECTS = "254716595631-1631997730@g.us"  # prod: KIM FAM PROJECTS

# Hillary always receives (also the staging catch-all)
HILLARY_PHONE = "256775102684"

# Hellen (Treasurer) — prod only
HELLEN_PHONE = "254716595631"


def _send(recipient: str, message: str):
    """Fire-and-forget single WhatsApp message. Swallows errors so notifications
    never break the main request flow."""
    try:
        r = requests.post(
            f"{BRIDGE_URL}/api/send",
            json={"recipient": recipient, "message": message},
            timeout=8,
        )
        if not r.ok:
            log.warning("WhatsApp send failed to %s: %s", recipient, r.text)
    except Exception as e:
        log.warning("WhatsApp send error to %s: %s", recipient, e)


def _broadcast(individuals: list[str], message: str):
    """Send to individuals + the appropriate group, respecting staging mode."""
    group = GROUP_KIMFAMTEST if IS_STAGING else GROUP_KIM_PROJECTS

    if IS_STAGING:
        # Staging: only Hillary + test group
        _send(HILLARY_PHONE, message)
        _send(group, message)
    else:
        # Prod: all individuals + prod group
        seen = set()
        for phone in individuals:
            if phone and phone not in seen:
                seen.add(phone)
                _send(phone, message)
        _send(group, message)


# ── Member phone lookup (mirrors auth.py MEMBER_PHONES) ───────────────────
MEMBER_PHONES = {
    "Hillary":  "256775102684",
    "Hellen":   "254716595631",
    "Alex":     "256782576807",
    "Israel":   "256772625387",
    "Simon":    "256706397738",
    "Esther":   "256775368069",
    "Janet":    "256773134913",
    "Lawi":     "254708602681",
    "Max":      "256782190580",
    "Priscilla":"256702022899",
    "Solomon":  "256779324208",
    "Viola":    "256706769733",
    "Merab":    None,  # not on WhatsApp
}

# Family → member mapping loaded from PostgreSQL via family_db.
# Do not hardcode here — edit persons.whatsapp_name in the DB instead.
import family_db as _fdb
FAMILY_MEMBERS = _fdb.all_families()


def _phones_for_family(family_name: str) -> list[str]:
    members = _fdb.family_members(family_name)
    return [p for m in members if (p := MEMBER_PHONES.get(m))]


def _submitter_phone(submitted_by: str) -> str | None:
    return MEMBER_PHONES.get(submitted_by)


# ─────────────────────────────────────────────────────────────────────────────
# Notification events
# ─────────────────────────────────────────────────────────────────────────────

def notify_payment_submitted(
    family_name: str,
    amount_ugx: int,
    period_month: str,
    payment_id: int,
    submitted_by: str,
    receipt_url: str | None,
    base_url: str = "",
):
    """Sent after a payment is submitted. Goes to Hellen (prod) + group."""
    env = " [STAGING]" if IS_STAGING else ""
    receipt_line = ""
    if receipt_url:
        host = "https://staging.kimfamhub.com" if IS_STAGING else "https://kimfamhub.com"
        receipt_line = f"\nReceipt: {host}{receipt_url}"

    msg = (
        f"💰 *KimFam Payment Submitted{env}*\n"
        f"*Family:* {family_name}\n"
        f"*Amount:* UGX {amount_ugx:,}\n"
        f"*Period:* {period_month}\n"
        f"*Payment ID:* #{payment_id}\n"
        f"*Submitted by:* {submitted_by}"
        f"{receipt_line}\n"
        f"_Awaiting Treasurer confirmation_ ⏳"
    )

    # Prod: notify Hellen so she can confirm; Hillary gets it via group
    individuals = [HELLEN_PHONE]
    _broadcast(individuals, msg)


def notify_payment_confirmed(
    family_name: str,
    amount_ugx: int,
    period_month: str,
    payment_id: int,
    note: str | None,
    family_phones: list[str] | None = None,
):
    """Sent when Hellen confirms a payment."""
    env = " [STAGING]" if IS_STAGING else ""
    note_line = f"\nNote: {note}" if note else ""
    msg = (
        f"✅ *KimFam Payment Confirmed{env}*\n"
        f"*Family:* {family_name}\n"
        f"*Amount:* UGX {amount_ugx:,}\n"
        f"*Period:* {period_month}\n"
        f"*Payment ID:* #{payment_id}"
        f"{note_line}\n"
        f"_Thank you! Your payment has been recorded_ 🙏"
    )
    phones = family_phones or _phones_for_family(family_name)
    _broadcast(phones, msg)


def notify_payment_rejected(
    family_name: str,
    amount_ugx: int,
    period_month: str,
    payment_id: int,
    reason: str | None,
    submitted_by: str,
    family_phones: list[str] | None = None,
):
    """Sent when Hellen rejects a payment. Goes to family + submitter (if different)."""
    env = " [STAGING]" if IS_STAGING else ""
    reason_line = f"\n*Reason:* {reason}" if reason else ""
    msg = (
        f"❌ *KimFam Payment Rejected{env}*\n"
        f"*Family:* {family_name}\n"
        f"*Amount:* UGX {amount_ugx:,}\n"
        f"*Period:* {period_month}\n"
        f"*Payment ID:* #{payment_id}"
        f"{reason_line}\n"
        f"_Please log in to kimfamhub.com and resubmit_ 🔁"
    )
    phones = list(family_phones or _phones_for_family(family_name))
    sub_phone = _submitter_phone(submitted_by)
    if sub_phone and sub_phone not in phones:
        phones.append(sub_phone)
    _broadcast(phones, msg)
