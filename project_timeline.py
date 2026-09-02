"""
project_timeline.py — build a newest-first update timeline for a project board card.

Pure and unit-tested (test_project_timeline.py). Merges DB updates with a project's
hardcoded media-rich inline update and:
  - orders newest-first (Africa/Nairobi, end-of-day for date-only hardcoded rows);
  - PINS the hardcoded update — it is never evicted by the cap, so media-rich one-off
    updates (washing_bay/sheep/dairy photos) never vanish from the board;
  - marks as SUPERSEDED only TEXT-ONLY older updates whose action-refs (KIM/xx/xx-x) are
    all already covered by a newer update. Media-bearing reports and the pinned hardcoded
    update are never hidden — a mere ref mention is not a replacement.
Never mutates the caller's dicts.
"""

import re
from datetime import datetime, timezone, timedelta

_ACTION_REF = re.compile(r"KIM/\d+/\d+-\d+")
_EAT = timezone(timedelta(hours=3))   # Africa/Nairobi, no DST


def parse_hardcoded_date(s):
    try:
        return datetime.strptime((s or "").strip(), "%d %b %Y").date()
    except Exception:
        return None


def _media_count(u):
    return len(u.get("images") or []) + len(u.get("videos") or [])


def _sort_key(u):
    ca = u.get("created_at")
    if ca is not None and hasattr(ca, "timestamp"):
        return ca.timestamp()
    d = parse_hardcoded_date(u.get("date", ""))
    return datetime(d.year, d.month, d.day, 23, 59, tzinfo=_EAT).timestamp() if d else 0.0


def build_timeline(db_rows, hardcoded_update, limit=6):
    """db_rows: newest-first list of a project's update dicts (already per-project, capped).
    hardcoded_update: the project's inline update dict, or None.
    Returns a newest-first list (len <= limit), each carrying a bool 'superseded', always
    including the hardcoded update (if distinct) as a pinned row."""
    rows = [{**r} for r in (db_rows or [])]        # copy dicts — never mutate aliased state
    synthetic = None
    if hardcoded_update:
        hc_text = (hardcoded_update.get("text") or "").strip()
        dup = next((r for r in rows if (r.get("text") or "").strip() == hc_text), None)
        if dup is not None:
            # same update present in both — keep the richer media, never downgrade
            if _media_count(hardcoded_update) > _media_count(dup):
                dup["images"] = list(hardcoded_update.get("images") or [])
                dup["videos"] = list(hardcoded_update.get("videos") or [])
        else:
            synthetic = {**hardcoded_update, "id": None, "_pinned": True}

    if synthetic is not None:
        rows = rows[:max(0, limit - 1)]            # reserve a slot so the pin always survives
        rows.append(synthetic)
    else:
        rows = rows[:limit]
    rows.sort(key=_sort_key, reverse=True)

    seen_refs = set()
    for u in rows:                                 # newest-first
        refs = set(_ACTION_REF.findall(u.get("text") or ""))
        u["superseded"] = (bool(refs) and refs.issubset(seen_refs)
                           and _media_count(u) == 0 and not u.get("_pinned"))
        seen_refs |= refs
    for u in rows:
        u.pop("_pinned", None)                     # internal marker, not part of the contract
    return rows
