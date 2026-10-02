"""
decision_trace.py — the decision register behind "Why?" (ADR-034, docs/specs/decision-trace.md).

Phases 0-2 only: tables, extraction pipeline, link suggestions. No trace API, no report, no UI.

Pure part (no database, no network): chunk_transcript, build_prompt, check, score_links, parse_amount.
The model is always an injected parameter, model_fn(prompt) -> str, so every test runs offline with a fake.

Hard rules enforced in code (spec):
  1. A quote must exist verbatim (whitespace-normalised) in the stored transcript, else the decision is dropped.
  2. A speaker is named only when the transcript labels the turn containing the quote with a known member.
  3. A private meeting is never read, extracted or quoted.
  4. AI proposes, people confirm: suggest_links only ever writes state 'suggested'.
"""
import datetime as _dt
import json
import re

_LOCK_KEY = 778814
_READY = False

STATUSES = ("agreed", "proposed", "superseded", "reversed")
TARGET_TYPES = ("action", "ledger_expense", "ledger_sale", "ledger_stock", "ledger_loss",
                "treasury_payment", "projection_line", "kpi", "open_item")
RELATIONS = ("authorised", "caused", "explains", "contradicts")
LINK_STATES = ("suggested", "confirmed", "rejected")

MAX_STATEMENT = 400
MAX_RATIONALE = 300
MIN_QUOTE = 12            # a quote shorter than this proves nothing
CHUNK_CHARS = 6000
LINK_WINDOW_DAYS = 45
AMOUNT_TOLERANCE = 0.05

# ── turns and chunks ───────────────────────────────────────────────────────────────────────────
# A labelled turn starts a line with "[Label] " or "Label: " (one to three capitalised words).
_LABEL = re.compile(r"^(?:\[(?P<b>[^\]\n]{1,40})\]\s*:?\s*|(?P<c>[A-Z][A-Za-z.'-]*(?: [A-Za-z.'-]+){0,2}):[ \t]+)")


def chunk_transcript(text):
    """Split a transcript into speaker turns -> [{'start','end','speaker','text'}], offsets into `text`.
    `speaker` is the label exactly as written, or None when the line carries no label. Lines without a
    label continue the current turn; a transcript with no labels at all is one turn per blank-line
    paragraph (or one turn if there are none)."""
    text = text or ""
    turns, open_ = [], False
    pos = 0
    for line in text.splitlines(keepends=True):
        end = pos + len(line.rstrip("\r\n"))
        m = _LABEL.match(line)
        if m:
            turns.append({"start": pos, "end": end, "speaker": (m.group("b") or m.group("c")).strip()})
            open_ = True
        elif not line.strip():
            if turns and turns[-1]["speaker"] is None:
                open_ = False
        elif open_:
            turns[-1]["end"] = end
        else:
            turns.append({"start": pos, "end": end, "speaker": None})
            open_ = True
        pos += len(line)
    out = []
    for t in turns:
        t["text"] = text[t["start"]:t["end"]]
        if t["text"].strip():
            out.append(t)
    return out


def pack_chunks(text, turns=None, max_chars=CHUNK_CHARS):
    """Group whole turns into prompt-sized chunks -> [{'start','end','text'}]. A turn longer than the
    limit becomes its own chunk (never cut mid-quote)."""
    turns = chunk_transcript(text) if turns is None else turns
    chunks, cur = [], None
    for t in turns:
        if cur and t["end"] - cur["start"] > max_chars:
            chunks.append(cur)
            cur = None
        if cur is None:
            cur = {"start": t["start"], "end": t["end"]}
        else:
            cur["end"] = t["end"]
    if cur:
        chunks.append(cur)
    for c in chunks:
        c["text"] = text[c["start"]:c["end"]]
    return chunks


# ── the prompt ─────────────────────────────────────────────────────────────────────────────────
def build_prompt(chunk, meeting_meta, projects):
    """Prompt asking for strict JSON. `chunk` is text (or a pack_chunks dict); `projects` is a list of
    {'id','name'} or plain ids."""
    body = chunk["text"] if isinstance(chunk, dict) else str(chunk)
    plist = "\n".join("- %s" % (("%s (%s)" % (p["id"], p.get("name", ""))) if isinstance(p, dict) else p) for p in projects)
    meta = meeting_meta or {}
    return (
        "You extract DECISIONS from a family investment club meeting transcript.\n"
        "Meeting: %s, date %s.\n\n"
        "Known projects (use the id exactly):\n%s\n\n"
        "Rules:\n"
        "- Output only things the group agreed or resolved. Opinions, questions, suggestions nobody accepted "
        "and chatter produce nothing.\n"
        "- \"quote\" must be copied word for word from the transcript below, one or two sentences, no edits.\n"
        "- \"speaker\" is the name on the transcript label of the turn containing the quote. If the turn has no "
        "label use null. Never guess a speaker.\n"
        "- \"amount_ugx\" is an integer in UGX or null; \"effective_date\" is YYYY-MM-DD or null.\n"
        "- \"status\" is \"agreed\" or \"proposed\". \"rationale\" is the reason given, in one line, or empty.\n"
        "- If nothing was decided return {\"decisions\": []}.\n\n"
        "Return ONLY JSON, no prose, in exactly this shape:\n"
        "{\"decisions\":[{\"project_id\":\"\",\"statement\":\"\",\"rationale\":\"\",\"quote\":\"\","
        "\"speaker\":null,\"amount_ugx\":null,\"effective_date\":null,\"status\":\"agreed\"}]}\n\n"
        "TRANSCRIPT:\n%s\n"
    ) % (meta.get("ref", "?"), meta.get("date", "?"), plist or "- (none)", body)


# ── re-checking the model's answer ─────────────────────────────────────────────────────────────
_AMOUNT = re.compile(r"^\s*(?:ugx|ush)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|m|million|thousand)?\s*(?:ugx|ush)?\s*$", re.I)


def parse_amount(v):
    """'1.3m' -> 1300000, '500k' -> 500000, '1,300,000' -> 1300000, 250000 -> 250000. None for blank;
    raises ValueError for anything else (a doubtful amount must not be stored)."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if isinstance(v, bool):
        raise ValueError("amount")
    if isinstance(v, (int, float)):
        if v < 0:
            raise ValueError("amount")
        return int(round(v))
    m = _AMOUNT.match(str(v))
    if not m:
        raise ValueError("amount %r" % (v,))
    mult = {"k": 1000, "thousand": 1000, "m": 1000000, "million": 1000000}.get((m.group(2) or "").lower(), 1)
    return int(round(float(m.group(1).replace(",", "")) * mult))


def _parse_date(v):
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    return _dt.date.fromisoformat(str(v).strip())      # ValueError on anything but YYYY-MM-DD


def _normalised(text):
    """(collapsed text, index map): whitespace runs become one space; map[i] = offset in the original."""
    out, idx, prev_space = [], [], False
    for i, ch in enumerate(text):
        if ch.isspace():
            if prev_space or not out:
                continue
            out.append(" ")
            idx.append(i)
            prev_space = True
        else:
            out.append(ch)
            idx.append(i)
            prev_space = False
    return "".join(out), idx


def find_quote(quote, transcript):
    """Offset of `quote` in `transcript` ignoring whitespace differences, or -1."""
    nq = " ".join(str(quote or "").split())
    if len(nq) < MIN_QUOTE:
        return -1
    nt, idx = _normalised(transcript or "")
    at = nt.find(nq)
    return idx[at] if at >= 0 else -1


def _parse_json(raw):
    s = (raw or "").strip()
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s)
    try:
        return json.loads(s)
    except ValueError:
        a, b = s.find("{"), s.rfind("}")
        if a >= 0 and b > a:
            try:
                return json.loads(s[a:b + 1])
            except ValueError:
                return None
    return None


def check(raw, transcript, members=(), projects=(), turns=None):
    """Re-check the model's JSON against the stored transcript. Returns the decisions that survive, each
    {'project_id','statement','rationale','quote','quote_start','speaker','amount_ugx','effective_date',
    'status','confidence','source'}. Dropped: no verbatim quote, unknown project, bad statement, bad amount
    or date. Never raises on garbage. The speaker is taken from the transcript's own label for the turn
    holding the quote (the model's claim is only kept if it agrees), and only if that label is a known member."""
    data = _parse_json(raw)
    items = data.get("decisions") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    known = {(p["id"] if isinstance(p, dict) else p) for p in projects}
    by_label = {str(m).strip().lower(): m for m in members}
    turns = chunk_transcript(transcript) if turns is None else turns
    out, seen = [], set()
    for d in items:
        if not isinstance(d, dict):
            continue
        statement = " ".join(str(d.get("statement") or "").split())
        if not statement or len(statement) > MAX_STATEMENT:
            continue
        if d.get("project_id") not in known:
            continue
        start = find_quote(d.get("quote"), transcript)
        if start < 0:
            continue
        try:
            amount, eff = parse_amount(d.get("amount_ugx")), _parse_date(d.get("effective_date"))
        except (ValueError, TypeError, OverflowError):
            continue
        status = d.get("status") if d.get("status") in ("agreed", "proposed") else "proposed"
        speaker = None
        turn = next((t for t in turns if t["start"] <= start < t["end"]), None)
        if turn and turn["speaker"]:
            label = by_label.get(turn["speaker"].strip().lower())
            claimed = str(d.get("speaker") or "").strip().lower()
            if label and (not claimed or claimed == turn["speaker"].strip().lower()):
                speaker = label
        key = (start, statement)
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "project_id": d["project_id"], "statement": statement,
            "rationale": " ".join(str(d.get("rationale") or "").split())[:MAX_RATIONALE],
            "quote": " ".join(str(d["quote"]).split()), "quote_start": start, "speaker": speaker,
            "amount_ugx": amount, "effective_date": eff, "status": status,
            "confidence": 0.8 if speaker else 0.6, "source": "transcript",
        })
    return out


def minutes_decisions(key_decisions, project_id=None):
    """Fallback for meetings with no transcript: one decision per key_decisions bullet. No quote, no
    speaker, low confidence. Accepts a list, a JSON list string or newline-separated text."""
    items = key_decisions
    if isinstance(items, str):
        try:
            items = json.loads(items)
        except ValueError:
            items = items.splitlines()
    if not isinstance(items, list):
        return []
    out, seen = [], set()
    for it in items:
        s = " ".join(str(it.get("text") if isinstance(it, dict) else it).split()).lstrip("-*• ").strip()
        if len(s) < 8 or s in seen:
            continue
        seen.add(s)
        out.append({"project_id": project_id, "statement": s[:MAX_STATEMENT], "rationale": "", "quote": None,
                    "quote_start": None, "speaker": None, "amount_ugx": None, "effective_date": None,
                    "status": "agreed", "confidence": 0.4, "source": "minutes"})
    return out


# ── database layer ─────────────────────────────────────────────────────────────────────────────
_DDL = [
    """CREATE TABLE IF NOT EXISTS decisions (
        id SERIAL PRIMARY KEY, project_id TEXT, meeting_id INTEGER NOT NULL, meeting_ref TEXT,
        statement TEXT NOT NULL, rationale TEXT, quote TEXT, quote_start INTEGER, speaker TEXT,
        amount_ugx BIGINT, effective_date DATE,
        status TEXT NOT NULL DEFAULT 'agreed' CHECK (status IN ('agreed','proposed','superseded','reversed')),
        supersedes_id INTEGER, confidence REAL NOT NULL DEFAULT 0,
        review_state TEXT NOT NULL DEFAULT 'unreviewed' CHECK (review_state IN ('unreviewed','confirmed','corrected')),
        reviewed_by TEXT, reviewed_at TIMESTAMPTZ,
        source TEXT NOT NULL DEFAULT 'transcript' CHECK (source IN ('transcript','minutes')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ)""",
    # the spec's unique (meeting_id, quote_start, statement); minutes rows have no offset, so NULL -> -1
    "CREATE UNIQUE INDEX IF NOT EXISTS decisions_uq ON decisions(meeting_id, COALESCE(quote_start, -1), statement)",
    "CREATE INDEX IF NOT EXISTS decisions_project ON decisions(project_id)",
    """CREATE TABLE IF NOT EXISTS decision_links (
        id SERIAL PRIMARY KEY, decision_id INTEGER NOT NULL REFERENCES decisions(id),
        target_type TEXT NOT NULL CHECK (target_type IN ('action','ledger_expense','ledger_sale','ledger_stock',
            'ledger_loss','treasury_payment','projection_line','kpi','open_item')),
        target_ref TEXT NOT NULL,
        relation TEXT NOT NULL CHECK (relation IN ('authorised','caused','explains','contradicts')),
        state TEXT NOT NULL DEFAULT 'suggested' CHECK (state IN ('suggested','confirmed','rejected')),
        score REAL, note TEXT, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (decision_id, target_type, target_ref, relation))""",
    # meetings are an older table owned by main.py; the private flag is added here, default not private
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE",
    "CREATE INDEX IF NOT EXISTS actions_meeting_id_idx ON actions(meeting_id)",
]


def ready():
    """Create the register tables once per process, under an advisory lock (two workers race here).
    Never raises; returns whether the register is usable."""
    global _READY
    if _READY:
        return True
    try:
        from db import db as _db
        with _db() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_KEY,))
                for ddl in _DDL:
                    cur.execute(ddl)
        _READY = True
    except Exception as _e:
        import logging
        logging.getLogger("uvicorn.error").warning("decision tables unavailable: %s", _e)
    return _READY


class DbStore:
    """The real store behind extract_meeting / suggest_links. Tests pass a fake with the same methods."""

    def load_meeting(self, meeting_id):
        from db import query as _q
        rows = _q("SELECT id, ref, date, transcript, key_decisions, is_private FROM meetings WHERE id=%s", (meeting_id,))
        return rows[0] if rows else None

    def projects(self):
        from db import query as _q
        try:
            return [{"id": r["id"], "name": r.get("name") or r["id"]} for r in _q("SELECT id, name FROM projects")]
        except Exception:
            return []

    def members(self):
        import auth
        return [m["name"] for m in auth.MEMBERS]

    def existing_keys(self, meeting_id):
        from db import query as _q
        return {(r["quote_start"], r["statement"]) for r in _q(
            "SELECT quote_start, statement FROM decisions WHERE meeting_id=%s", (meeting_id,))}

    def insert_decisions(self, meeting, rows):
        from db import db as _db
        n = 0
        with _db() as conn:
            with conn.cursor() as cur:
                for r in rows:
                    cur.execute(
                        "INSERT INTO decisions (project_id, meeting_id, meeting_ref, statement, rationale, quote, quote_start,"
                        " speaker, amount_ugx, effective_date, status, confidence, source) "
                        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                        "ON CONFLICT (meeting_id, COALESCE(quote_start, -1), statement) DO NOTHING",
                        (r["project_id"], meeting["id"], meeting.get("ref"), r["statement"], r["rationale"], r["quote"],
                         r["quote_start"], r["speaker"], r["amount_ugx"], r["effective_date"], r["status"],
                         r["confidence"], r["source"]))
                    n += cur.rowcount
        return n

    def decisions(self, project_id):
        from db import query as _q
        return _q("SELECT d.id, d.statement, d.amount_ugx, d.meeting_id, d.effective_date, m.date AS meeting_date "
                  "FROM decisions d JOIN meetings m ON m.id=d.meeting_id "
                  "WHERE d.project_id=%s AND d.deleted_at IS NULL AND d.status IN ('agreed','proposed')", (project_id,))

    def existing_links(self, project_id):
        from db import query as _q
        return {(r["decision_id"], r["target_type"], r["target_ref"], r["relation"]) for r in _q(
            "SELECT l.decision_id, l.target_type, l.target_ref, l.relation FROM decision_links l "
            "JOIN decisions d ON d.id=l.decision_id WHERE d.project_id=%s", (project_id,))}

    def candidates(self, project_id):
        from db import query as _q
        c = []
        for r in _q("SELECT ref, description, meeting_id FROM actions WHERE project_id=%s", (project_id,)):
            c.append({"target_type": "action", "target_ref": r["ref"], "date": None, "amount": None,
                      "text": r["description"] or "", "meeting_id": r["meeting_id"]})
        for table, ttype, dcol, acol, tcol in (
                ("ledger_expenses", "ledger_expense", "expense_date", "total", "item"),
                ("ledger_sales", "ledger_sale", "sale_date", "total", "product_id"),
                ("ledger_stock", "ledger_stock", "event_date", "total_cost", "supplier"),
                ("ledger_losses", "ledger_loss", "loss_date", "total", "reason")):
            try:
                rows = _q("SELECT id, %s AS d, %s AS a, %s AS t FROM %s WHERE project_id=%%s AND deleted_at IS NULL"
                          % (dcol, acol, tcol, table), (project_id,))
            except Exception:
                continue
            for r in rows:
                c.append({"target_type": ttype, "target_ref": str(r["id"]), "date": r["d"], "amount": r["a"],
                          "text": r["t"] or "", "meeting_id": None})
        try:
            for r in _q("SELECT id, txn_date, description, amount_ugx FROM expenditure_records WHERE project=%s", (project_id,)):
                c.append({"target_type": "treasury_payment", "target_ref": str(r["id"]), "date": r["txn_date"],
                          "amount": r["amount_ugx"], "text": r["description"] or "", "meeting_id": None})
        except Exception:
            pass
        return c

    def insert_links(self, links, who):
        from db import db as _db
        n = 0
        with _db() as conn:
            with conn.cursor() as cur:
                for k in links:
                    cur.execute(
                        "INSERT INTO decision_links (decision_id, target_type, target_ref, relation, state, score, note, created_by)"
                        " VALUES (%s,%s,%s,%s,'suggested',%s,%s,%s) "
                        "ON CONFLICT (decision_id, target_type, target_ref, relation) DO NOTHING",
                        (k["decision_id"], k["target_type"], k["target_ref"], k["relation"], k["score"], k["note"], who))
                    n += cur.rowcount
        return n


def extract_meeting(meeting_id, model_fn, store=None, projects=None, members=None):
    """Extract and store the decisions of one meeting. Idempotent: rows already stored (same quote offset
    and statement) are skipped, so a re-run adds nothing. A private meeting is skipped before its
    transcript is read. Returns {'status','found','added'}; status is 'ok', 'private', 'missing' or 'no_text'."""
    store = store or DbStore()
    meeting = store.load_meeting(meeting_id)
    if not meeting:
        return {"status": "missing", "found": 0, "added": 0}
    if meeting.get("is_private"):
        return {"status": "private", "found": 0, "added": 0}
    projects = store.projects() if projects is None else projects
    members = store.members() if members is None else members
    transcript = meeting.get("transcript") or ""
    meta = {"ref": meeting.get("ref"), "date": str(meeting.get("date") or "")}
    found = []
    if transcript.strip():
        turns = chunk_transcript(transcript)
        for ch in pack_chunks(transcript, turns):
            found += check(model_fn(build_prompt(ch, meta, projects)), transcript, members, projects, turns)
    else:
        found = minutes_decisions(meeting.get("key_decisions"))
        if not found:
            return {"status": "no_text", "found": 0, "added": 0}
    have = store.existing_keys(meeting["id"])
    uniq, keys = [], set(have)
    for d in found:
        k = (d["quote_start"], d["statement"])
        if k not in keys:
            keys.add(k)
            uniq.append(d)
    return {"status": "ok", "found": len(found), "added": store.insert_decisions(meeting, uniq) if uniq else 0}


# ── link suggestions ───────────────────────────────────────────────────────────────────────────
_STOP = set("this that with from have were will would should could about there their then than them what when "
            "which also into over some more very just like been being buy buying bought pay paying paid".split())


def _keywords(text):
    return {w for w in re.findall(r"[a-z]{4,}", (text or "").lower()) if w not in _STOP}


def _as_date(v):
    if isinstance(v, _dt.datetime):
        return v.date()
    if isinstance(v, _dt.date):
        return v
    try:
        return _dt.date.fromisoformat(str(v)[:10])
    except (ValueError, TypeError):
        return None


def score_links(decisions, candidates, existing=()):
    """Pure. Candidate links for each decision -> [{'decision_id','target_type','target_ref','relation',
    'score','note'}]. Anything whose (decision, type, ref, relation) is in `existing` (suggested, confirmed
    or REJECTED) is skipped, so a rejected link never comes back. Notes carry the reason, never content.
    Actions: same meeting and 2+ shared keywords. Money rows: dated 0-45 days after the meeting and
    amount equal (0.9) or within 5% (0.7), or 2+ shared keywords inside the window (0.4)."""
    existing = set(existing)
    out = []
    for d in decisions:
        dkw = _keywords(d.get("statement"))
        mdate = _as_date(d.get("meeting_date"))
        amount = d.get("amount_ugx")
        for c in candidates:
            shared = len(dkw & _keywords(c.get("text")))
            if c["target_type"] == "action":
                if not (c.get("meeting_id") is not None and c.get("meeting_id") == d.get("meeting_id") and shared >= 2):
                    continue
                score, rel, note = min(0.3 + 0.1 * shared, 0.8), "explains", "same meeting, %d shared keywords" % shared
            else:
                cdate = _as_date(c.get("date"))
                if mdate is None or cdate is None or not (0 <= (cdate - mdate).days <= LINK_WINDOW_DAYS):
                    continue
                cam = c.get("amount")
                reasons, score = [], 0.0
                if amount and cam:
                    if int(cam) == int(amount):
                        score, reasons = 0.9, ["exact amount match"]
                    elif abs(int(cam) - int(amount)) <= AMOUNT_TOLERANCE * int(amount):
                        score, reasons = 0.7, ["amount within 5 percent"]
                if shared >= 2:
                    score = max(score, 0.4) + (0.05 if score else 0)
                    reasons.append("%d shared keywords" % shared)
                if not reasons:
                    continue
                reasons.append("%d days after meeting" % (cdate - mdate).days)
                rel, note = "authorised", ", ".join(reasons)
            key = (d["id"], c["target_type"], str(c["target_ref"]), rel)
            if key in existing:
                continue
            existing.add(key)
            out.append({"decision_id": d["id"], "target_type": c["target_type"], "target_ref": str(c["target_ref"]),
                        "relation": rel, "score": round(score, 2), "note": note})
    return out


def suggest_links(project_id, store=None):
    """Store 'suggested' links for a project's decisions. Never confirms. Returns the number added."""
    store = store or DbStore()
    links = score_links(store.decisions(project_id), store.candidates(project_id), store.existing_links(project_id))
    return store.insert_links(links, "decision_trace suggest") if links else 0


def set_link_state(link_id, state, who):
    """Admin decision on a link: 'confirmed' or 'rejected'. Returns the updated row or None."""
    if state not in ("confirmed", "rejected"):
        raise ValueError("state")
    from db import query as _q, execute as _x
    if not _q("SELECT 1 FROM decision_links WHERE id=%s", (link_id,)):
        return None
    _x("UPDATE decision_links SET state=%s, note=COALESCE(note,'') || %s WHERE id=%s",
       (state, " [%s by %s]" % (state, who), link_id))
    return _q("SELECT * FROM decision_links WHERE id=%s", (link_id,))[0]


def add_link(decision_id, target_type, target_ref, relation, who, note=""):
    """Admin adds a link by hand: stored confirmed. An existing (even rejected) row is set to confirmed."""
    if target_type not in TARGET_TYPES or relation not in RELATIONS or not str(target_ref).strip():
        raise ValueError("bad link")
    from db import query as _q, execute as _x
    if not _q("SELECT 1 FROM decisions WHERE id=%s AND deleted_at IS NULL", (decision_id,)):
        return None
    _x("INSERT INTO decision_links (decision_id, target_type, target_ref, relation, state, note, created_by) "
       "VALUES (%s,%s,%s,%s,'confirmed',%s,%s) "
       "ON CONFLICT (decision_id, target_type, target_ref, relation) DO UPDATE SET state='confirmed'",
       (decision_id, target_type, str(target_ref).strip(), relation, (note or "")[:300], who))
    return _q("SELECT * FROM decision_links WHERE decision_id=%s AND target_type=%s AND target_ref=%s AND relation=%s",
              (decision_id, target_type, str(target_ref).strip(), relation))[0]
