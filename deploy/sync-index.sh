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
rsync -az --delete --info=progress2 "$STAGE/" "$DROPLET:$REMOTE_SOLR/"

echo "==> fixing ownership and restarting"
ssh "$DROPLET" "chown -R solr:solr $REMOTE_SOLR 2>/dev/null || chown -R books:books $REMOTE_SOLR; systemctl start solr"

echo "==> verifying"
sleep 6
ssh "$DROPLET" "curl -sf 'http://localhost:8983/solr/bibs/select?q=*:*&rows=0'" \
  | grep -o '"numFound":[0-9]*' || { echo "FAILED - check solr logs on the droplet"; exit 1; }
echo "done."
