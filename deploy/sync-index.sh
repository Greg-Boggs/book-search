#!/usr/bin/env bash
# Ships the built Solr index to the droplet.
#
# `git clone` gives the droplet code but NO data - data/ is gitignored and the
# index is ~662MB. Build locally, push the finished index. The droplet never
# needs the 18GB Open Library dump or the 526MB source CSV.
#
#   DROPLET=root@1.2.3.4 ./deploy/sync-index.sh
set -euo pipefail

: "${DROPLET:?set DROPLET=user@host}"
REMOTE_SOLR="${REMOTE_SOLR:-/var/solr/data/bibs}"
LOCAL_CORE="${LOCAL_CORE:-ddev-books-solr:/var/solr/data/bibs}"
STAGE="${STAGE:-/tmp/books-index}"

echo "==> merging to one segment first (smaller transfer, faster queries)"
ddev exec curl -sf -X POST -H 'Content-Type: application/json' \
  "http://solr:8983/solr/bibs/update?wt=json" \
  -d '{"optimize":{"maxSegments":1,"waitSearcher":true}}' >/dev/null

echo "==> copying index out of the container"
rm -rf "$STAGE"; mkdir -p "$STAGE"
docker cp "$LOCAL_CORE/." "$STAGE/"
du -sh "$STAGE"

echo "==> stopping remote solr so the index isn't swapped under a live reader"
ssh "$DROPLET" 'systemctl stop solr || true'

echo "==> rsync"
rsync -az --delete --info=stats2 "$STAGE/" "$DROPLET:$REMOTE_SOLR/"

echo "==> fixing ownership and restarting"
ssh "$DROPLET" "chown -R solr:solr $REMOTE_SOLR 2>/dev/null || chown -R books:books $REMOTE_SOLR; systemctl start solr"

echo "==> verifying (Solr needs time to open a 662MB core on 1 vCPU)"
DOCS=0
for i in $(seq 1 30); do
  # The URL must be single-quoted through BOTH shells: an unescaped & is
  # interpreted by the remote shell and silently backgrounds the request.
  DOCS=$(ssh "$DROPLET" 'curl -sf "http://localhost:8983/solr/admin/cores?action=STATUS&wt=json" 2>/dev/null' \
    | python3 -c 'import sys,json; d=json.load(sys.stdin)["status"]; print(d.get("bibs",{}).get("index",{}).get("numDocs",0))' 2>/dev/null || echo 0)
  [ "${DOCS:-0}" -gt 0 ] && break
  printf "  waiting for core to open (%ds)\r" "$((i*4))"
  sleep 4
done
echo
if [ "${DOCS:-0}" -lt 1 ]; then
  echo "FAILED - bibs core reports 0 docs after 2 minutes."
  echo "  check: ssh $DROPLET 'tail -50 /var/solr/logs/solr.log'"
  exit 1
fi
echo "done. $DOCS docs live on the droplet."
