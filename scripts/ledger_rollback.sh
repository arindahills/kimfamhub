#!/usr/bin/env bash
# Put a project's reads back on the AppSheet (ADR-032). Ledger rows are kept; anything recorded
# natively since cut-over stays in the ledger and must be re-keyed in the sheet by hand.
set -euo pipefail
PROJECT=${1:-chicken}
APP=${APP:-/var/www/kimfamhub}
cd "$APP"
sed -i "s/^\(LEDGER_READS=.*\)\b$PROJECT\b,\?/\1/; s/,$//; /^LEDGER_READS=$/d" .env
systemctl restart "$(basename "$APP")"; sleep 6
echo "Reads for $PROJECT are back on the AppSheet. Remaining flag: $(grep '^LEDGER_READS=' .env || echo none)"
