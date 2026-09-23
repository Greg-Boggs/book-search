# books

Library discovery search evaluation. See `BRIEF.md` for the goal, `PLAN.md` for state of
play, `BUILD.md` for how it gets built.

## Setup

```bash
ddev start
ddev npm install
ddev test
```

That's the whole thing. Solr comes up with the project — you do not install or configure it.

## Commands

| Command | Does |
|---|---|
| `ddev test` | Unit + Solr integration tests |
| `ddev test --watch` | Same, watching |
| `ddev typecheck` | `tsc --noEmit` |
| `ddev solr` | Opens the Solr admin UI on the `bibs` core |
| `ddev npm run <script>` | Anything in `package.json` |

## Layout

| Path | What |
|---|---|
| `ingest/` | SPL CSV → normalized docs |
| `search/` | Solr client and query building |
| `eval/` | Known-item harness, metrics |
| `tests/` | Vitest. `*.integration.test.ts` needs Solr up |
| `data/raw/` | Source data, gitignored — see BRIEF.md |

## Solr

- From the web container: `http://solr:8983/solr/bibs`
- From the host: `http://books.ddev.site:8983/solr/`
- Core `bibs` is created on first start from the `_default` configset. Our schema is applied
  as code, not hand-edited XML.
- Heap is capped at 1 GB deliberately — this box has ~5 GB free. Don't raise it without
  checking `free -g` first.

## Deploy

`git clone` gives you **code, not data** — `data/` is gitignored, so a fresh checkout has zero
documents until the index is shipped separately. See [deploy/README.md](deploy/README.md).

```bash
ssh root@DROPLET 'bash -s' < deploy/provision.sh   # once
DROPLET=root@1.2.3.4 ./deploy/sync-index.sh        # ship the 662MB index
```

## Related project

`~/sites/ilsws` is a separate ddev project holding the PHP ILSWS probe (Multnomah MARC via
`libilsws`) and the SirsiDynix SDK docs. It is deliberately not nested here — two ddev
projects, started independently. See its README.
