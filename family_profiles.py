"""
KimFam Hub — Family Profiles
DB operations for the 7 family groups and their children.
"""
import json
import os
import sqlite3
from pathlib import Path

DB_PATH = os.environ.get("KIMFAM_DB_PATH", "/var/www/kimfamhub/data/kimfam.db")

FAMILY_MEMBER_MAP = {
    'kikangis':   ['Israel', 'Merab'],
    'tuhimbises': ['Alex', 'Priscilla'],
    'turamyes':   ['Max', 'Janet'],
    'arungas':    ['Viola', 'Simon'],
    'arihos':     ['Solomon'],
    'arindas':    ['Hillary', 'Esther'],
    'kofunas':    ['Hellen', 'Lawi'],
}

SEED_DATA = [
    {
        "family_id": "kikangis",
        "family_name": "The Kikangis",
        "parents": [
            {"name": "Israel Kikangi", "birthday": "7 Aug 1954", "role": "Father"},
            {"name": "Merab Kikangi", "birthday": "8 Aug 1964", "role": "Mother"},
        ],
        "children": [
            {"name": "Alex Tuhimbise", "birthday": "26 Jan 1983", "adopted": False, "on_obligations": True},
            {"name": "Max Turamye", "birthday": "16 Aug 1984", "adopted": False, "on_obligations": True},
            {"name": "Viola Arunga", "birthday": "4 Nov 1986", "adopted": False, "on_obligations": True},
            {"name": "Solomon Ariho", "birthday": "14 Nov 1988", "adopted": False, "on_obligations": True},
            {"name": "Hillary Arinda", "birthday": "10 Oct 1990", "adopted": False, "on_obligations": True},
            {"name": "Hellen Kofuna", "birthday": "2 Oct 1992", "adopted": False, "on_obligations": True},
        ],
        "note": "Israel and Merab are the founders. These are their six children, all KimFam members."
    },
    {
        "family_id": "tuhimbises",
        "family_name": "The Tuhimbises",
        "parents": [
            {"name": "Alex Tuhimbise", "birthday": "26 Jan 1983", "role": "Father"},
            {"name": "Priscilla Tuhimbise", "birthday": "2 Feb", "role": "Mother"},
        ],
        "children": [
            {"name": "Alexa", "birthday": "19 Jun", "adopted": False, "on_obligations": True},
            {"name": "Alicia", "birthday": "21 Jan", "adopted": False, "on_obligations": True},
            {"name": "Elijah", "birthday": "2 Aug 2020", "adopted": False, "on_obligations": True},
            {"name": "Elsie", "birthday": "", "adopted": False, "on_obligations": True},
            {"name": "Izeal", "birthday": "", "adopted": False, "on_obligations": True},
            {"name": "Faith", "birthday": "", "adopted": True, "on_obligations": False},
        ],
        "note": ""
    },
    {
        "family_id": "turamyes",
        "family_name": "The Turamyes",
        "parents": [
            {"name": "Max Turamye", "birthday": "16 Aug 1984", "role": "Father"},
            {"name": "Janet Turamye", "birthday": "24 Jan", "role": "Mother"},
        ],
        "children": [
            {"name": "Jonathan", "birthday": "", "adopted": False, "on_obligations": True},
            {"name": "Abigail", "birthday": "14 Aug", "adopted": False, "on_obligations": True},
            {"name": "Nikita", "birthday": "11 Nov 2022", "adopted": False, "on_obligations": True},
        ],
        "note": ""
    },
    {
        "family_id": "arungas",
        "family_name": "The Arungas",
        "parents": [
            {"name": "Viola Arunga", "birthday": "4 Nov 1986", "role": "Mother"},
            {"name": "Simon Arunga", "birthday": "3 May", "role": "Father"},
        ],
        "children": [
            {"name": "Arunga Simeon", "birthday": "", "adopted": False, "on_obligations": True},
            {"name": "Arunga Abijah", "birthday": "", "adopted": False, "on_obligations": True},
            {"name": "Sheila", "birthday": "", "adopted": True, "on_obligations": False},
            {"name": "Dennis", "birthday": "", "adopted": True, "on_obligations": False},
        ],
        "note": ""
    },
    {
        "family_id": "arihos",
        "family_name": "The Arihos",
        "parents": [
            {"name": "Solomon Ariho", "birthday": "14 Nov 1988", "role": "Father"},
        ],
        "children": [
            {"name": "Caia", "birthday": "11 Jun", "adopted": False, "on_obligations": True},
        ],
        "note": ""
    },
    {
        "family_id": "arindas",
        "family_name": "The Arindas",
        "parents": [
            {"name": "Hillary Arinda", "birthday": "10 Oct 1990", "role": "Father"},
            {"name": "Esther Arinda", "birthday": "26 Jan 1993", "role": "Mother"},
        ],
        "children": [
            {"name": "Ethan Ahumuza Arinda", "birthday": "29 Oct 2021", "adopted": False, "on_obligations": True},
            {"name": "Hansel Arinda", "birthday": "18 Nov 2022", "adopted": False, "on_obligations": True},
        ],
        "note": ""
    },
    {
        "family_id": "kofunas",
        "family_name": "The Kofunas",
        "parents": [
            {"name": "Hellen Kofuna", "birthday": "2 Oct 1992", "role": "Mother"},
            {"name": "Lawi Kofuna", "birthday": "16 Jul", "role": "Father"},
        ],
        "children": [
            {"name": "Lael Tirzah Kofuna", "birthday": "28 Oct 2022", "adopted": False, "on_obligations": True},
            {"name": "Lainey Tate Kofuna", "birthday": "6 Jan 2026", "adopted": False, "on_obligations": True},
        ],
        "note": ""
    },
]


def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS family_profiles (
            family_id   TEXT PRIMARY KEY,
            family_name TEXT NOT NULL,
            parents     TEXT NOT NULL DEFAULT '[]',
            children    TEXT NOT NULL DEFAULT '[]',
            note        TEXT NOT NULL DEFAULT '',
            updated_at  TEXT,
            updated_by  TEXT
        )
    """)
    conn.commit()
    return conn


def seed_family_profiles():
    with _conn() as conn:
        existing = {r[0] for r in conn.execute("SELECT family_id FROM family_profiles").fetchall()}
        for f in SEED_DATA:
            if f["family_id"] not in existing:
                conn.execute(
                    "INSERT INTO family_profiles (family_id, family_name, parents, children, note) VALUES (?,?,?,?,?)",
                    (f["family_id"], f["family_name"],
                     json.dumps(f["parents"]), json.dumps(f["children"]), f.get("note", ""))
                )
        conn.commit()
    print(f"Family profiles seeded ({len(SEED_DATA)} families)")


def get_all_families() -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT family_id, family_name, parents, children, note, updated_at, updated_by FROM family_profiles ORDER BY rowid"
        ).fetchall()
    return [
        {
            "family_id": r[0],
            "family_name": r[1],
            "parents": json.loads(r[2]),
            "children": json.loads(r[3]),
            "note": r[4],
            "updated_at": r[5],
            "updated_by": r[6],
            "editors": FAMILY_MEMBER_MAP.get(r[0], []),
        }
        for r in rows
    ]


def update_family_children(family_id: str, children: list[dict], updated_by: str) -> bool:
    """Update children list for a family. Caller must verify authorization."""
    with _conn() as conn:
        row = conn.execute("SELECT family_id FROM family_profiles WHERE family_id=?", (family_id,)).fetchone()
        if not row:
            return False
        conn.execute(
            "UPDATE family_profiles SET children=?, updated_at=datetime('now'), updated_by=? WHERE family_id=?",
            (json.dumps(children), updated_by, family_id)
        )
        conn.commit()
    return True


def can_edit(family_id: str, member_name: str) -> bool:
    return member_name in FAMILY_MEMBER_MAP.get(family_id, [])


if __name__ == "__main__":
    seed_family_profiles()
    for f in get_all_families():
        print(f["family_name"], "—", len(f["children"]), "children")
