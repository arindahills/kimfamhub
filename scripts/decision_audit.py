#!/usr/bin/env python3
"""
Phase 0 of the decision trace (docs/specs/decision-trace.md): read-only coverage table per meeting.
Prints counts and fractions only, never any transcript or decision text.

    python3 scripts/decision_audit.py            # run in the app dir, DATABASE_URL set
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from decision_trace import chunk_transcript  # noqa: E402


def labelled_fraction(transcript):
    """Fraction of non-blank lines that start a labelled speaker turn (0.0 when there is no transcript)."""
    lines = [l for l in (transcript or "").splitlines() if l.strip()]
    if not lines:
        return 0.0
    turns = chunk_transcript(transcript)
    starts = {t["start"] for t in turns if t["speaker"]}
    pos, n = 0, 0
    for l in (transcript or "").splitlines(keepends=True):
        if pos in starts and l.strip():
            n += 1
        pos += len(l)
    return n / len(lines)


def has_text(v):
    return bool((v or "").strip()) if isinstance(v, str) else bool(v)


def audit_row(meeting, n_actions, n_chicken):
    t = meeting.get("transcript") or ""
    return {"ref": meeting.get("ref") or "?", "date": str(meeting.get("date") or ""),
            "transcript": "yes" if t.strip() else "no", "labelled": "%.0f%%" % (100 * labelled_fraction(t)),
            "key_decisions": "yes" if has_text(meeting.get("key_decisions")) else "no",
            "actions": n_actions, "chicken_actions": n_chicken,
            "private": "yes" if meeting.get("is_private") else "no"}


COLS = ("ref", "date", "transcript", "labelled", "key_decisions", "actions", "chicken_actions", "private")


def render(rows):
    w = {c: max(len(c), *(len(str(r[c])) for r in rows)) if rows else len(c) for c in COLS}
    out = ["  ".join(c.ljust(w[c]) for c in COLS)]
    out += ["  ".join(str(r[c]).ljust(w[c]) for c in COLS) for r in rows]
    return "\n".join(out)


def main():
    from db import query as q
    try:
        meetings = q("SELECT id, ref, date, transcript, key_decisions, is_private FROM meetings ORDER BY date")
    except Exception:       # is_private is added by decision_trace.ready(); audit must not need it
        meetings = q("SELECT id, ref, date, transcript, key_decisions, FALSE AS is_private FROM meetings ORDER BY date")
    counts = {r["meeting_id"]: (r["n"], r["c"]) for r in q(
        "SELECT meeting_id, count(*) AS n, count(*) FILTER (WHERE project_id='chicken') AS c "
        "FROM actions GROUP BY meeting_id")}
    rows = [audit_row(m, *counts.get(m["id"], (0, 0))) for m in meetings]
    print(render(rows))
    print("\nmeetings: %d, with transcript: %d, with speaker labels on over half the lines: %d" % (
        len(rows), sum(r["transcript"] == "yes" for r in rows),
        sum(int(r["labelled"].rstrip("%")) > 50 for r in rows)))


if __name__ == "__main__":
    main()
