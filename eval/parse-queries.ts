/**
 * GA4 export of BiblioCommons search page paths -> a clean, aggregated query list.
 *
 *   ddev npm run queries -- "<export.csv>" data/work/queries.tsv
 *
 * Privacy: the export is already aggregated (query + event count, no sessions,
 * no identifiers). We additionally drop anything seen fewer than K times, so a
 * one-off search that might identify a person never lands on disk.
 */
import { createReadStream } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname } from "node:path";

const K_ANON = 5;

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: parse-queries.ts <ga4-export.csv> <out.tsv>');
  process.exit(1);
}

export interface QueryRow { q: string; n: number; }

/** Splits a CSV line, honouring quoted fields. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === "," && !inQ) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Pulls the free-form query out of a BiblioCommons search path.
 * Returns null for anything that is not a typed query: browse shelves,
 * facet-only navigation, and the `nw:[0 TO 180]` newly-acquired feeds.
 */
export function extractQuery(path: string): string | null {
  const qs = path.indexOf("?");
  if (qs === -1) return null;
  const p = new URLSearchParams(path.slice(qs + 1));
  // searchType=bl is a browse list, not something a patron typed.
  if (p.get("searchType") !== "smart") return null;
  let q = p.get("query");
  if (!q) return null;
  // Fielded//range syntax means the UI built it, not a person.
  if (/\b\w+:\[|\b(nw|f_|title_key)\b/.test(q)) return null;
  q = q.trim().replace(/\s+/g, " ");
  if (!q || q.length > 120) return null;
  return q;
}

await mkdir(dirname(output), { recursive: true });

const counts = new Map<string, number>();
let rows = 0, kept = 0, browse = 0;

const rl = createInterface({ input: createReadStream(input), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line || line.startsWith("#")) continue;
  const cells = splitCsv(line);
  const path = cells[0] ?? "";
  if (!path.startsWith("/v2/search")) continue;
  rows++;
  const n = Number.parseInt(cells[2] ?? "0", 10) || 0;
  const q = extractQuery(path);
  if (q === null) { browse++; continue; }
  // Case-fold: "Yesteryear" and "yesteryear" are the same intent.
  const key = q.toLowerCase();
  counts.set(key, (counts.get(key) ?? 0) + n);
  kept++;
}

const all = [...counts.entries()].map(([q, n]) => ({ q, n }));
const safe = all.filter((r) => r.n >= K_ANON).sort((a, b) => b.n - a.n);

await writeFile(output, safe.map((r) => `${r.q}\t${r.n}`).join("\n") + "\n");

const total = safe.reduce((s, r) => s + r.n, 0);
console.error(`
search rows      ${rows.toLocaleString()}
  browse/facet   ${browse.toLocaleString()} (discarded - not typed by a person)
  free-form      ${kept.toLocaleString()}
distinct queries ${all.length.toLocaleString()}
  >= ${K_ANON} uses      ${safe.length.toLocaleString()}  -> ${output}
  searches kept  ${total.toLocaleString()}`);
