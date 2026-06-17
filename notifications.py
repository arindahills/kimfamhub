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

# Standard sign-off appended to every automated KimFam WhatsApp message.
SIGNOFF = "\n\n— _KimFam Hub AI_ 🤖"


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


# ─────────────────────────────────────────────────────────────────────────────
# Proposals
# ─────────────────────────────────────────────────────────────────────────────

def _proposal_owner_phones(owner: str) -> list[str]:
    """Phones for a proposal owner: a family name -> its members; a member name ->
    that member; club-wide/unknown -> empty (caller falls back to the submitter)."""
    o = (owner or "").strip()
    name = o[4:].strip() if o.lower().startswith("the ") else o
    fam = _phones_for_family(name)
    if fam:
        return list(fam)
    if name in MEMBER_PHONES and MEMBER_PHONES[name]:
        return [MEMBER_PHONES[name]]
    return []


def _proposal_url(link: str | None) -> str:
    """Tappable link to the proposal's readable view. URL-encodes the path so spaces
    (which WhatsApp truncates the hyperlink at) become %20 and the link resolves."""
    if not link:
        return ""
    if link.startswith("http"):
        return link
    from urllib.parse import quote
    path = link if link.endswith("/view") else (link + "/view")   # render in-browser
    host = "https://staging.kimfamhub.com" if IS_STAGING else "https://kimfamhub.com"
    return host + quote(path, safe="/")


def notify_proposal_submitted(title, owner, submitter, score, verdict, link, on_behalf=False):
    """Personal confirmation to the proposal owner (and the submitter), NOT the group.
    Staging-safe: only Hillary is messaged on staging."""
    env = " [STAGING]" if IS_STAGING else ""
    url = _proposal_url(link)
    behalf = f" by {submitter} on your behalf" if on_behalf else ""
    score_line = f"\nAI score: {score}/100 ({verdict})." if score is not None else ""
    msg = (
        f"📑 *KimFam Proposal Submitted{env}*\n"
        f"*{title}*\n"
        f"*Owner:* {owner}\n"
        f"Submitted{behalf}.{score_line}\n"
        f"{('View: ' + url) if url else ''}\n"
        f"_To refine it, upload a new version on the Proposals tab._"
        + SIGNOFF
    )
    if IS_STAGING:
        _send(HILLARY_PHONE, msg)
        return
    phones = _proposal_owner_phones(owner)
    sp = MEMBER_PHONES.get(submitter)
    if sp and sp not in phones:
        phones.append(sp)
    for p in phones:
        _send(p, msg)


def notify_proposal_ready(title, owner, submitter, score, verdict, link):
    """Deliberate announcement to the family group that a proposal is ready for review."""
    env = " [STAGING]" if IS_STAGING else ""
    url = _proposal_url(link)
    score_line = f"\n*AI readiness score:* {score}/100 ({verdict})" if score is not None else ""
    msg = (
        f"📑 *KimFam Proposal Ready for Review{env}*\n"
        f"*{title}*\n"
        f"*Owner:* {owner}  |  *Submitted by:* {submitter}"
        f"{score_line}\n"
        f"{('View the proposal: ' + url) if url else ''}\n"
        f"_Please review and share your input._"
        + SIGNOFF
    )
    _broadcast([], msg)   # individuals=[] -> group only (staging routes to Hillary + test group)


def notify_proposal_comment(title, owner, commenter, body, link):
    """Personal note to the proposal owner (+ submitter) that a new comment was posted.
    Not the group. Staging-safe: only Hillary on staging."""
    env = " [STAGING]" if IS_STAGING else ""
    url = _proposal_url(link)
    snippet = body if len(body) <= 220 else body[:220] + "…"
    msg = (
        f"💬 *New comment on a KimFam proposal{env}*\n"
        f"*{title}*\n"
        f"{commenter}: {snippet}\n"
        f"{('View: ' + url) if url else ''}"
        + SIGNOFF
    )
    if IS_STAGING:
        _send(HILLARY_PHONE, msg)
        return
    for p in _proposal_owner_phones(owner):
        _send(p, msg)
