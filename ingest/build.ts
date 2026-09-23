/**
 * SPL CSV -> bibs.jsonl. One document per bib, item rows rolled up.
 *
 *   ddev npm run ingest -- data/raw/spl-sample-spread.csv data/work/fixture.jsonl
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { parse } from "csv-parse";
import { BibAccumulator, type SplRow } from "./bib.js";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: build.ts <input.csv> <output.jsonl>");
  process.exit(1);
}

await mkdir(dirname(output), { recursive: true });

const bibs = new Map<string, BibAccumulator>();
let rows = 0;

const parser = parse({
  columns: true,
  skip_empty_lines: true,
  relax_quotes: true,
  relax_column_count: true,
});

await pipeline(createReadStream(input), parser, async function (source) {
  for await (const rec of source) {
    const row = rec as SplRow;
    const id = row.bibnum?.trim();
    if (!id) continue;
    const existing = bibs.get(id);
    if (existing) existing.add(row);
    else bibs.set(id, new BibAccumulator(row));
    if (++rows % 250_000 === 0) {
      const mb = Math.round(process.memoryUsage().heapUsed / 1e6);
      console.error(`  ${rows.toLocaleString()} rows, ${bibs.size.toLocaleString()} bibs, ${mb}MB`);
    }
  }
});

const out = createWriteStream(output);
let written = 0;
const stats = { noTitle: 0, noAuthor: 0, noIsbn: 0, noYear: 0, reference: 0 };

for (const acc of bibs.values()) {
  const doc = acc.build();
  if (!doc.title) stats.noTitle++;
  if (!doc.author) stats.noAuthor++;
  if (doc.isbn.length === 0) stats.noIsbn++;
  if (doc.year === undefined) stats.noYear++;
  if (!doc.circulating) stats.reference++;
  if (!out.write(JSON.stringify(doc) + "\n")) {
    await new Promise((r) => out.once("drain", r));
  }
  written++;
}
await new Promise<void>((r) => out.end(r));

const pct = (n: number) => `${(100 * (1 - n / written)).toFixed(1)}%`;
console.error(`
rows read    ${rows.toLocaleString()}
bibs written ${written.toLocaleString()}  -> ${output}
coverage     title ${pct(stats.noTitle)}  author ${pct(stats.noAuthor)}  isbn ${pct(stats.noIsbn)}  year ${pct(stats.noYear)}
reference    ${((100 * stats.reference) / written).toFixed(1)}% non-circulating`);
