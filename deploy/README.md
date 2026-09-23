# Deploy

## The thing that catches people out

**`git clone` gives you code, not data.** `data/` is gitignored — it holds real patron
queries, a 526MB catalogue CSV and an 18GB Open Library dump, none of which belong in a repo
even a private one. A fresh clone therefore has **zero documents** until the index arrives
separately.

Two ways to close that gap. The first is better.

### Build locally, ship the index (recommended)

The droplet only ever holds the finished ~662MB index. It never needs the dumps or the CSVs,
which keeps disk at ~4GB and means a 2GB droplet is viable.

```bash
# on your workstation, once the index is current
DROPLET=root@1.2.3.4 ./deploy/sync-index.sh
```

### Build on the droplet

Only if you want the droplet self-sufficient. It needs the source CSV rsynced up (526MB),
~1GB free RAM during ingest, and roughly 4 minutes. On a 2GB droplet, stop the app first.

```bash
rsync -az data/raw/spl-2026-09.csv $DROPLET:/srv/books/data/raw/
ssh $DROPLET 'cd /srv/books && npm run ingest -- data/raw/spl-2026-09.csv data/work/bibs.jsonl \
  && npm run solr:schema && npm run solr:index -- data/work/bibs.jsonl'
```

## First time

```bash
ssh root@DROPLET 'bash -s' < deploy/provision.sh
```

Installs Node 22, Java 17, Solr 9.7, a 2GB swapfile, and a firewall that allows only SSH and
80/443. **Solr is deliberately not exposed** — it has no authentication in this setup, so
anything that can reach port 8983 can read and delete the whole index.

Verify after provisioning:

```bash
ss -tlnp | grep 8983    # expect 127.0.0.1:8983, never 0.0.0.0:8983
```

## Each release

```bash
ssh $DROPLET 'cd /srv/books && git pull && npm ci && npm run build && systemctl restart books'
```

`npm run build` produces a standalone Node server in `dist/`. Run that, not `astro dev` —
the dev server carries Vite's HMR machinery and about 400MB of resident memory with it.

## Environment

`.env` is gitignored, so it will not arrive with a clone. Create it on the droplet:

```
SYNDETICS_CLIENT=<multnomah's client id>
```

Leave it unset and covers fall back to Open Library alone — the app degrades gracefully,
losing roughly 26 percentage points of cover coverage.

## Sizing

Measured, not guessed: Solr 894MB resident, Node/Astro 406MB in dev, index 662MB on disk.

| | verdict |
|---|---|
| 1GB droplet | no — Solr's heap alone won't fit |
| 2GB | works, with swap and no headroom |
| **4GB** | what to use for anything demoed to an audience |

The failure mode on 2GB isn't slowness, it's the OOM killer stopping Solr mid-demo.
