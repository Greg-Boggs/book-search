#!/usr/bin/env bash
# Release: pull, install, build, restart, verify.
#   ssh root@DROPLET 'bash -s' < deploy/update.sh
#
# Data is NOT touched. The Solr index lives outside the repo and is shipped
# separately with deploy/sync-index.sh.
set -euo pipefail

APP_DIR=/srv/book-search
APP_USER=books

# SECURITY: the checkout must be root-owned and unwritable by the app account
# BEFORE anything here executes. Deploys run git, npm and the build as root, so
# any file the app account can modify - .git/config, .git/hooks/*, package.json
# scripts, node_modules binaries - would execute with root privileges.
#
# Checking only the top directory is not enough: files underneath, including
# git metadata, can be app-writable while the directory itself looks fine. And
# fixing permissions AFTER running git is too late. So verify the whole tree,
# git metadata included, and refuse before executing a single command.
#
# Do NOT add a git safe.directory exception to make this pass. Needing one means
# ownership has drifted and the escalation path is open again.
cd "$APP_DIR"

# Symlinks always report lrwxrwxrwx on Linux and their mode is meaningless -
# the target's permissions govern. Flagging them would make the guard cry wolf,
# and a guard that cries wolf gets switched off. Ownership is still checked on
# symlinks, because a link the app account owns could be repointed.
BAD=$(find "$APP_DIR" \( ! -user root -o \( ! -type l -a -perm /go=w \) \) \
  -printf '%M %u %p\n' 2>/dev/null | head -5)
if [ -n "$BAD" ]; then
  echo "REFUSING TO DEPLOY - the checkout is not root-owned and read-only."
  echo "  An app-account compromise would become root at the next deploy."
  echo
  echo "  Offending paths (first 5):"
  echo "$BAD" | sed 's/^/    /'
  echo
  echo "  Fix:  chown -R root:root $APP_DIR && chmod -R go-w $APP_DIR"
  exit 1
fi

COUNT=$(find "$APP_DIR" | wc -l)
echo "==> checkout verified: $COUNT paths, all root-owned and not group/world writable"

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

# An API that answers correctly says nothing about whether the page works: a
# refactor once deleted client helpers and left every API check green while the
# browser threw ReferenceError before making a request.
echo "==> verifying the page still defines its client helpers"
PAGE=$(curl -sf http://127.0.0.1:4321/ || true)
MISSING=""
for fn in go startWorking encodeSearch resolveCovers renderFacets card; do
  printf '%s' "$PAGE" | grep -q "function $fn" || MISSING="$MISSING $fn"
done
if [ -n "$MISSING" ]; then
  echo "FAILED - the served page is missing:$MISSING"
  echo "  The API works but the browser will throw before it makes a request."
  exit 1
fi
echo "    page ok: all client helpers present"
echo "done."
