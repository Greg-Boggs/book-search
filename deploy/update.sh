#!/usr/bin/env bash
# Release: pull, install, build, restart, verify.
#   ssh root@DROPLET 'bash -s' < deploy/update.sh
#
# Data is NOT touched. The Solr index lives outside the repo and is shipped
# separately with deploy/sync-index.sh.
set -euo pipefail

APP_DIR=/srv/book-search
APP_USER=books

# SECURITY: the checkout is owned by root and the app account cannot write to
# it. Deploys run git, npm and the build as root, so anything the app account
# could modify - git hooks, git config, package scripts - would execute with
# root privileges on the next release. Making the tree read-only to the app
# removes that path. Do NOT add a git safe.directory exception here; needing
# one means ownership has drifted back and the escalation path is open again.
cd "$APP_DIR"
OWNER=$(stat -c '%U' "$APP_DIR")
if [ "$OWNER" != "root" ]; then
  echo "REFUSING: $APP_DIR is owned by '$OWNER', not root."
  echo "  An app-account compromise would become root at the next deploy."
  echo "  Fix: chown -R root:root $APP_DIR && chmod -R go-w $APP_DIR"
  exit 1
fi

echo "==> pulling"
git fetch --quiet origin
git reset --hard --quiet origin/main
git log --oneline | head -1 | sed 's/^/    /'

echo "==> installing"
npm ci --omit=dev --no-fund --no-audit 2>&1 | tail -2

echo "==> building"
npm run build 2>&1 | tail -2

# Code stays root-owned and read-only to the app account. Only runtime state
# is writable, and it lives outside the checkout.
chown -R root:root "$APP_DIR"
chmod -R go-w "$APP_DIR"
install -d -o "$APP_USER" -g "$APP_USER" -m 755 /var/lib/books

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
