#!/usr/bin/env python3
"""Import KlaFam historical data from Google Sheet CSV into DB."""

import csv, re, sys, os
from datetime import date

sys.path.insert(0, "/var/www/kimfamhub")
import psycopg2, psycopg2.extras

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://kimfam:Kanyoga%401234@localhost/kimfamhub")
conn = psycopg2.connect(DATABASE_URL)
conn.autocommit = False

def qry(sql, params=None):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params)
        return cur.fetchall()

def exe(sql, params=None):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params)
        try:
            return cur.fetchone()
        except Exception:
            return None

MONTHS = {
    'jan':1,'feb':2,'mar':3,'apr':4,'may':5,'jun':6,
    'jul':7,'aug':8,'sep':9,'oct':10,'nov':11,'dec':12
}

NAME_TO_SLUG = {
    'the arindas': 'arindas', 'arindas': 'arindas',
    'the turamyes': 'turamyes', 'turamyes': 'turamyes',
    'the tuhimbises': 'tuhimbises', 'tuhimbises': 'tuhimbises',
    'mr boaz': 'boaz', 'boaz': 'boaz', 'mr. boaz': 'boaz',
    'priscilla': 'priscilla', 'priscilla t': 'priscilla',
    'priscilla tuh': 'priscilla', 'priscilla tuhimbise': 'priscilla',
    'alex': 'alex', 'alex t': 'alex', 'alext t': 'alex',
    'alex tuhimbise': 'alex', 'alex tuhimbise ': 'alex',
}

members = qry("SELECT id, slug FROM klafam_members")
MEMBER_IDS = {r['slug']: r['id'] for r in members}
print("Members:", MEMBER_IDS)

def parse_due(text):
    m = re.search(r'(\d+)/(\d+)/(\d{4})', text)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return date(y, mo, d)
        except Exception:
            pass
    return None

def slug_from_name(name):
    return NAME_TO_SLUG.get(name.strip().lower().rstrip())

HEADER_RE = re.compile(
    r'^([A-Za-z]+)\s*(\d{4})?\s*\(?(?:due\s+date\s+)?(\d+/\d+/\d+)',
    re.IGNORECASE
)

with open("/tmp/klafam_raw.csv", newline='', encoding='utf-8') as f:
    raw = f.read()

blocks = []
current = None

for line in raw.splitlines():
    hm = HEADER_RE.match(line)
    if hm:
        if current:
            blocks.append(current)
        mon_str = hm.group(1).lower()[:3]
        year_str = hm.group(2)
        due_str = hm.group(3)
        due = parse_due(due_str)
        year = int(year_str) if year_str else (due.year if due else None)
        mon_num = MONTHS.get(mon_str)
        current = {
            'year': year, 'month': mon_num,
            'label': f"{hm.group(1).capitalize()} {year}",
            'due': due, 'rows': []
        }
        continue
    if current is None:
        continue
    stripped = line.strip()
    if not stripped or stripped.lower().startswith('family') or stripped.lower().startswith('total'):
        continue
    parts = next(csv.reader([line]))
    name = parts[0].strip() if parts else ''
    if not name:
        continue
    amt_raw = parts[1].strip().replace(',', '') if len(parts) > 1 else '0'
    bene_raw = parts[2].strip() if len(parts) > 2 else ''
    try:
        amt = int(float(amt_raw)) if amt_raw else 0
    except ValueError:
        amt = 0
    current['rows'].append({'name': name, 'amount': amt, 'bene': bene_raw})

if current:
    blocks.append(current)

print(f"Parsed {len(blocks)} monthly blocks")

ins_cycles = 0
ins_contribs = 0
skipped = 0

try:
    for b in blocks:
        if not b['year'] or not b['month']:
            print(f"  SKIP - bad year/month: {b['label']}")
            skipped += 1
            continue

        bene_slug = None
        for r in b['rows']:
            if r['bene']:
                bene_slug = slug_from_name(r['bene'])
                if bene_slug:
                    break
        bene_id = MEMBER_IDS.get(bene_slug) if bene_slug else None
        total = sum(r['amount'] for r in b['rows'])

        existing = qry("SELECT id FROM klafam_cycles WHERE year=%s AND month=%s", (b['year'], b['month']))
        if existing:
            cycle_id = existing[0]['id']
            exe("UPDATE klafam_cycles SET beneficiary_id=%s, total_collected=%s WHERE id=%s",
                (bene_id, total, cycle_id))
        else:
            row = exe(
                "INSERT INTO klafam_cycles (year,month,month_label,due_date,beneficiary_id,total_collected) "
                "VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
                (b['year'], b['month'], b['label'], b['due'], bene_id, total)
            )
            cycle_id = row['id']
            ins_cycles += 1

        for r in b['rows']:
            slug = slug_from_name(r['name'])
            if not slug:
                print(f"  UNKNOWN member: {repr(r['name'])} in {b['label']}")
                continue
            member_id = MEMBER_IDS.get(slug)
            if not member_id:
                continue
            amt = r['amount']
            status = 'paid' if amt > 0 else 'missed'
            existing_c = qry(
                "SELECT id FROM klafam_contributions WHERE cycle_id=%s AND member_id=%s",
                (cycle_id, member_id)
            )
            if existing_c:
                exe("UPDATE klafam_contributions SET amount=%s, status=%s WHERE id=%s",
                    (amt, status, existing_c[0]['id']))
            else:
                exe("INSERT INTO klafam_contributions (cycle_id,member_id,amount,status) VALUES (%s,%s,%s,%s)",
                    (cycle_id, member_id, amt, status))
                ins_contribs += 1

    conn.commit()
    print(f"\nCommitted. Cycles: {ins_cycles}, Contributions: {ins_contribs}, Skipped: {skipped}")

except Exception as e:
    conn.rollback()
    print(f"ROLLBACK: {e}")
    raise
finally:
    conn.close()

# Summary report
conn2 = psycopg2.connect(DATABASE_URL)
with conn2.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
    cur.execute("""
        SELECT m.slug, m.display_name, m.is_active,
               COUNT(c.id) as months,
               COALESCE(SUM(c.amount),0) as contributed,
               (SELECT COUNT(*) FROM klafam_cycles WHERE beneficiary_id=m.id) as times_rcvd,
               (SELECT COALESCE(SUM(total_collected),0) FROM klafam_cycles WHERE beneficiary_id=m.id) as received
        FROM klafam_members m
        LEFT JOIN klafam_contributions c ON c.member_id=m.id
        GROUP BY m.id, m.slug, m.display_name, m.is_active
        ORDER BY m.id
    """)
    rows = cur.fetchall()
conn2.close()

print("\nMember summary:")
for r in rows:
    net = r['received'] - r['contributed']
    active = "ACTIVE" if r['is_active'] else "hist"
    print(f"  [{active}] {r['display_name']:20}  contributed={r['contributed']:>10,}  received={r['received']:>10,}  net={net:>+10,}  cycles={r['months']}")
