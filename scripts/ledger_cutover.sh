#!/usr/bin/env bash
# Cut-over day for a project's ledger (ADR-032 phase 3). Run on the server as root AFTER the AppSheet
# has been frozen (nobody is entering rows). One shot, stops at the first failure, changes nothing
# the family sees until the last step.
#   1. fresh snapshot of the AppSheet workbook (unformatted values) kept in /root/ledger_snapshots
#   2. parity: the snapshot must reproduce the sheet's own Financial Statement to the shilling
#   3. one-time import into the prod ledger (refuses a second snapshot)
#   4. flip reads: LEDGER_READS=chicken in the prod .env, restart
#   5. verify: the live card equals the sheet's figures
# Rollback: scripts/ledger_rollback.sh (reads go back to the sheet; ledger rows are kept).
set -euo pipefail
PROJECT=${1:-chicken}
APP=${APP:-/var/www/kimfamhub}
SHEET_ID=${SHEET_ID:-1CqF-NzkMJ8iJw0tC8xkLE9DI94cjFr2vvlAfx4QfXhI}
DIR=/root/ledger_snapshots; mkdir -p "$DIR"; chmod 700 "$DIR"
SNAP="$DIR/appsheet_cutover_$(date +%F_%H%M).json"
cd "$APP"; set -a; . ./.env; set +a
PY="$APP/venv/bin/python"

echo "1/5 snapshot"; "$PY" ledger.py snapshot "$SHEET_ID" "$SNAP"; chmod 600 "$SNAP"
echo "2/5 parity";   "$PY" ledger.py parity "$SNAP" | tail -12
echo "3/5 import";   "$PY" ledger.py import "$PROJECT" "$SNAP"
echo "4/5 flip reads"
if grep -q '^LEDGER_READS=' .env; then
  grep -q "^LEDGER_READS=.*$PROJECT" .env || sed -i "s/^LEDGER_READS=\(.*\)$/LEDGER_READS=\1,$PROJECT/" .env
else
  echo "LEDGER_READS=$PROJECT" >> .env
fi
SERVICE=$(basename "$APP"); systemctl restart "$SERVICE"; sleep 8
echo "5/5 verify"
PORT=$(grep -o -- '-b 127.0.0.1:[0-9]*' /etc/systemd/system/"$SERVICE".service | grep -o '[0-9]*$' | head -1); PORT=${PORT:-8000}
"$PY" - "$SNAP" "$PORT" <<'PYEOF'
import json, sys, urllib.request
sys.path.insert(0, ".")
import ledger
snap = json.load(open(sys.argv[1]))
sheet = ledger.sheet_statement(snap)
card = json.load(urllib.request.urlopen("http://127.0.0.1:%s/api/projects" % sys.argv[2]))["chicken"]
bad = []
for label, key, _d in ledger.STATEMENT_LABELS:
    got = int(card[label]["value"].replace(",", ""))
    if got != sheet[key]:
        bad.append((label, got, sheet[key]))
print("LIVE CARD EQUALS THE SHEET" if not bad else "MISMATCH: %s" % bad)
sys.exit(1 if bad else 0)
PYEOF
echo "Cut-over done. Snapshot kept at $SNAP (archive and rollback source)."
