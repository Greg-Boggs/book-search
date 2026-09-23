/**
 * Streams bibs.jsonl into Solr.
 *   ddev npm run solr:index -- data/work/bibs.jsonl
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { BibDoc } from "../ingest/bib.js";

const BASE = process.env.SOLR_URL ?? "http://solr:8983/solr";
const CORE = process.env.SOLR_CORE ?? "bibs";
const BATCH = 5_000;

const input = process.argv[2];
if (!input) { console.error("usage: index-docs.ts <bibs.jsonl>"); process.exit(1); }

async function flush(docs: unknown[]): Promise<void> {
  if (docs.length === 0) return;
  const res = await fetch(`${BASE}/${CORE}/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(docs),
  });
  if (!res.ok) throw new Error(`solr ${res.status}: ${(await res.text()).slice(0, 400)}`);
}

/** Solr wants the facet copies as separate fields; the rest maps straight across. */
function toSolr(d: BibDoc): Record<string, unknown> {
  return {
    ...d,
    title_str: d.title,
    subjects_facet: d.subjects,
  };
}

const rl = createInterface({ input: createReadStream(input), crlfDelay: Infinity });
let batch: unknown[] = [];
let n = 0;
const t0 = Date.now();

for await (const line of rl) {
  if (!line.trim()) continue;
  batch.push(toSolr(JSON.parse(line) as BibDoc));
  if (batch.length >= BATCH) {
    await flush(batch);
    n += batch.length;
    batch = [];
    if (n % 100_000 === 0) {
      const s = (Date.now() - t0) / 1000;
      console.error(`  ${n.toLocaleString()} docs  ${Math.round(n / s).toLocaleString()}/s`);
    }
  }
}
await flush(batch);
n += batch.length;

await fetch(`${BASE}/${CORE}/update?commit=true`, { method: "POST" });
const s = (Date.now() - t0) / 1000;
console.error(`indexed ${n.toLocaleString()} docs in ${s.toFixed(1)}s (${Math.round(n / s).toLocaleString()}/s)`);
