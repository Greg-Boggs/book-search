#!/usr/bin/env bash
# Release: pull, install, build, restart, verify.
#   ssh root@DROPLET 'bash -s' < deploy/update.sh
#
# Data is NOT touched. The Solr index lives outside the repo and is shipped
# separately with deploy/sync-index.sh.
set -euo pipefail

APP_DIR=/srv/book-search
APP_USER=books

cd "$APP_DIR"
# Files are owned by the app user but deploys run as root.
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

echo "==> pulling"
git fetch --quiet origin
git reset --hard --quiet origin/main
git log --oneline | head -1 | sed 's/^/    /'

echo "==> installing"
npm ci --omit=dev --no-fund --no-audit 2>&1 | tail -2

echo "==> building"
npm run build 2>&1 | tail -2

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> restarting"
systemctl restart books
for i in $(seq 1 15); do
  sleep 2
  if curl -sf -o /dev/null http://127.0.0.1:4321/; then break; fi
  printf "    waiting for app (%ds)\r" "$((i*2))"
done
echo

echo "==> verifying search actually returns results"
ENC=$(python3 -c 'import base64,json;print(base64.urlsafe_b64encode(json.dumps({"q":"cooking","r":1}).encode()).decode().rstrip("="))')
HITS=$(curl -sf "http://127.0.0.1:4321/api/search/$ENC" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("numFound",0))' 2>/dev/null || echo 0)
if [ "${HITS:-0}" -lt 1 ]; then
  echo "FAILED - app is up but search returned $HITS hits."
  echo "  app:  journalctl -u books -n 40 --no-pager"
  echo "  solr: curl -s 'http://localhost:8983/solr/admin/cores?action=STATUS&wt=json'"
  exit 1
fi
echo "    search ok: $HITS hits for 'cooking'"
echo "done."
