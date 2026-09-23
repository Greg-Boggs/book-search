# Design prompt

For handing to a design-specialist model. Keep it short — the constraints do the work.

---

Design a public library catalog search that feels like a reading room, not a database.

736,000 books, 1.4 million copies. Search is deliberate, not instant: a short
named sequence shows the work being done, then the full grid appears at once.

Visual: type-led and generous. Roughly 40% of records have no cover art, so
typography carries the page. Warm paper tones in light, deep ink in dark.
Civic and generous, not corporate SaaS.

Page Structure:
Search: one oversized input, centered — the whole page at rest.
Results: dense but airy; real covers where they exist, generated typographic
  spines where they don't.
Facets: format, decade, language, branch — a quiet rail, never a wall of checkboxes.
Record: a full spread. Summary, subjects, other editions, where to find it on a shelf.
Zero results: treated as a designed state, not an afterthought.

Interaction Details:
- Nothing renders until every cover has decoded. The grid appears complete, in one
  piece — never popping in image by image.
- Coverless records get a typographic spine keyed to their subject; a shelf of them
  should look deliberate, not broken.
- The result count counts down from 736,000 as the query narrows.
- Format siblings (book / large print / ebook / audiobook) stack as one result and
  fan out on hover.
- Facet counts tick rather than redraw.
- Result → detail morphs as a view transition, cover as the shared element.
- ⌘K from anywhere.

Overall Vibe: fast, literate, generous, unmistakably a library — and unmistakably
built this decade.

---

## Why these constraints

Notes for us, not for the design model.

- **40% coverless** is the real design problem. Cover art comes from the Open Library
  Covers API, keyed on ISBN, and only 59.5% of bibs have an ISBN — skewed toward newer
  books. A design that assumes a clean cover grid will fall apart on older material.
  Turning the gap into a feature is likely where the best ideas come from.
- **Format stacking** mirrors what BiblioCommons does natively and our bib-level data
  does not. The grouping comes from Open Library's work→editions clustering.
- **Facets** map to fields we actually have: `itemtype`, `publicationyear`, `language`,
  `itemlocation`.
- **The wait is deliberate.** Solr answers in 6-30ms, but results are held ~900ms behind a
  sequence that names each step. This is the labor illusion (Buell & Norton): work shown is
  work valued. It only holds if the steps are specific — a generic spinner reads as slow.
