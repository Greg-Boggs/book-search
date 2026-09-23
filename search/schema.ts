/**
 * Solr schema as code. Idempotent - safe to re-run.
 *   ddev npm run solr:schema
 */
const BASE = process.env.SOLR_URL ?? "http://solr:8983/solr";
const CORE = process.env.SOLR_CORE ?? "bibs";

async function post(body: unknown): Promise<void> {
  const res = await fetch(`${BASE}/${CORE}/schema`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { errors?: unknown[] };
  if (json.errors) {
    const msg = JSON.stringify(json.errors);
    // Re-running is normal; only genuine problems should stop us.
    if (/already exists|Field .* already/i.test(msg)) return;
    throw new Error(msg);
  }
}

/** Tolerates "doesn't exist" so the script is re-runnable. */
async function tryPost(body: unknown): Promise<void> {
  try { await post(body); } catch { /* ignore */ }
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

await post({
  "add-field": [
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
    { name: "circulating", type: "boolean", indexed: true, stored: true, docValues: true },
    { name: "text", type: "text_bib", indexed: true, stored: false, multiValued: true },
  ],
});

await post({
  "add-copy-field": [
    { source: "title", dest: ["text", "title_ngram"] },
    { source: "author", dest: ["text", "author_ngram"] },
    { source: "subjects", dest: "text" },
    { source: "publisher", dest: "text" },
    { source: "isbn", dest: "text" },
  ],
});

console.error("schema applied to", `${BASE}/${CORE}`);
