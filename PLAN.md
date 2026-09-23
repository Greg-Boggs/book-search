# Plan — state of play

_Last updated 2026-09-23. Detail lives in Claude's memory dir; this is the durable summary._

## Rule

**No scraping BiblioCommons.** No crawler, no automated queries. Comparison is a human
typing the same query into both, live, at the demo. This is a hard constraint, not a preference.

## What that costs, honestly

The original plan got its number by crawling BiblioCommons and scoring both systems on the
same queries — "we hit X%, they hit Y%". **That number is off the table.** We cannot claim
"measurably better than BiblioCommons" without their results.

**Most of the method survives.** Known-item retrieval never needed them: generate a realistic
patron query from an SPL bib, check whether we return that bib, score MRR@10 / Recall@10.
Ground truth is free and objective. Only the comparator is gone, not the methodology.

## First real number (2026-09-23)

Real patron queries now in hand: a GA4 export from `multcolib.bibliocommons.com`,
2026-06-25 to 2026-09-22 — **1.9M search events, 42,716 distinct queries** after discarding
browse/facet navigation. Source kept at `data/raw/mcl-queries-2026q3.csv`,
parsed to `data/work/queries.tsv` by `ddev npm run queries`.

Top 400 queries (108,963 real searches) run against our index:

| | curated | uncurated |
|---|---|---|
| zero results, by query | 4.5% | 4.0% |
| **zero results, weighted by actual searches** | **3.5%** | **3.2%** |
| 1-2 results only | 44 | 26 |
| needed fuzzy fallback | 33 | 20 |

**So 96.5% of real searches return something.** Weighted matters: a miss on a query typed
2,000 times is not the same as one typed 5.

**The misses are corpus gaps, not search failures.** Spot-checked with `mm=1` (match any
single word): `warhammer` returns **0** — SPL holds nothing. Same for the Kingdom of Wrenly
series, `may we feed the king`, `bible songs for kids`. The rest are Multnomah-specific
services that are not catalogue records at all: `"black resources collection"` (671),
`pageturners to go` (304), `linkedin learning`, `valueline`, `gresham oregon library`.

This is the mismatch flagged when query logs were first discussed: **these are Multnomah
queries against Seattle's collection.** The honest read is that our search found essentially
everything SPL actually holds. To measure it properly the same queries need running against
the *Multnomah* catalogue via ILSWS — that is the real test, and it is now possible.

Also useful on its own: `data/work/zero-results.tsv` is a ranked list of what patrons ask for
and do not get. That is a collection-development signal, not just a search metric.

## What the number becomes

1. **Absolute quality.** "On N realistic patron queries drawn from SPL's catalog, the right
   book is in the top 10 X% of the time." Reproducible, no judge, no rubric.
2. **Ablations we run ourselves.** Naive BM25 vs tuned; unenriched vs OL-enriched; with and
   without popularity prior. Shows what each component bought.
3. **Live side-by-side at the demo.** Visceral, not measured. Fair use of a public website.

Pre-registration still matters: freeze the query generator, metrics and exclusions to a hashed
spec before the test set runs; tune on dev, report test once.

## Corpus

- **SPL CSV** — `data/raw/spl-2026-09.csv`. 1,419,031 items, 736,455 bibs. Verified.
  Coverage: title 99.8%, year 97.6%, subjects 96.8%, author 85.0%, ISBN 59.5%.
  Quirks: ISBD tails, bracketed years, inverted authors, **subject separators stripped**.
  `itemcount` (copies held) is the best popularity prior on disk — a curated demand signal.
- **Open Library dump** — `data/raw/ol_dump_2026-08-31.txt.gz`, 18.1 GB, `gzip -t` passes.
  5-col TSV, JSON in col 5, types interleaved, `/type/delete` + `/type/redirect` mixed in.
  Editions carry `isbn_10/13` + `works[]`, so ISBN → edition → work → ratings/lists works.
- **Multnomah MARC** via ILSWS — a *richness oracle* for a sample, not a corpus to harvest.
  This is a demo app; we don't need our whole catalog.

## Enrichment decision

**OL for the full corpus** (free, local, complete). **MARC for the floor measurement only**
(a few thousand records). Three sources, complementary — not a quality ranking:

- SPL knows holdings and demand.
- MARC has authority control, structure, call numbers, awards, WorldCat URIs.
- OL has subject breadth, popularity, and **edition clustering**.

Enrichment is ISBN-gated so it caps at **59.5%** of bibs, and the ISBN-less 40.5% skew old and
rare. Report enriched and unenriched slices separately.

**OL's work→editions clustering solves format grouping** (book / large print / eBook / audio
under one result). Eval fix and product feature in one.

## ILSWS — hard-won, do not relearn

- **`getBibMarc()` is the only correct call.** No `includeFields`. It returned 72 subfields
  across 32 tags. `getBib()` with nested `includeFields` silently returned **only key, author,
  title** — every MARC subfield request dropped, no error. That's KB-166996, confirmed.
- **`STDNUMBER`** is the ISBN index (there is no index named ISBN).
- Token lifetime is undocumented; Multnomah's own code caches 900s and retries once on timeout.
- `catalogdump` is **ruled out** — no shell access, no ops capacity, support is expensive.
  Don't re-propose it.
- Probe project: `ilsws/` (ddev, php 8.3, libilsws 3.0.3). Config is gitignored.
  `~/sites/libmain/vendor/autoload.php` is broken (stale Drupal bootstrap) — hence its own project.

## Hardware ceiling

15 GB RAM, ~5 GB free, 12 cores, ~219 GB disk. **Drive joins from the small side** — the SPL
ISBN set is 543,680 entries (~60 MB); stream the dump against it. Never sort OL-scale data.
`docker/compose.yml` gives Solr and OpenSearch 4 GB heap *each* — run one at a time or cut both.
Blue-sky OL-wide search doesn't fit this box well; scope it or use a bigger machine.

## Order

1. Fixture demo end to end.
2. **Full SPL + OL enrichment.** The demo and the numbers. Needs nothing blocked.
3. MARC floor measurement on a sample.
4. Blue sky, hardware permitting.

Engine: Solr first (user's call), ingest emits engine-neutral `bibs.jsonl` with thin adapters
so OpenSearch stays a swap, not a rewrite. Most relevance gain is normalization, not engine.

## Open

- Headline scope: include or exclude the 23% reference/microform/periodical tail?
- Roughly how many bibs in the Multnomah catalog?
- Blue sky: scope down, or bigger box?
