"""
decision_trace.py - the decision register behind "Why?" (ADR-034, docs/specs/decision-trace.md).

Phases 0-2 only: tables, extraction pipeline, link suggestions. No trace API, no report, no UI.

Pure part (no database, no network): chunk_transcript, build_prompt, check, score_links, parse_amount.
The model is always an injected parameter, model_fn(prompt) -> str, so every test runs offline with a fake.

Hard rules enforced in code (spec):
  1. A quote must exist verbatim (whitespace-normalised) in the stored transcript, else the decision is dropped.
  2. A speaker is named only when the transcript labels the turn containing the quote with a known member.
  3. A private meeting (column OR override table) is never read, extracted, linked or shown; flagging purges it.
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


_SENTENCE = re.compile(r"\S.*?(?:[.!?]+(?=\s)|$)", re.S)
CARRY_CHARS = 300


def _units(text, turns, max_chars):
    """Whole turns, except that an oversized UNLABELLED turn is split at sentence boundaries."""
    units = []
    for t in turns:
        if t["speaker"] is None and t["end"] - t["start"] > max_chars:
            cur = None
            for m in _SENTENCE.finditer(text, t["start"], t["end"]):
                if cur and m.end() - cur["start"] > max_chars:
                    units.append(cur)
                    cur = None
                if cur is None:
                    cur = {"start": m.start(), "end": m.end(), "speaker": None}
                else:
                    cur["end"] = m.end()
            if cur:
                units.append(cur)
        else:
            units.append(t)
    return units


def pack_chunks(text, turns=None, max_chars=CHUNK_CHARS):
    """Group units into prompt-sized chunks -> [{'start','end','text','carry'}]. A labelled turn longer than
    the limit becomes its own chunk; an oversized unlabelled turn is split at sentence boundaries.
    `carry` is the previous chunk's last sentence (context for the prompt only, never quotable)."""
    turns = chunk_transcript(text) if turns is None else turns
    chunks, cur = [], None
    for t in _units(text, turns, max_chars):
        if cur and t["end"] - cur["start"] > max_chars:
            chunks.append(cur)
            cur = None
        if cur is None:
            cur = {"start": t["start"], "end": t["end"]}
        else:
            cur["end"] = t["end"]
    if cur:
        chunks.append(cur)
    prev = None
    for c in chunks:
        c["text"] = text[c["start"]:c["end"]]
        c["carry"] = ""
        if prev is not None:
            last = [m.group(0) for m in _SENTENCE.finditer(prev["text"])]
            c["carry"] = " ".join(last[-1].split())[-CARRY_CHARS:] if last else ""
        prev = c
    return chunks


# ── the prompt ─────────────────────────────────────────────────────────────────────────────────
def build_prompt(chunk, meeting_meta, projects):
    """Prompt asking for strict JSON. `chunk` is text (or a pack_chunks dict); `projects` is a list of
    {'id','name'} or plain ids."""
    body = chunk["text"] if isinstance(chunk, dict) else str(chunk)
    plist = "\n".join("- %s" % (("%s (%s)" % (p["id"], p.get("name", ""))) if isinstance(p, dict) else p) for p in projects)
    meta = meeting_meta or {}
    carry = chunk.get("carry") if isinstance(chunk, dict) else ""
    carry_line = ("Previous section ended with (context only, never quote from this line): %s\n\n"
                  % " ".join(carry.split())) if carry else ""
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
        "%sTRANSCRIPT:\n%s\n"
    ) % (meta.get("ref", "?"), meta.get("date", "?"), plist or "- (none)", carry_line, body)


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


_QUOTES = str.maketrans({"\u2018": "'", "\u2019": "'", "\u201a": "'", "\u201b": "'", "\u2032": "'",
                         "\u201c": '"', "\u201d": '"', "\u201e": '"', "\u201f": '"', "\u2033": '"'})


def _normalised(text):
    """(collapsed text, index map): whitespace runs become one space and typographic quotes become straight
    ones (1:1, so offsets hold); map[i] = offset in the original."""
    out, idx, prev_space = [], [], False
    for i, ch in enumerate(text):
        if ch.isspace():
            if prev_space or not out:
                continue
            out.append(" ")
            idx.append(i)
            prev_space = True
        else:
            out.append(ch.translate(_QUOTES))
            idx.append(i)
            prev_space = False
    return "".join(out), idx


def find_quote_span(quote, transcript, span=None):
    """-> (start, end, unique): offsets of `quote` in `transcript` (whitespace and typographic quotes ignored),
    or (-1, -1, False). With `span=(a, b)` only occurrences starting inside [a, b) count (the chunk the model
    was shown, so the carry-over text can never match). Without a span all occurrences count. `unique` is
    False when more than one occurrence remains, in which case no speaker may be attributed."""
    nq = " ".join(str(quote or "").split()).translate(_QUOTES)
    if len(nq) < MIN_QUOTE:
        return -1, -1, False
    nt, idx = _normalised(transcript or "")
    hits, at = [], nt.find(nq)
    while at >= 0:
        if span is None or span[0] <= idx[at] < span[1]:
            hits.append(at)
        at = nt.find(nq, at + 1)
    if not hits:
        return -1, -1, False
    at = hits[0]
    return idx[at], idx[at + len(nq) - 1] + 1, len(hits) == 1


def find_quote(quote, transcript):
    """Offset of `quote` in `transcript` ignoring whitespace and quote-style differences, or -1."""
    return find_quote_span(quote, transcript)[0]


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


def check(raw, transcript, members=(), projects=(), turns=None, span=None):
    """Re-check the model's JSON against the stored transcript. Returns the decisions that survive, each
    {'project_id','statement','rationale','quote','quote_start','speaker','amount_ugx','effective_date',
    'status','confidence','source'}. Dropped: no verbatim quote, unknown project, bad statement, bad amount
    or date. Never raises on garbage. The speaker is taken from the transcript's own label for the turn
    holding the quote (the model's claim is only kept if it agrees), and only if that label is a known member
    and the quote occurs once (in `span`, the chunk shown to the model, when given)."""
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
        start, qend, unique = find_quote_span(d.get("quote"), transcript, span)
        if start < 0:
            continue
        try:
            amount, eff = parse_amount(d.get("amount_ugx")), _parse_date(d.get("effective_date"))
        except (ValueError, TypeError, OverflowError):
            continue
        status = d.get("status") if d.get("status") in ("agreed", "proposed") else "proposed"
        speaker, speaker_label = None, None
        turn = next((t for t in turns if t["start"] <= start < t["end"]), None)
        if unique and turn and turn["speaker"] and not turn["speaker"].upper().startswith("SOURCE:"):
            speaker_label = turn["speaker"].strip()
        if unique and turn and turn["speaker"]:
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
            "quote": " ".join(transcript[start:qend].split()), "quote_start": start, "speaker": speaker,
            "speaker_label": speaker_label,
            "amount_ugx": amount, "effective_date": eff, "status": status,
            "confidence": 0.8 if speaker else 0.6, "source": "transcript",
        })
    return out


def tag_project(text, projects=None):
    """The one project a bullet is about, by whole-word keyword, or None when it matches none or several."""
    from project_names import PROJECT_KEYWORDS
    low = (text or "").lower()
    hit = {pid for pid, kws in PROJECT_KEYWORDS.items()
           if (projects is None or pid in projects) and any(re.search(r"\b%s\b" % re.escape(k), low) for k in kws)}
    return next(iter(hit)) if len(hit) == 1 else None


def minutes_decisions(key_decisions, project_id=None, projects=None):
    """Fallback for meetings with no transcript: one decision per key_decisions bullet. No quote, no
    speaker, low confidence. Each bullet is tagged to a project by conservative keywords (or `project_id`
    when given); a bullet that cannot be tagged is NOT stored (every read filters on project).
    Accepts a list, a JSON list string or newline-separated text."""
    items = key_decisions
    if isinstance(items, str):
        try:
            items = json.loads(items)
        except ValueError:
            items = items.splitlines()
    if not isinstance(items, list):
        return []
    known = None if projects is None else {(p["id"] if isinstance(p, dict) else p) for p in projects}
    out, seen = [], set()
    for it in items:
        s = " ".join(str(it.get("text") if isinstance(it, dict) else it).split()).lstrip("-*• ").strip()
        if len(s) < 8 or s in seen:
            continue
        pid = project_id or tag_project(s, known)
        if not pid:
            continue
        seen.add(s)
        out.append({"project_id": pid, "statement": s[:MAX_STATEMENT], "rationale": "", "quote": None,
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
    # authoritative per-meeting private override: a table the app role can always create
    """CREATE TABLE IF NOT EXISTS decision_private_meetings (
        meeting_id INTEGER PRIMARY KEY, set_by TEXT, set_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
]
# Column added to the app-owned decisions table, in its own transaction after the tables exist: the raw transcript label of
# the quoted turn (Speaker 3, or a name). Who it is comes from meeting_speakers at display time (speaker_map.py).
_DDL_COLUMNS = ["ALTER TABLE decisions ADD COLUMN IF NOT EXISTS speaker_label TEXT"]
# `meetings` and `actions` are owned by the postgres role, not the app role: nothing below may be part of the
# DDL transaction above (a failing ALTER would roll back the tables and keep the register at 503).
_PRIVATE_COL = None     # cached probe: does meetings.is_private exist?


def _has_private_col(refresh=False):
    """True if meetings.is_private exists. Probed once per process and cached; a failed probe counts as
    'no column' for that call and is not cached."""
    global _PRIVATE_COL
    if _PRIVATE_COL is not None and not refresh:
        return _PRIVATE_COL
    try:
        from db import query as _q
        _PRIVATE_COL = bool(_q("SELECT 1 FROM information_schema.columns "
                               "WHERE table_name='meetings' AND column_name='is_private'"))
    except Exception:
        return False
    return _PRIVATE_COL


def private_clause(col):
    """SQL condition that is true when meeting id `col` is NOT private (column or override table). A NULL
    meeting id is not private. Works whether or not meetings.is_private exists."""
    c = "NOT EXISTS (SELECT 1 FROM decision_private_meetings pm WHERE pm.meeting_id=%s)" % col
    if _has_private_col():
        c += " AND NOT EXISTS (SELECT 1 FROM meetings pmm WHERE pmm.id=%s AND pmm.is_private)" % col
    return "(" + c + ")"


def _best_effort_owned_objects():
    """meetings.is_private and the actions(meeting_id) index live on tables the app role does not own.
    Same pattern as main._ensure_meeting_cols: check first, attempt the DDL in its own transaction, log
    and continue on failure. The override table is authoritative either way. Never raises."""
    import logging
    log = logging.getLogger("uvicorn.error")
    from db import db as _db, query as _q
    if not _has_private_col(refresh=True):
        try:
            with _db() as conn:
                with conn.cursor() as cur:
                    cur.execute("ALTER TABLE meetings ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE")
        except Exception as e:
            log.warning("decision_trace: meetings.is_private not added (owner ALTER needed; override table is used): %s", e)
        _has_private_col(refresh=True)
    try:
        if not _q("SELECT 1 FROM pg_indexes WHERE tablename='actions' AND indexname='actions_meeting_id_idx'"):
            with _db() as conn:
                with conn.cursor() as cur:
                    cur.execute("CREATE INDEX IF NOT EXISTS actions_meeting_id_idx ON actions(meeting_id)")
    except Exception as e:
        log.warning("decision_trace: actions(meeting_id) index not created: %s", e)


def ready():
    """Create the register tables (only tables the app role owns) once per process, under an advisory lock
    (two workers race here), then best-effort the optional objects on tables it does not own.
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
        with _db() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_KEY,))
                for ddl in _DDL_COLUMNS:
                    cur.execute(ddl)
        _READY = True
    except Exception as _e:
        import logging
        logging.getLogger("uvicorn.error").warning("decision tables unavailable: %s", _e)
        return False
    try:
        _best_effort_owned_objects()
    except Exception:
        pass
    return _READY


class DbStore:
    """The real store behind extract_meeting / suggest_links. Tests pass a fake with the same methods."""

    def load_meeting(self, meeting_id):
        """The meeting row; a private meeting is returned WITHOUT its transcript or minutes."""
        from db import query as _q
        if not _q("SELECT 1 FROM meetings WHERE id=%s", (meeting_id,)):
            return None
        if self.is_private(meeting_id):
            return {"id": meeting_id, "ref": None, "date": None, "transcript": None, "key_decisions": None, "is_private": True}
        row = _q("SELECT id, ref, date, transcript, key_decisions FROM meetings WHERE id=%s", (meeting_id,))[0]
        row["is_private"] = False
        return row

    def is_private(self, meeting_id):
        from db import query as _q
        if _q("SELECT 1 FROM decision_private_meetings WHERE meeting_id=%s", (meeting_id,)):
            return True
        return bool(_has_private_col() and _q("SELECT 1 FROM meetings WHERE id=%s AND is_private", (meeting_id,)))

    def projects(self):
        from project_names import PROJECT_NAMES
        return [{"id": k, "name": v} for k, v in PROJECT_NAMES.items()]

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
                        " speaker, amount_ugx, effective_date, status, confidence, source, speaker_label) "
                        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                        "ON CONFLICT (meeting_id, COALESCE(quote_start, -1), statement) DO NOTHING",
                        (r["project_id"], meeting["id"], meeting.get("ref"), r["statement"], r["rationale"], r["quote"],
                         r["quote_start"], r["speaker"], r["amount_ugx"], r["effective_date"], r["status"],
                         r["confidence"], r["source"], r.get("speaker_label")))
                    n += cur.rowcount
        return n

    def decisions(self, project_id):
        from db import query as _q
        return _q("SELECT d.id, d.statement, d.amount_ugx, d.meeting_id, d.effective_date, m.date AS meeting_date "
                  "FROM decisions d JOIN meetings m ON m.id=d.meeting_id "
                  "WHERE d.project_id=%s AND d.deleted_at IS NULL AND d.status IN ('agreed','proposed') AND "
                  + private_clause("d.meeting_id"), (project_id,))

    def existing_links(self, project_id):
        from db import query as _q
        return {(r["decision_id"], r["target_type"], r["target_ref"], r["relation"]) for r in _q(
            "SELECT l.decision_id, l.target_type, l.target_ref, l.relation FROM decision_links l "
            "JOIN decisions d ON d.id=l.decision_id WHERE d.project_id=%s AND d.deleted_at IS NULL AND "
            + private_clause("d.meeting_id"), (project_id,))}

    def candidates(self, project_id):
        from db import query as _q
        c = []
        for r in _q("SELECT ref, description, meeting_id FROM actions a WHERE project_id=%s AND "
                    + private_clause("a.meeting_id"), (project_id,)):
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
    transcript is read. Returns {'status','found','added'}; status is 'ok', 'private', 'missing', 'no_text',
    'unavailable' (register tables not ready) or 'error' (no projects to tag decisions to; 'message' says so)."""
    if store is None:
        if not ready():
            return {"status": "unavailable", "found": 0, "added": 0}
        store = DbStore()
    meeting = store.load_meeting(meeting_id)
    if not meeting:
        return {"status": "missing", "found": 0, "added": 0}
    if meeting.get("is_private"):
        return {"status": "private", "found": 0, "added": 0}
    projects = store.projects() if projects is None else projects
    if not projects:
        return {"status": "error", "found": 0, "added": 0,
                "message": "No projects configured: refusing to extract, every decision would be dropped"}
    members = store.members() if members is None else members
    transcript = meeting.get("transcript") or ""
    meta = {"ref": meeting.get("ref"), "date": str(meeting.get("date") or "")}
    found = []
    if transcript.strip():
        turns = chunk_transcript(transcript)
        for ch in pack_chunks(transcript, turns):
            found += check(model_fn(build_prompt(ch, meta, projects)), transcript, members, projects, turns,
                           span=(ch["start"], ch["end"]))
    else:
        found = minutes_decisions(meeting.get("key_decisions"), projects=projects)
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
        in_window = lambda c: (mdate is not None and _as_date(c.get("date")) is not None  # noqa: E731
                               and 0 <= (_as_date(c["date"]) - mdate).days <= LINK_WINDOW_DAYS)
        n_amount = sum(1 for c in candidates if c["target_type"] != "action" and amount and c.get("amount")
                       and in_window(c) and abs(int(c["amount"]) - int(amount)) <= AMOUNT_TOLERANCE * int(amount))
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
                reasons, score, amt_hit = [], 0.0, False
                if amount and cam:
                    if int(cam) == int(amount):
                        score, reasons, amt_hit = 0.9, ["exact amount match"], True
                    elif abs(int(cam) - int(amount)) <= AMOUNT_TOLERANCE * int(amount):
                        score, reasons, amt_hit = 0.7, ["amount within 5 percent"], True
                if shared >= 2:
                    score = max(score, 0.4) + (0.05 if score else 0)
                    reasons.append("%d shared keywords" % shared)
                if not reasons:
                    continue
                reasons.append("%d days after meeting" % (cdate - mdate).days)
                if amt_hit and n_amount > 1:       # a round amount matches many rows: none of them is a safe guess
                    score = min(score, 0.5)
                    reasons.append("%d rows match this amount" % n_amount)
                rel, note = "authorised", ", ".join(reasons)
            key = (d["id"], c["target_type"], str(c["target_ref"]), rel)
            if key in existing:
                continue
            existing.add(key)
            out.append({"decision_id": d["id"], "target_type": c["target_type"], "target_ref": str(c["target_ref"]),
                        "relation": rel, "score": round(score, 2), "note": note})
    return out


def suggest_links(project_id, store=None):
    """Store 'suggested' links for a project's decisions. Never confirms.
    Returns {'status': 'ok'|'unavailable', 'added': n}."""
    if store is None:
        if not ready():
            return {"status": "unavailable", "added": 0}
        store = DbStore()
    links = score_links(store.decisions(project_id), store.candidates(project_id), store.existing_links(project_id))
    return {"status": "ok", "added": store.insert_links(links, "decision_trace suggest") if links else 0}


def purge_meeting(meeting_id):
    """Soft-delete every decision of a meeting (used when it is flagged private). Returns the count."""
    from db import query as _q, execute as _x
    n = len(_q("SELECT id FROM decisions WHERE meeting_id=%s AND deleted_at IS NULL", (meeting_id,)))
    if n:
        _x("UPDATE decisions SET deleted_at=now() WHERE meeting_id=%s AND deleted_at IS NULL", (meeting_id,))
    try:  # the speaker map keeps transcript sample lines: a private meeting leaves nothing behind
        _x("DELETE FROM meeting_speakers WHERE meeting_id=%s", (meeting_id,))
    except Exception:
        pass
    return n


def set_private(meeting_id, private, who):
    """Admin flag via the override table (authoritative). True: record it and purge the meeting's
    decisions; False: restore the decisions that flag purged, then remove the override. -> {'private','purged',
    'restored'} or None when the meeting does not exist."""
    from db import query as _q, execute as _x
    if not _q("SELECT 1 FROM meetings WHERE id=%s", (meeting_id,)):
        return None
    if private:
        _x("INSERT INTO decision_private_meetings (meeting_id, set_by) VALUES (%s,%s) "
           "ON CONFLICT (meeting_id) DO UPDATE SET set_by=EXCLUDED.set_by, set_at=now()", (meeting_id, who))
        return {"private": True, "purged": purge_meeting(meeting_id)}
    # a mistaken flag must be reversible: bring back what the flag purged (deleted at or after it was set)
    from db import execute_returning as _xr
    restored = len(_xr("UPDATE decisions SET deleted_at=NULL WHERE meeting_id=%s AND deleted_at IS NOT NULL AND deleted_at >= "
                       "(SELECT set_at FROM decision_private_meetings WHERE meeting_id=%s) RETURNING id", (meeting_id, meeting_id)))
    _x("DELETE FROM decision_private_meetings WHERE meeting_id=%s", (meeting_id,))
    return {"private": False, "purged": 0, "restored": restored}


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


# ── trace chain (phase 3): the read side behind the Why? panel ─────────────────────────────────
CONTEXT_LINES = 2
MAX_LINE = 400
REVIEW_STATES = ("confirmed", "corrected")
TRACE_TARGETS = ("ledger_expense", "ledger_sale", "ledger_stock", "ledger_loss", "treasury_payment", "open_item", "action", "decision")
_OUTCOME_TABLES = {   # target_type -> (table, date column, amount column, label column)
    "ledger_expense": ("ledger_expenses", "expense_date", "total", "item"),
    "ledger_sale": ("ledger_sales", "sale_date", "total", "product_id"),
    "ledger_stock": ("ledger_stock", "event_date", "total_cost", "supplier"),
    "ledger_loss": ("ledger_losses", "loss_date", "total", "reason"),
}


def quote_context(transcript, quote_start, quote, lines=CONTEXT_LINES):
    """The quote with up to `lines` transcript lines either side, taken at quote_start. Pure. Returns None
    when there is no transcript, no offset or the offset is outside the text (nothing is guessed). The whole
    transcript is never returned: only the quote's own lines plus the context, each capped in length."""
    if not transcript or quote_start is None or not quote or not (0 <= quote_start < len(transcript)):
        return None
    # the transcript may have been edited or re-imported since extraction: the offset must still hold this quote,
    # otherwise unrelated lines would be shown as its context
    start, _end, _unique = find_quote_span(quote, transcript, span=(quote_start, quote_start + 1))
    if start < 0:
        return {"before": [], "quote": quote, "after": []}
    parts = transcript.split("\n")
    pos = 0
    spans = []
    for i, p in enumerate(parts):
        spans.append((pos, pos + len(p)))
        pos += len(p) + 1
    end = min(quote_start + len(quote), len(transcript))
    first = next((i for i, (a, b) in enumerate(spans) if a <= quote_start <= b), None)
    if first is None:
        return None
    last = next((i for i, (a, b) in enumerate(spans) if a <= max(end - 1, quote_start) <= b), first)
    clip = lambda s: s.strip()[:MAX_LINE]
    keep = lambda seq: [clip(x) for x in seq if x.strip()]
    return {"before": keep(parts[max(0, first - lines):first]), "quote": quote,
            "after": keep(parts[last + 1:last + 1 + lines])}


def visible_links(links):
    """Rejected links are hidden everywhere in the trace; the rest keep their state (confirmed or suggested)."""
    return [l for l in links if l.get("state") != "rejected"]


def review_args(state, statement=None):
    """Validate an admin review. -> (state, statement or None). 'corrected' needs a bounded new statement;
    'confirmed' keeps the stored one. Raises ValueError."""
    if state not in REVIEW_STATES:
        raise ValueError("state")
    if state == "confirmed":
        return state, None
    s = " ".join(str(statement or "").split())
    if not s or len(s) > MAX_STATEMENT:
        raise ValueError("statement")
    return state, s


def review_decision(decision_id, state, statement, who):
    """Admin review: sets review_state, reviewed_by/at and (when corrected) the statement. -> row or None."""
    state, statement = review_args(state, statement)
    from db import execute_returning as _xr
    rows = _xr("UPDATE decisions SET review_state=%s, statement=COALESCE(%s, statement), reviewed_by=%s, reviewed_at=now() "
               "WHERE id=%s AND deleted_at IS NULL AND " + private_clause("decisions.meeting_id") + " RETURNING *",
               (state, statement, who, decision_id))
    return rows[0] if rows else None


def _iso(v):
    import datetime as _d
    return v.isoformat() if isinstance(v, (_d.date, _d.datetime)) else v


def _outcome_rows(project_id, links):
    """Ledger and treasury rows the links point at, with a total. Missing rows are skipped."""
    from db import query as _q
    out, seen = [], set()
    for l in links:
        key = (l["target_type"], l["target_ref"])
        if key in seen or not str(l["target_ref"]).isdigit():
            continue
        seen.add(key)
        rid = int(l["target_ref"])
        if l["target_type"] in _OUTCOME_TABLES:
            t, d, a, lab = _OUTCOME_TABLES[l["target_type"]]
            rows = _q("SELECT id, %s AS d, %s AS a, %s AS label FROM %s WHERE id=%%s AND project_id=%%s AND deleted_at IS NULL"
                      % (d, a, lab, t), (rid, project_id))
        elif l["target_type"] == "treasury_payment":
            rows = _q("SELECT id, txn_date AS d, amount_ugx AS a, description AS label FROM expenditure_records "
                      "WHERE id=%s AND project=%s", (rid, project_id))
        else:
            continue
        if rows:
            r = rows[0]
            out.append({"target_type": l["target_type"], "target_ref": str(r["id"]), "date": _iso(r["d"]),
                        "label": r["label"], "amount": r["a"], "state": l["state"]})
    return {"rows": out, "total": sum(int(r["amount"] or 0) for r in out)}


def _action_rows(refs, project_id):
    from db import query as _q
    out = []
    for ref in refs:
        a = _q("SELECT id, ref, description, assignee, assignees, deadline, status FROM actions WHERE ref=%s AND project_id=%s AND "
               + private_clause("meeting_id"), (ref, project_id))
        if not a:
            continue
        a = a[0]
        ups = _q("SELECT created_at, author, type, text FROM action_updates WHERE action_id=%s "
                 "ORDER BY created_at, id", (a["id"],))
        out.append({"ref": a["ref"], "description": a["description"],
                    "assignees": (", ".join(x for x in a["assignees"] if x) if isinstance(a["assignees"], (list, tuple)) and a["assignees"] else (a["assignee"] or "")), "deadline": _iso(a["deadline"]), "status": a["status"],
                    "updates": [{"at": _iso(u["created_at"]), "author": u["author"], "type": u["type"], "text": u["text"]}
                                for u in ups]})
    return out


def trace(project_id, target_type, target_ref):
    """The chain for one target: decisions (confirmed or suggested links only, private meetings skipped, quote
    with context from the stored transcript), linked actions and outcome rows. Reads only."""
    if target_type not in TRACE_TARGETS:
        raise ValueError("target_type")
    target_ref = str(target_ref).strip()
    if not target_ref:
        raise ValueError("target_ref")
    from db import query as _q
    if target_type == "decision":     # a citation [D<id>] in the report: the decision itself, with its own links
        if not target_ref.isdigit():
            raise ValueError("target_ref")
        rows = _q("SELECT d.*, m.date AS meeting_date, m.transcript AS _transcript, 'confirmed' AS link_state, 'explains' AS link_relation "
                  "FROM decisions d JOIN meetings m ON m.id=d.meeting_id WHERE d.id=%s AND d.project_id=%s AND d.deleted_at IS NULL AND "
                  + private_clause("d.meeting_id"), (int(target_ref), project_id))
    else:
        rows = _q("SELECT d.*, m.date AS meeting_date, m.transcript AS _transcript, l.state AS link_state, l.relation AS link_relation "
                  "FROM decision_links l JOIN decisions d ON d.id=l.decision_id JOIN meetings m ON m.id=d.meeting_id "
                  "WHERE l.target_type=%s AND l.target_ref=%s AND l.state<>'rejected' AND d.project_id=%s AND d.deleted_at IS NULL AND "
                  + private_clause("d.meeting_id") + " ORDER BY m.date, d.quote_start NULLS LAST, d.id",
                  (target_type, target_ref, project_id))
    import speaker_map as _sm
    mapping = _sm.confirmed_map([d["meeting_id"] for d in rows])
    rows = _sm.attribute(rows, mapping)
    decisions, ids = [], []
    for d in rows:
        ids.append(d["id"])
        decisions.append({
            "id": d["id"], "statement": d["statement"], "rationale": d["rationale"], "status": d["status"],
            "review_state": d["review_state"], "reviewed_by": d["reviewed_by"], "reviewed_at": _iso(d["reviewed_at"]),
            "speaker": d["speaker"], "speaker_label": d["speaker_label"], "attribution": d["attribution"],
            "shared": d["shared"], "unattributed": d["unattributed"], "source": d["source"],
            "meeting_id": d["meeting_id"], "meeting_ref": d["meeting_ref"], "meeting_date": _iso(d["meeting_date"]),
            "amount_ugx": d["amount_ugx"], "link_state": d["link_state"], "link_relation": d["link_relation"],
            "suggested": d["link_state"] == "suggested",
            "quote": quote_context(d["_transcript"], d["quote_start"], d["quote"]) if d["quote"] else None})
    links = _q("SELECT l.target_type, l.target_ref, l.state FROM decision_links l WHERE l.decision_id = ANY(%s) AND l.state<>'rejected'",
               (ids,)) if ids else []
    own = [{"target_type": target_type, "target_ref": target_ref, "state": "confirmed"}] if target_type not in ("action", "decision") else []
    refs = sorted({l["target_ref"] for l in links if l["target_type"] == "action"} | ({target_ref} if target_type == "action" else set()))
    return {"target": {"type": target_type, "ref": target_ref}, "decisions": decisions,
            "actions": _action_rows(refs, project_id),
            "outcome": _outcome_rows(project_id, [l for l in links if l["target_type"] != "action"] + own),
            "found": bool(decisions)}


def register(project_id):
    """The register for members: non-rejected links, non-private meetings, with the meeting date. Reads only."""
    from db import query as _q
    ds = _q("SELECT d.id, d.project_id, d.meeting_id, d.meeting_ref, m.date AS meeting_date, d.statement, d.rationale, d.quote, "
            "d.speaker_label, d.amount_ugx, d.effective_date, d.status, d.review_state, d.source, d.confidence "
            "FROM decisions d JOIN meetings m ON m.id=d.meeting_id WHERE d.project_id=%s AND d.deleted_at IS NULL AND "
            + private_clause("d.meeting_id") + " ORDER BY m.date, d.meeting_id, d.quote_start NULLS LAST, d.id", (project_id,))
    ls = _q("SELECT l.id, l.decision_id, l.target_type, l.target_ref, l.relation, l.state FROM decision_links l "
            "JOIN decisions d ON d.id=l.decision_id WHERE d.project_id=%s AND d.deleted_at IS NULL AND l.state<>'rejected' AND "
            + private_clause("d.meeting_id") + " ORDER BY l.id", (project_id,))
    by = {}
    for l in ls:
        by.setdefault(l["decision_id"], []).append(l)
    import speaker_map as _sm
    ds = _sm.attribute(ds, _sm.confirmed_map([d["meeting_id"] for d in ds]))
    return [dict({k: _iso(v) for k, v in d.items()}, links=by.get(d["id"], [])) for d in ds]
