/**
 * Solr schema as code. Idempotent - safe to re-run.
 *   ddev npm run solr:schema
 */
const BASE = process.env.SOLR_URL ?? "http://solr:8983/solr";
const CORE = process.env.SOLR_CORE ?? "bibs";

/**
 * Posts a schema command. Throws loudly on anything that is not a benign
 * "already exists" - an earlier version swallowed real failures and printed
 * "schema applied" over a schema that had not been applied at all, which cost
 * an afternoon on first deploy.
 */
async function post(body: unknown): Promise<void> {
  const res = await fetch(`${BASE}/${CORE}/schema`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    errors?: unknown[];
    error?: { details?: unknown[]; msg?: string };
    responseHeader?: { status?: number };
  };
  const problem = json.errors ?? json.error?.details ?? (json.error ? [json.error] : null);
  if (problem) {
    const msg = JSON.stringify(problem);
    if (/already exists|Field .* already/i.test(msg)) return;
    throw new Error(msg);
  }
  if ((json.responseHeader?.status ?? 0) !== 0) {
    throw new Error(`solr returned status ${json.responseHeader?.status}: ${JSON.stringify(json)}`);
  }
}

/**
 * For deletes of things that may not exist yet. Reports what it swallowed
 * rather than hiding it.
 */
async function tryPost(body: unknown): Promise<void> {
  try { await post(body); }
  catch (e) { console.error("  (ignored)", e instanceof Error ? e.message.slice(0, 120) : e); }
}

await tryPost({ "delete-field-type": { name: "icu_probe" } });

// ICU folding handles the Chinese, Russian, Spanish and Vietnamese material.
// KStem over Porter: less aggressive, and it mangles proper nouns far less.
const analyzer = {
  tokenizer: { class: "solr.StandardTokenizerFactory" },
  filters: [
    { class: "solr.ICUFoldingFilterFactory" },
    {
      class: "solr.WordDelimiterGraphFilterFactory",
      generateWordParts: 1, generateNumberParts: 1,
      catenateWords: 1, catenateNumbers: 1, splitOnCaseChange: 0,
      preserveOriginal: 1,
    },
    { class: "solr.FlattenGraphFilterFactory" },
    { class: "solr.KStemFilterFactory" },
  ],
};
const queryAnalyzer = {
  tokenizer: { class: "solr.StandardTokenizerFactory" },
  filters: [
    { class: "solr.ICUFoldingFilterFactory" },
    {
      class: "solr.WordDelimiterGraphFilterFactory",
      generateWordParts: 1, generateNumberParts: 1,
      catenateWords: 0, catenateNumbers: 0, splitOnCaseChange: 0,
      preserveOriginal: 1,
    },
    { class: "solr.KStemFilterFactory" },
  ],
};

await tryPost({
  "add-field-type": {
    name: "text_bib", class: "solr.TextField", positionIncrementGap: "100",
    indexAnalyzer: analyzer, queryAnalyzer,
  },
});

// Edge ngrams for typo-tolerant / as-you-type matching on titles.
await tryPost({
  "add-field-type": {
    name: "text_ngram", class: "solr.TextField", positionIncrementGap: "100",
    indexAnalyzer: {
      tokenizer: { class: "solr.StandardTokenizerFactory" },
      filters: [
        { class: "solr.ICUFoldingFilterFactory" },
        { class: "solr.EdgeNGramFilterFactory", minGramSize: 2, maxGramSize: 15 },
      ],
    },
    queryAnalyzer: {
      tokenizer: { class: "solr.StandardTokenizerFactory" },
      filters: [{ class: "solr.ICUFoldingFilterFactory" }],
    },
  },
});

const text = (name: string, multi = false) =>
  ({ name, type: "text_bib", indexed: true, stored: true, multiValued: multi });
const facet = (name: string, multi = true) =>
  ({ name, type: "string", indexed: true, stored: true, multiValued: multi, docValues: true });
const num = (name: string) =>
  ({ name, type: "pint", indexed: true, stored: true, docValues: true });

const FIELDS = [
  text("title"),
  { name: "title_ngram", type: "text_ngram", indexed: true, stored: false },
  { name: "title_str", type: "string", indexed: true, stored: true, docValues: true },
  { name: "title_full", type: "string", indexed: false, stored: true },
  text("author"),
  { name: "author_ngram", type: "text_ngram", indexed: true, stored: false },
  { name: "author_inverted", type: "string", indexed: false, stored: true },
  text("subjects", true),
  facet("subjects_facet"),
  text("publisher"),
  num("year"),
  facet("isbn"),
  facet("itemtypes"),
  facet("formats"),
  facet("audiences"),
  facet("locations"),
  num("copies"),
  // Collapse key so format siblings (book / large print / ebook / audio)
  // return as one result, and the cover-art flag the demo ranking uses.
  { name: "work_key", type: "string", indexed: true, stored: true, docValues: true },
  { name: "has_cover", type: "boolean", indexed: true, stored: true, docValues: true },
  { name: "circulating", type: "boolean", indexed: true, stored: true, docValues: true },
  { name: "text", type: "text_bib", indexed: true, stored: false, multiValued: true },
];

/**
 * Add only what is missing. Posting the whole set and tolerating "already
 * exists" looks equivalent but is not: Solr rejects the batch as a unit, so
 * one existing field silently prevents every new one from being added. That
 * is how work_key and has_cover reached production missing.
 */
const existing = new Set(
  ((await fetch(`${BASE}/${CORE}/schema/fields?wt=json`).then((r) => r.json())) as
    { fields: { name: string }[] }).fields.map((f) => f.name),
);
const toAdd = FIELDS.filter((f) => !existing.has(f.name));
if (toAdd.length) {
  console.error(`  adding ${toAdd.length} field(s): ${toAdd.map((f) => f.name).join(", ")}`);
  await post({ "add-field": toAdd });
} else {
  console.error("  all fields already present");
}

/**
 * Copy fields are NOT idempotent: posting the same rule twice registers it
 * twice, and Solr then rejects every document with
 * "Multiple values encountered for non multiValued copy field". Diff first.
 */
const COPIES: { source: string; dest: string[] }[] = [
  { source: "title", dest: ["text", "title_ngram"] },
  { source: "author", dest: ["text", "author_ngram"] },
  { source: "subjects", dest: ["text"] },
  { source: "publisher", dest: ["text"] },
  { source: "isbn", dest: ["text"] },
];

const existingCopies = new Set(
  ((await fetch(`${BASE}/${CORE}/schema/copyfields?wt=json`).then((r) => r.json())) as
    { copyFields: { source: string; dest: string }[] })
    .copyFields.map((c) => `${c.source}->${c.dest}`),
);

const addCopies = COPIES
  .flatMap((c) => c.dest.map((d) => ({ source: c.source, dest: d })))
  .filter((c) => !existingCopies.has(`${c.source}->${c.dest}`));

if (addCopies.length) {
  console.error(`  adding ${addCopies.length} copy-field rule(s)`);
  await post({ "add-copy-field": addCopies });
} else {
  console.error("  all copy-field rules already present");
}

// Verify rather than assert: confirm the fields are actually present.
const check = await fetch(`${BASE}/${CORE}/schema/fields?wt=json`).then((r) => r.json()) as
  { fields: { name: string }[] };
const have = new Set(check.fields.map((f) => f.name));
const need = ["title", "title_ngram", "author", "author_ngram", "subjects",
  "subjects_facet", "publisher", "year", "isbn", "itemtypes", "formats",
  "audiences", "locations", "copies", "circulating", "work_key", "has_cover", "text"];
const missing = need.filter((f) => !have.has(f));
if (missing.length) {
  console.error(`FAILED - ${missing.length} field(s) missing: ${missing.join(", ")}`);
  process.exit(1);
}
const dupes = ((await fetch(`${BASE}/${CORE}/schema/copyfields?wt=json`).then((r) => r.json())) as
  { copyFields: { source: string; dest: string }[] }).copyFields
  .map((c) => `${c.source}->${c.dest}`);
const dupe = dupes.find((k, i) => dupes.indexOf(k) !== i);
if (dupe) {
  console.error(`FAILED - duplicate copy-field rule: ${dupe}. Indexing will reject every doc.`);
  process.exit(1);
}
console.error(`schema applied and verified (${need.length} fields, ${dupes.length} copy rules) on ${BASE}/${CORE}`);

// Top-level await requires this file to be a module.
export {};
