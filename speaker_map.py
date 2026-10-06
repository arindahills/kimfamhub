"""
speaker_map.py - map diarized labels (Speaker 1, Speaker 2 ...) to members, per meeting (ADR-034 amendment, issue #106).

Pure part first (no database, no network): split_sources, turns_of, align, addressed_names, suggest.
Then the app-owned storage (meeting_speakers, speaker_map_log) and the helpers the routes and scripts use.

Rules enforced here:
  1. Identity is NEVER inferred from the logged-in account, the IP or the device: some members share a device and one
     login. The only evidence is the transcript itself (a pasted named transcript aligned with the diarized audio) and
     a person present at the meeting who confirms.
  2. A pasted named transcript is corroboration, not proof: a display name comes from the account that joined the call,
     so one name can cover several voices. A name that aligns with two or more labels is state 'shared'.
  3. suggest() and the CLIs never produce 'confirmed'. Only confirm_label() does, called from the PUT route.
  4. A proposal may only name an attendee of that meeting when attendance is known.
"""
import re

from decision_trace import chunk_transcript

_LOCK_KEY = 778815
_READY = False

STATES = ("suggested", "confirmed", "shared", "unknown")
CONFIRM_STATES = ("confirmed", "shared", "unknown")      # what a person may set
MIN_TOKENS = 5            # a turn shorter than this proves nothing in an alignment
MATCH_THRESHOLD = 0.6     # token-set overlap (against the shorter turn) for two turns to be the same utterance
MIN_RATIO = 0.3           # and against the longer turn, so a short turn does not match inside a long one
POSITION_SLACK = 0.3      # relative position in the transcript may differ by this much ("roughly monotonic")
BACK_SLACK = 5            # a later diarized turn may match at most this many named turns before the last match
MIN_ALIGNED = 3           # evidence floor: aligned turns for a label before anything is proposed
MIN_AGREE = 0.6           # and the top name must cover this share of them
MIN_SHARE = 2             # a name aligned this often with a second label makes both labels 'shared'
LINE_MIN_TOKENS = 6       # second pass: a named line must carry this many words to count as a vote
LINE_CONTAIN = 0.8        # and this share of them must sit inside the diarized turn
LINE_POS_WINDOW = 0.08    # and sit at about the same relative place in the meeting
SAMPLE_LINES = 3
SAMPLE_CHARS = 120

_MARKER = re.compile(r"^\[SOURCE:[ \t]*(?P<label>[^\]\n]*)\][ \t]*\r?$", re.M)
_SPEAKER_N = re.compile(r"^Speaker[ _]*\d+$", re.I)
_LABEL_PREFIX = re.compile(r"^(?:\[[^\]\n]{1,40}\]\s*:?\s*|[A-Z][A-Za-z.'-]*(?: [A-Za-z.'-]+){0,2}:[ \t]+)")
_WORD = re.compile(r"[a-z0-9']+")


# ── sources ────────────────────────────────────────────────────────────────────────────────────
def _kind_of_label(label):
    l = (label or "").strip().lower()
    if l.startswith("audio"):
        return "diarized"
    if l.startswith("pasted text") or l.startswith("file:"):
        return "named"
    return "other"


def _infer_kind(text):
    labels = {t["speaker"] for t in chunk_transcript(text) if t["speaker"]}
    if not labels:
        return "other"
    if all(_SPEAKER_N.match(l) for l in labels):
        return "diarized"
    return "named" if any(not _SPEAKER_N.match(l) for l in labels) else "other"


def split_sources(transcript):
    """Split a stored transcript on its [SOURCE: label] markers -> [{'label','kind','text','start','end'}] where
    text == transcript[start:end], so every offset maps back to the stored text. kind is 'diarized' (label starts
    with Audio), 'named' (pasted text or a file) or 'other'. With no markers the whole text is one part whose kind is
    inferred from its turn labels."""
    transcript = transcript or ""
    marks = list(_MARKER.finditer(transcript))
    if not marks:
        if not transcript.strip():
            return []
        return [{"label": "", "kind": _infer_kind(transcript), "text": transcript, "start": 0, "end": len(transcript)}]
    parts = []
    head = transcript[:marks[0].start()]
    if head.strip():
        parts.append({"label": "", "kind": _infer_kind(head), "text": head, "start": 0, "end": len(head)})
    for i, m in enumerate(marks):
        start = m.end()
        if transcript[start:start + 1] == "\n":
            start += 1
        end = marks[i + 1].start() if i + 1 < len(marks) else len(transcript)
        label = m.group("label").strip()
        kind = _kind_of_label(label)
        if kind == "other":
            kind = _infer_kind(transcript[start:end]) if label == "" else "other"
        parts.append({"label": label, "kind": kind, "text": transcript[start:end], "start": start, "end": end})
    return parts


_NAME_PUNCT = re.compile(r"[.,?!:;()\"\[\]{}]")
_NOT_NAMES = {"callout", "action items", "action item", "summary", "key points", "transcript", "notes"}
_NOT_FIRST = {"thanks", "thank", "hello", "hi", "hey", "good", "okay", "ok", "yes", "no", "please", "welcome", "sorry", "well", "so"}
NAME_MIN_COUNT = 3        # a display name line recurs: once per turn the person takes


def _member_names():
    try:
        import auth
        return [x["name"] for x in auth.MEMBERS]
    except Exception:
        return []


def tactiq_names(text, members=None):
    """Display names in a Tactiq style export, where each turn is the speaker's name on a line of its own followed by
    what was said on the lines below. A line is a name when it recurs, is short and punctuation free, and is either
    Title Case or UPPER CASE over two to four words, or matches a member's name. Pure apart from the member list."""
    members = _member_names() if members is None else members
    counts = {}
    for line in (text or "").split("\n"):
        l = " ".join(line.split())
        if l and len(l) <= 40 and not _NAME_PUNCT.search(l):
            counts[l] = counts.get(l, 0) + 1
    names = set()
    for l, n in counts.items():
        if n < NAME_MIN_COUNT or l.lower() in _NOT_NAMES:
            continue
        toks = l.split()
        if len(toks) > 4 or toks[0].lower() in _NOT_FIRST:
            continue
        titled = len(toks) >= 2 and all(t[0].isupper() for t in toks)
        # a member's name is the FIRST word (a display name such as "<member> <surname>"); a phrase that merely
        # mentions a member ("Thanks <member>") is speech, not a name line
        first_is_member = any(m.strip().lower() == toks[0].lower() for m in members or [])
        if titled or first_is_member:
            names.add(l)
    return names


def tactiq_turns(part, members=None, per_line=False):
    """Turns of a Tactiq style part: one turn per name line, its text the lines below until the next name line.
    Offsets index the STORED transcript; text lines before the first name are not attributed to anyone."""
    names = tactiq_names(part["text"], members)
    out, cur, pos = [], None, 0
    for raw in part["text"].split("\n"):
        start, end = part["start"] + pos, part["start"] + pos + len(raw)
        pos += len(raw) + 1
        line = " ".join(raw.split())
        if not line:
            continue
        if line in names:
            cur = {"speaker": line, "text": "", "start": end, "end": end}
            out.append(cur)
        elif cur is not None:
            if per_line:
                out.append({"speaker": cur["speaker"], "text": line, "start": start, "end": end})
            else:
                cur["text"] = (cur["text"] + " " + line).strip()
                cur["end"] = end
    return [t for t in out if t["text"]]


def turns_of(part, members=None, per_line=False):
    """The labelled turns of one part: [{'speaker','text','start','end'}], offsets into the STORED transcript."""
    out = []
    for t in chunk_transcript(part["text"]):
        out.append({"speaker": t["speaker"], "text": t["text"], "start": part["start"] + t["start"],
                    "end": part["start"] + t["end"]})
    if part.get("kind") == "named" and not any(t["speaker"] for t in out):
        tq = tactiq_turns(part, members, per_line)
        if tq:
            return tq
    return out


def _with_pos(part, turns):
    """Add 'pos', the turn's relative place in its own part (0 to 1), so two sources of different granularity can be lined up."""
    n = max(len(part["text"]), 1)
    return [dict(t, pos=(t["start"] - part["start"]) / n) for t in turns]


def _tokens(text):
    body = _LABEL_PREFIX.sub("", text or "", count=1)
    return set(_WORD.findall(body.lower()))


# ── alignment ──────────────────────────────────────────────────────────────────────────────────
def align(diarized_turns, named_turns):
    """Match each diarized turn with at most one named turn by token-set overlap and rough position; one named turn
    matches at most one diarized turn. Turns are dicts with 'speaker' and 'text'. Returns
    {'counts': {label: {name: n}}, 'compared': {label: eligible turns}, 'matched': {label: aligned turns},
     'total': eligible diarized turns, 'top': {label: {'name','agree','total'}}}."""
    d_tok = [_tokens(t.get("text")) for t in diarized_turns]
    n_tok = [_tokens(t.get("text")) for t in named_turns]
    nd, nn = max(len(diarized_turns), 1), max(len(named_turns), 1)
    used, counts, compared, matched = set(), {}, {}, {}
    last = 0
    for i, dt in enumerate(diarized_turns):
        label = dt.get("speaker")
        if not label or len(d_tok[i]) < MIN_TOKENS:
            continue
        compared[label] = compared.get(label, 0) + 1
        best, best_j = 0.0, None
        for j, nt in enumerate(named_turns):
            if j in used or not nt.get("speaker") or len(n_tok[j]) < MIN_TOKENS:
                continue
            if j < last - BACK_SLACK or abs(j / nn - i / nd) > POSITION_SLACK:
                continue
            inter = len(d_tok[i] & n_tok[j])
            small, big = min(len(d_tok[i]), len(n_tok[j])), max(len(d_tok[i]), len(n_tok[j]))
            if inter / small < MATCH_THRESHOLD or inter / big < MIN_RATIO:
                continue
            score = inter / len(d_tok[i] | n_tok[j])
            if score > best:
                best, best_j = score, j
        if best_j is not None:
            used.add(best_j)
            last = best_j
            name = named_turns[best_j]["speaker"].strip()
            counts.setdefault(label, {})
            counts[label][name] = counts[label].get(name, 0) + 1
            matched[label] = matched.get(label, 0) + 1
        elif dt.get("pos") is not None:
            # a long diarized turn that holds several short named lines: each fully contained line is one vote
            for j, nt in enumerate(named_turns):
                if j in used or not nt.get("speaker") or nt.get("pos") is None or len(n_tok[j]) < LINE_MIN_TOKENS:
                    continue
                if abs(nt["pos"] - dt["pos"]) > LINE_POS_WINDOW or len(n_tok[j]) > len(d_tok[i]):
                    continue
                if len(d_tok[i] & n_tok[j]) / len(n_tok[j]) >= LINE_CONTAIN:
                    used.add(j)
                    name = nt["speaker"].strip()
                    counts.setdefault(label, {})
                    counts[label][name] = counts[label].get(name, 0) + 1
                    matched[label] = matched.get(label, 0) + 1
    top = {}
    for label, c in counts.items():
        name, n = max(c.items(), key=lambda kv: (kv[1], kv[0]))
        top[label] = {"name": name, "agree": n, "total": matched[label]}
    return {"counts": counts, "compared": compared, "matched": matched, "total": sum(compared.values()), "top": top}


# ── names addressed in the reply turn ──────────────────────────────────────────────────────────
def addressed_names(turns, names):
    """Names directly addressed in the turn before or after a label's turns: 'Name,' or 'Hello Name' style, whole word,
    never the label's own text. -> {label: [name, ...]} (a hint shown to the reviewer, never a decision)."""
    names = [n for n in dict.fromkeys(names or []) if n]
    out = {}
    for i, t in enumerate(turns):
        label = t.get("speaker")
        if not label:
            continue
        for k in (i - 1, i + 1):
            if not (0 <= k < len(turns)) or turns[k].get("speaker") == label:
                continue
            body = _LABEL_PREFIX.sub("", turns[k].get("text") or "", count=1)
            for n in names:
                if re.search(r"(?:^|[\s,.!?])%s\b\s*[,!?]|(?:^|\b)(?:thanks|thank you|hello|hi|hey|ok|okay|yes)[ ,]+%s\b"
                             % (re.escape(n), re.escape(n)), body, re.I):
                    lst = out.setdefault(label, [])
                    if n not in lst:
                        lst.append(n)
    return out


# ── proposals ──────────────────────────────────────────────────────────────────────────────────
def _canonical(name, pool, aliases=None):
    """The member in `pool` a display name refers to: a recorded alias first (a display name that is not the member's own
    name, set by a person), then exact, then a whole-word match of the member's name. Else None."""
    low = (name or "").strip().lower()
    if not low:
        return None
    if aliases and low in aliases:
        return next((m for m in pool if m.strip().lower() == str(aliases[low]).strip().lower()), None)
    for m in pool:
        if m.strip().lower() == low:
            return m
    words = set(_WORD.findall(low))
    hits = [m for m in pool if m.strip() and set(_WORD.findall(m.lower())) <= words]
    return hits[0] if len(hits) == 1 else None


def _short(line):
    return " ".join((line or "").split())[:SAMPLE_CHARS]


def suggest(labels, alignment, attendees, addressed=None, members=None, samples=None, aliases=None):
    """One proposal per label: {'member': name or None, 'state': 'suggested'|'shared'|'unknown', 'evidence': {...}}.
    `attendees` is the meeting's attendance list (empty = not known); with attendance known only an attendee may be
    proposed, otherwise `members` is the pool. `addressed` is {label: [names]} and `samples` {label: [lines]}.
    A named speaker aligned with two or more labels makes each of them 'shared'. Below the evidence floor: 'unknown'.
    Never returns 'confirmed'."""
    attendees = [a for a in (attendees or []) if a]
    pool = attendees or [m for m in (members or []) if m]
    counts = (alignment or {}).get("counts", {})
    matched = (alignment or {}).get("matched", {})
    covered = {}      # a name is shared when it is the leading name of two or more voices (stray lines do not count)
    for label, c in counts.items():
        if not c:
            continue
        name, n = max(c.items(), key=lambda kv: (kv[1], kv[0]))
        if n >= MIN_SHARE and n / matched[label] >= MIN_AGREE:
            covered.setdefault(name, set()).add(label)
    out = {}
    for label in labels:
        c = counts.get(label, {})
        total = matched.get(label, 0)
        ev = {"aligned": dict(sorted(c.items(), key=lambda kv: -kv[1])), "total": total,
              "compared": (alignment or {}).get("compared", {}).get(label, 0), "agree": 0, "name": None, "text": "",
              "samples": [_short(s) for s in (samples or {}).get(label, [])[:SAMPLE_LINES]],
              "addressed": list((addressed or {}).get(label, []))}
        prop = {"member": None, "state": "unknown", "evidence": ev}
        out[label] = prop
        if not c or total < MIN_ALIGNED:
            ev["text"] = "Not enough overlapping lines with a named transcript to suggest anyone"
            continue
        name, n = max(c.items(), key=lambda kv: (kv[1], kv[0]))
        ev.update(agree=n, name=name, text="%d of %d overlapping lines say %s" % (n, total, name))
        if n / total < MIN_AGREE:
            ev["text"] += " (too mixed to suggest anyone)"
            continue
        if len(covered.get(name, ())) >= 2:
            prop["state"] = "shared"
            ev["text"] += "; the same name also covers %d other voice(s), so this is a shared name or device" % (len(covered[name]) - 1)
            continue
        member = _canonical(name, pool, aliases) if pool else None
        if not member:
            ev["text"] += "; that name is not on this meeting's %s" % ("attendance list" if attendees else "member list")
            continue
        prop.update(member=member, state="suggested")
    return out


# ── storage (app-owned tables, created under an advisory lock like decision_trace.ready()) ─────
_DDL = [
    """CREATE TABLE IF NOT EXISTS meeting_speakers (
        id SERIAL PRIMARY KEY, meeting_id INTEGER NOT NULL, label TEXT NOT NULL, member TEXT,
        state TEXT NOT NULL DEFAULT 'unknown' CHECK (state IN ('suggested','confirmed','shared','unknown')),
        evidence JSONB, suggested_by TEXT CHECK (suggested_by IN ('tactiq','claude','rules')),
        confirmed_by TEXT, confirmed_at TIMESTAMPTZ, note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (meeting_id, label))""",
    """CREATE TABLE IF NOT EXISTS speaker_aliases (
        display_name TEXT PRIMARY KEY, member TEXT NOT NULL, added_by TEXT, added_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
    """CREATE TABLE IF NOT EXISTS speaker_map_log (
        id SERIAL PRIMARY KEY, meeting_id INTEGER NOT NULL, label TEXT NOT NULL, old_state TEXT, old_member TEXT,
        new_state TEXT, new_member TEXT, changed_by TEXT, note TEXT, changed_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
]


def ready():
    """Create the tables once per process under an advisory lock. Never raises; returns whether usable."""
    global _READY
    if _READY:
        return True
    try:
        import decision_trace as dt
        if not dt.ready():
            return False
        from db import db as _db
        with _db() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_KEY,))
                for ddl in _DDL:
                    cur.execute(ddl)
        _READY = True
    except Exception as _e:
        import logging
        logging.getLogger("uvicorn.error").warning("speaker map tables unavailable: %s", _e)
        return False
    return _READY


def attendees_of(attendance):
    """Present members from a meetings.attendance value (dict or JSON string of {member: {status}}). [] = not known."""
    import json
    if isinstance(attendance, (str, bytes, bytearray)):
        try:
            attendance = json.loads(attendance)
        except ValueError:
            return []
    if not isinstance(attendance, dict):
        return []
    return [m for m, e in attendance.items()
            if isinstance(e, dict) and str(e.get("status") or "").strip().lower() in ("present", "attended", "here")]


def load_aliases():
    """{display name (lower case): member} recorded by a person. Reads only; {} when unavailable."""
    try:
        from db import query as _q
        return {r["display_name"].strip().lower(): r["member"] for r in _q("SELECT display_name, member FROM speaker_aliases")}
    except Exception:
        return {}


def set_alias(display_name, member, who):
    """Record that a display name (as it appears in a pasted transcript) is this member. Never used for a shared
    login: do not alias a club or family account name. Written through db()."""
    name = " ".join((display_name or "").split())
    if not name or not (member or "").strip():
        raise ValueError("alias")
    from db import db as _db
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO speaker_aliases (display_name, member, added_by) VALUES (%s,%s,%s) "
                        "ON CONFLICT (display_name) DO UPDATE SET member=EXCLUDED.member, added_by=EXCLUDED.added_by, added_at=now()",
                        (name.lower(), member.strip(), who))
    return {"display_name": name.lower(), "member": member.strip()}


def proposals_for_transcript(transcript, attendees=(), members=(), aliases=None):
    """Everything suggest() needs, from one stored transcript. -> {label: proposal}; [] sources give {}."""
    parts = split_sources(transcript)
    dia = [t for p in parts if p["kind"] == "diarized" for t in _with_pos(p, turns_of(p))]
    named = [t for p in parts if p["kind"] == "named" for t in _with_pos(p, turns_of(p, per_line=True))]
    labels = list(dict.fromkeys(t["speaker"] for t in dia if t["speaker"]))
    if not labels:
        return {}
    samples = {}
    for t in dia:
        if t["speaker"] and len(samples.setdefault(t["speaker"], [])) < SAMPLE_LINES and len(_tokens(t["text"])) >= MIN_TOKENS:
            samples[t["speaker"]].append(_LABEL_PREFIX.sub("", t["text"], count=1))
    pool = list(attendees) or list(members)
    names = pool + [n for n in {t["speaker"] for t in named if t["speaker"]}]
    if aliases is None:
        aliases = load_aliases()
    return suggest(labels, align(dia, named), list(attendees), addressed_names(dia + [], names), list(members), samples, aliases)


def _meeting(meeting_id):
    from db import query as _q
    import decision_trace as dt
    rows = _q("SELECT id, ref, date, transcript, attendance FROM meetings m WHERE m.id=%s AND " + dt.private_clause("m.id"), (meeting_id,))
    return rows[0] if rows else None


def _labels_of(transcript):
    """-> (diarized labels, named labels) present in the stored transcript. Pure."""
    dia, named = set(), set()
    for p in split_sources(transcript or ""):
        for t in turns_of(p):
            if t["speaker"]:
                (dia if p["kind"] == "diarized" else named).add(t["speaker"])
    return dia, named


def store_suggestions(meeting_id, members=None, who="rules"):
    """Recompute and store suggestions for one non-private meeting. NEVER overwrites a confirmed row (nor a row a
    person set to shared or unknown), never writes 'confirmed'. -> {'status','labels','written'}."""
    if not ready():
        return {"status": "unavailable", "labels": 0, "written": 0}
    m = _meeting(meeting_id)
    if not m:
        return {"status": "missing", "labels": 0, "written": 0}
    if members is None:
        import auth
        members = [x["name"] for x in auth.MEMBERS]
    props = proposals_for_transcript(m.get("transcript") or "", attendees_of(m.get("attendance")), members)
    from db import db as _db
    from psycopg2.extras import Json
    n = 0
    with _db() as conn:
        with conn.cursor() as cur:
            for label, p in props.items():
                cur.execute(
                    "INSERT INTO meeting_speakers (meeting_id, label, member, state, evidence, suggested_by) VALUES (%s,%s,%s,%s,%s,%s) "
                    "ON CONFLICT (meeting_id, label) DO UPDATE SET member=EXCLUDED.member, state=EXCLUDED.state, "
                    "evidence=EXCLUDED.evidence, suggested_by=EXCLUDED.suggested_by, updated_at=now() "
                    "WHERE meeting_speakers.confirmed_by IS NULL AND meeting_speakers.state IN ('suggested','unknown')",
                    (meeting_id, label, p["member"], p["state"], Json(p["evidence"]),
                     "tactiq" if (p["evidence"].get("total") or 0) > 0 else who))
                n += cur.rowcount
            # a label that vanished (audio re-processed) must not linger as a live suggestion
            cur.execute("DELETE FROM meeting_speakers WHERE meeting_id=%s AND confirmed_by IS NULL AND NOT (label = ANY(%s))",
                        (meeting_id, list(props)))
    return {"status": "ok", "labels": len(props), "written": n}


def confirm_label(meeting_id, label, member, state, who, note=None):
    """A person sets a label: state confirmed (needs a member who attended when attendance is known), shared or
    unknown (member cleared). The old value goes to speaker_map_log. -> the row. Raises ValueError('member'|'state'|
    'label'|'meeting')."""
    if state not in CONFIRM_STATES:
        raise ValueError("state")
    m = _meeting(meeting_id)
    if not m:
        raise ValueError("meeting")
    dia, named = _labels_of(m.get("transcript"))
    if label not in dia | named:
        raise ValueError("label")
    member = (member or "").strip() or None
    if state == "confirmed":
        att = attendees_of(m.get("attendance"))
        import auth
        pool = att or [x["name"] for x in auth.MEMBERS]
        member = next((p for p in pool if p.lower() == (member or "").lower()), None)
        if not member:
            raise ValueError("member")
    else:
        member = None
    from db import db as _db
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT state, member FROM meeting_speakers WHERE meeting_id=%s AND label=%s FOR UPDATE", (meeting_id, label))
            old = cur.fetchone()
            cur.execute(
                "INSERT INTO meeting_speakers (meeting_id, label, member, state, confirmed_by, confirmed_at, note) "
                "VALUES (%s,%s,%s,%s,%s,now(),%s) ON CONFLICT (meeting_id, label) DO UPDATE SET member=EXCLUDED.member, "
                "state=EXCLUDED.state, confirmed_by=EXCLUDED.confirmed_by, confirmed_at=now(), note=EXCLUDED.note, updated_at=now()",
                (meeting_id, label, member, state, who, note))
            cur.execute("INSERT INTO speaker_map_log (meeting_id, label, old_state, old_member, new_state, new_member, changed_by, note) "
                        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                        (meeting_id, label, old[0] if old else None, old[1] if old else None, state, member, who, note))
    return {"meeting_id": meeting_id, "label": label, "member": member, "state": state, "confirmed_by": who, "note": note}


def speakers_view(meeting_id):
    """The review payload for one meeting: labels with state, member, evidence (with sample lines) and attendance.
    None for a missing or private meeting."""
    m = _meeting(meeting_id)
    if not m:
        return None
    from db import query as _q
    props = proposals_for_transcript(m.get("transcript") or "", attendees_of(m.get("attendance")), [])
    saved = {r["label"]: r for r in _q("SELECT * FROM meeting_speakers WHERE meeting_id=%s", (meeting_id,))}
    labels = []
    _dia, named = _labels_of(m.get("transcript"))
    import auth
    members = [x["name"] for x in auth.MEMBERS]
    for label, live in props.items():
        row = saved.get(label)
        ev = (row["evidence"] if row and row["evidence"] else live["evidence"])
        ev = dict(ev, samples=live["evidence"]["samples"], addressed=live["evidence"]["addressed"])
        labels.append({"label": label, "state": row["state"] if row else "unknown", "member": row["member"] if row else None,
                       "confirmed_by": row["confirmed_by"] if row else None,
                       "confirmed_at": row["confirmed_at"].isoformat() if row and row["confirmed_at"] else None,
                       "note": row["note"] if row else None, "evidence": ev})
    for label in sorted(named - set(props)):
        row = saved.get(label)
        labels.append({"label": label, "state": row["state"] if row else "unknown", "member": row["member"] if row else None,
                       "confirmed_by": row["confirmed_by"] if row else None,
                       "confirmed_at": row["confirmed_at"].isoformat() if row and row["confirmed_at"] else None,
                       "note": row["note"] if row else None,
                       "evidence": {"text": "Name taken from a pasted transcript. Not proof of who spoke: a shared device or login shows one name for several people.",
                                    "samples": [], "addressed": [], "agree": 0, "total": 0, "name": label}})
    att = attendees_of(m.get("attendance"))
    return {"meeting_id": meeting_id, "ref": m["ref"], "date": str(m["date"]) if m["date"] else None,
            "attendees": att, "pool": att or members, "labels": labels}


def confirmed_map(meeting_ids):
    """{(meeting_id, label): {'state','member'}} for the given meetings (reads only)."""
    ids = sorted({i for i in meeting_ids if i is not None})
    if not ids:
        return {}
    from db import query as _q
    try:
        rows = _q("SELECT meeting_id, label, state, member FROM meeting_speakers WHERE meeting_id = ANY(%s) AND state IN ('confirmed','shared')", (ids,))
    except Exception:
        return {}
    return {(r["meeting_id"], r["label"]): {"state": r["state"], "member": r["member"] if r["state"] == "confirmed" else None} for r in rows}


def attribute(rows, mapping):
    """Pure. Adds speaker_label, speaker (the CONFIRMED member or None), attribution (confirmed|shared|unattributed)
    and shared to each decision row dict, from `mapping` ({(meeting_id, label): {...}}). An unconfirmed label never
    resolves to a member; a shared label never names a person."""
    out = []
    for r in rows:
        label = r.get("speaker_label") or None
        hit = mapping.get((r.get("meeting_id"), label)) if label else None
        member = hit["member"] if hit and hit["state"] == "confirmed" and hit["member"] else None
        att = "confirmed" if member else ("shared" if hit and hit["state"] == "shared" else "unattributed")
        out.append(dict(r, speaker_label=label, speaker=member, attribution=att, shared=att == "shared",
                        unattributed=att != "confirmed"))
    return out


# ── backfills (idempotent; neither ever confirms) ──────────────────────────────────────────────
def label_for_offset(transcript, offset):
    """The raw label of the turn holding `offset` in the stored transcript, or None. Pure."""
    if not transcript or offset is None or not (0 <= offset < len(transcript)):
        return None
    for p in split_sources(transcript):
        if p["start"] <= offset < p["end"]:
            t = next((t for t in turns_of(p) if t["start"] <= offset < t["end"]), None)
            return t["speaker"] if t and t["speaker"] else None
    return None


def backfill_decision_labels():
    """Set decisions.speaker_label from the quote_start turn where it is NULL. Safe to re-run. -> {'checked','set'}."""
    if not ready():
        return {"checked": 0, "set": 0}
    import decision_trace as dt
    from db import query as _q, execute as _x
    rows = _q("SELECT d.id, d.quote_start, m.transcript FROM decisions d JOIN meetings m ON m.id=d.meeting_id "
              "WHERE d.speaker_label IS NULL AND d.quote_start IS NOT NULL AND d.deleted_at IS NULL AND " + dt.private_clause("d.meeting_id"))
    n = 0
    for r in rows:
        label = label_for_offset(r["transcript"], r["quote_start"])
        if label:
            _x("UPDATE decisions SET speaker_label=%s WHERE id=%s AND speaker_label IS NULL", (label, r["id"]))
            n += 1
    return {"checked": len(rows), "set": n}


def backfill_suggestions():
    """Create suggested map rows for every non-private meeting with a transcript. Safe to re-run; never confirms and
    never touches a row a person has set. -> {'meetings','labels','written'}."""
    if not ready():
        return {"meetings": 0, "labels": 0, "written": 0}
    import decision_trace as dt
    from db import query as _q
    ids = [r["id"] for r in _q("SELECT m.id FROM meetings m WHERE m.transcript IS NOT NULL AND m.transcript<>'' AND " + dt.private_clause("m.id") + " ORDER BY m.id")]
    tot = {"meetings": 0, "labels": 0, "written": 0}
    for i in ids:
        r = store_suggestions(i)
        if r["status"] == "ok":
            tot["meetings"] += 1
            tot["labels"] += r["labels"]
            tot["written"] += r["written"]
    return tot
