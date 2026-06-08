"""
Shared family/member lookup from PostgreSQL.
Single source of truth: persons + families tables.
All modules that need family → member or member → family mappings import from here.
"""
import os, functools
import psycopg2, psycopg2.extras

_DB_URL = None

def _db():
    global _DB_URL
    if not _DB_URL:
        _DB_URL = os.environ.get("DATABASE_URL", "")
    conn = psycopg2.connect(_DB_URL)
    conn.autocommit = True
    return conn

@functools.lru_cache(maxsize=1)
def _load():
    """
    Returns (family_to_members, member_to_family) dicts.
    family_to_members: {"ARINDAS": ["Hillary", "Esther"], ...}
    member_to_family:  {"Hillary": "ARINDAS", ...}
    Cached for the process lifetime (scheduler reload clears cache on restart).
    """
    try:
        conn = _db()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT f.family_name, p.whatsapp_name
            FROM persons p
            JOIN families f ON f.id = p.family_id
            WHERE p.whatsapp_name IS NOT NULL
            ORDER BY f.family_name, p.id
        """)
        rows = cur.fetchall()
        conn.close()
    except Exception as e:
        # Fallback: return empty dicts rather than crashing
        import logging
        logging.getLogger(__name__).warning("family_db load failed: %s", e)
        return {}, {}

    family_to_members: dict[str, list[str]] = {}
    member_to_family: dict[str, str] = {}
    for r in rows:
        fam = r["family_name"].upper()
        name = r["whatsapp_name"]
        family_to_members.setdefault(fam, []).append(name)
        member_to_family[name] = fam

    return family_to_members, member_to_family


def family_members(family_name: str) -> list[str]:
    """Return list of whatsapp_name for a family. Empty list if not found."""
    f2m, _ = _load()
    return f2m.get(family_name.upper(), [])


def member_family(member_name: str) -> str | None:
    """Return the family_name for a member, or None."""
    _, m2f = _load()
    return m2f.get(member_name)


def all_families() -> dict[str, list[str]]:
    """Return full family → members mapping."""
    f2m, _ = _load()
    return f2m


def parse_responsible(responsible: str, all_members_sentinel="__ALL_MEMBERS__"):
    """
    Parse an Action Tracker 'Responsible' field into a list of member names.
    Returns all_members_sentinel if responsible is 'All Members'.
    Returns list of member names for family names (e.g. 'Arungas') or individual names.
    """
    if not responsible:
        return []
    s = responsible.strip()
    if s.lower() in ("all members", "all", "everyone"):
        return all_members_sentinel

    import re
    _NAME_NORM = {
        "dad": "Israel", "mum": "Merab", "hellen": "Hellen", "hillary": "Hillary",
        "alex": "Alex", "simon": "Simon", "esther": "Esther", "janet": "Janet",
        "lawi": "Lawi", "max": "Max", "priscilla": "Priscilla",
        "solomon": "Solomon", "viola": "Viola", "israel": "Israel",
    }
    f2m, _ = _load()
    # Normalise family names for lookup: strip trailing 's' for plural forms
    fam_lookup = {k.lower(): v for k, v in f2m.items()}
    fam_lookup.update({k.lower().rstrip("s"): v for k, v in f2m.items()})

    # Check if entire value is a family name
    if s.lower() in fam_lookup:
        return fam_lookup[s.lower()]
    if s.lower().rstrip("s") in fam_lookup:
        return fam_lookup[s.lower().rstrip("s")]

    parts = re.split(r"[/,]|\band\b", s)
    result = []
    for p in parts:
        token = p.strip().lower()
        norm = _NAME_NORM.get(token)
        if norm and norm not in result:
            result.append(norm); continue
        fam = fam_lookup.get(token) or fam_lookup.get(token.rstrip("s"))
        if fam:
            result.extend(m for m in fam if m not in result)
    return result
