#!/bin/bash
# Pull latest from GitHub and restart the service.
# Run as root on Hetzner: bash /var/www/kimfamhub/deploy.sh
set -euo pipefail
cd /var/www/kimfamhub
git pull origin main
systemctl restart kimfamhub
echo 'Deploy complete.'
