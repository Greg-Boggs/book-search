# Replacing BiblioCommons with in-house search

## Goal

We want to build the library's discovery layer ourselves, replacing BiblioCommons.
The library hasn't asked for this and isn't sold on it. The objection that matters
is *would your search be worse?*

Answer it with a number, not an argument.

## Why Seattle Public Library

SPL publishes its full catalog as open data. It's a real, large, public collection we can
index and measure against without touching our own systems.

**We do not scrape BiblioCommons.** No crawler, no automated queries, no harvesting their
result pages. We're building world-class search, not reverse-engineering a vendor's website.
Any comparison happens live, by a human, in a browser, at the demo.

Our own corpus is Multnomah Symphony MARC via ILSWS. SPL's CSV is thinner than MARC,
so SPL numbers are a floor.

## Data on disk (`data/raw/`)

| File | Size | Contents |
|---|---|---|
| `spl-2026-09.csv` | 526M | SPL Sept 2026 snapshot. 1,419,031 item rows, 736,455 bibs |
| `spl-sample-spread.csv` | 1.5M | 4,000-row fixture, spread across the catalog |
| `ol_ratings.txt.gz` | 8.8M | 1,048,023 Open Library ratings |
| `ol_lists.txt.gz` | 53M | 264,531 OL user lists; 50,815 have 5+ seeds |
| `ol_dump_2026-08-31.txt.gz` | **18.1G** | OL all-types dump — editions, works, authors. Landed 2026-09-23 |

SPL columns: `bibnum, title, author, isbn, publicationyear, publisher, subjects,
itemtype, itemcollection, floatingitem, itemlocation, reportdate, itemcount`

The OL dump came in at **18.1 GB, not the 12.4 G estimated** — 46% bigger, so budget time and
disk accordingly. `gzip -t` passes; the download is intact. Format is 5-column TSV with JSON in
column 5. Types interleave rather than sorting, and `/type/delete` + `/type/redirect` records are
mixed throughout — filter both or they poison the join. A 20M-line sample held 9.5M editions,
6.9M works, 2.6M authors.

Editions carry `isbn_10`, `isbn_13` and `works[]`, so the bridge
**SPL ISBN → OL edition → OL work → ratings / lists / description** is complete. The ratings and
lists files carry no ISBNs at all, so this dump is the only join path.

## Our own catalog via libilsws

We have live ILSWS access to the Multnomah catalog through `libilsws`, which we wrote. Test
instance is `multcolibtest_ilsws` on `sdws06.sirsidynix.net`; config lives in
`libmain_webform_symphony`. Probe project is `ilsws/` (ddev, php 8.3).

This is a **richness oracle for a sample, not a corpus to harvest** — it's a demo app, and SPL is
already the collection. Look an SPL record up by ISBN, pull its full MARC, compare.

- **`getBibMarc()` is the only correct call.** It hits `/catalog/bib/key/{k}` with *no*
  `includeFields` and returned 72 subfields across 32 tags. `getBib()` with nested
  `includeFields` silently returned **only key, author and title** — every MARC subfield request
  dropped, no error. That's SirsiDynix KB-166996, confirmed on our own data.
- **`STDNUMBER` is the ISBN index.** There is no index named ISBN.
- MARC gives us what the SPL CSV lacks: a 520 summary, subfield structure, 586 awards,
  386 audience, call numbers, and WorldCat entity URIs on authors and Dewey.
- `catalogdump` is ruled out — no shell access, no ops capacity, support costs too much.

## What we measured

- 736,455 distinct bibs. ISBN on 59.5% of them, subjects on 96.8%, author on 85%.
- Open Library keys everything on works and editions, never ISBN. ISBNs live on
  editions; descriptions live on works. The ratings and lists files contain no ISBNs.
- OL editions is ~80-100GB uncompressed.
- 14,309 bibs have 10+ copies; the max is 56.
- ~23% of the collection is reference, microform and periodicals.
- Titles carry the ISBD tail (`... / by Philip Rawson.`). Years are bracketed (`[2009]`).
  Authors are inverted with life dates (`Rawson, Philip, 1924-1995`).

## Three demos

1. **Small.** The 4,000-row SPL fixture. Prove the shape works end to end.
2. **Real.** Full SPL catalog, enriched with whatever Open Library adds to it.
   This is the one we demo cold, and the one the numbers come from.
3. **Blue sky.** Search all of Open Library, using SPL only for popularity.
   Aaron Swartz started that project to "build the world's greatest library"
   ([Raw Thought, 16 July 2007](http://www.aaronsw.com/weblog/openlibrary)).
   This one is us proving we can reach that far.

Two is the butter. People want to search what the library actually has — a patron
who finds a book nobody owns is worse off than one who found nothing. One proves the
shape. Three proves the ambition.

## My calls

- Make it feel modern. Fast, clean, something I'd be proud to demo cold in a
  room full of skeptics. Not a library catalog from 2009.
- Start with Solr. I know Solr. Swap it later if something beats it — just don't
  paint us into it.
- Not VuFind. I've used it. The search is bad.
- **Both seats, not one.** The search has to be genuinely great *and* it has to look like
  nothing else in the library world. Neither carries this alone. Don't trade one off for
  the other.
- Astro and TypeScript look like a good fit for the front end — worth trying. Not locked in;
  pick what actually gets us a fast, sharp UI.
