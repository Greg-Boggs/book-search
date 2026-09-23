# Build plan

_Companion to PLAN.md (state of play). This is how the app gets made._

## Stack

Solr is the one settled choice. The rest is a starting hypothesis, not a decision.

| Layer | Leaning | Why |
|---|---|---|
| Engine | **Solr 9.7** — settled | Already in `docker/compose.yml` |
| Frontend | Astro + TypeScript, likely one interactive island | ~0 JS for the shell, fast first paint |
| API | Thin route → Solr | Solr never faces the internet, whatever fronts it |
| Ingest + eval | TypeScript, probably | Shares a language with the front end |
| MARC harvest | **PHP** (`libilsws`) | Already written and works; emits JSONL and hands off |

Worth revisiting once there's something on screen. If Astro fights us, or the team would rather
maintain something else, swap it — the only thing that would genuinely hurt to redo is the
ingest and eval, and those are deliberately engine- and framework-agnostic.

Ingest emits engine-neutral `bibs.jsonl` with a thin Solr adapter, so swapping engines is a
swap and not a rewrite.

## Phases

0. **Ingest.** SPL CSV → `bibs.jsonl`, one doc per bib, items rolled up. Strip ISBD tails,
   de-invert authors, unbracket years, split subjects. `itemcount` → popularity. Fixture first.
1. **Solr up.** Schema, analyzers, edismax. Fixture indexed end to end.
2. **Eval harness.** Known-item generator, MRR@10 / Recall@10, frozen spec, dev/test split.
   Before tuning — otherwise we're guessing.
3. **UI.** The front seat. Detail below.
4. **Full SPL.** 736k bibs. Tune against the scoreboard.
5. **OL enrichment.** Stream the dump, ISBN → edition → work. Descriptions, subjects,
   edition clusters. Re-run eval, report the delta.
6. **MARC floor.** Sample of SPL bibs → `STDNUMBER` → `getBibMarc()`. Measure the gap.

Real user queries slot into Phase 2 whenever they arrive; nothing reorders.

## Search quality

- **edismax**, roughly `title^10 author^5 subject^3 summary^1`, phrase boost on title.
- **Analyzers:** ICU folding (the collection has Chinese, Russian, Spanish, Vietnamese),
  `WordDelimiterGraph`, `KStem` — not Porter, which mangles names.
- **Typos:** dedicated ngram field. `fuzzy~` is slow and noisy at this size.
- **SuggestComponent** (autocomplete) and **SpellCheckComponent** (did-you-mean). Both stock.
- **Collapse/Expand** on OL work id → format grouping, the thing BiblioCommons does natively.
- **Facets:** itemtype, year, language, branch.
- **Popularity multiplicative, not additive.** Additive lets popular junk outrank exact matches.

## UI

Non-negotiable:

- **A deliberate wait, not a spinner.** Solr answers in 6-30ms; results are held ~900ms behind
  a sequence naming each step, then revealed complete. Shown work reads as valuable work.
- **Cover wall.** OL Covers API for the 59.5% with ISBNs; generated typographic covers keyed to
  subject for the rest, so misses don't read as misses.
- **View Transitions** — result → detail morphs rather than navigates. Native in Astro, and
  available as a plain browser API regardless of what we build in.
- **⌘K palette.** An afternoon's work, reads as expensive.
- Dark mode.
- Facets that animate rather than redraw.

Optional, must earn its place:

- Charts. Solr's `facet.range` hands us a year distribution per query, so a timeline is cheap
  to build. **Not the centerpiece** — try it, keep it only if it's actually good.

## Constraints

- **No scraping BiblioCommons.** Comparison is a human, live, at the demo.
- **No storing user query content in the database** — team decision pending.
- 15 GB RAM / ~5 GB free. Stream, don't sort. One engine at a time (compose gives Solr and
  OpenSearch 4 GB heap each).
