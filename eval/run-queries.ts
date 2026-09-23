/**
 * Runs real patron queries against our index and reports what fails.
 *
 *   ddev npm run eval -- data/work/queries.tsv 1000
 *
 * Reports both raw (per distinct query) and weighted (per actual search) rates,
 * because a miss on a query typed 2,000 times is not the same as one typed 5.
 */
import { readFile, writeFile } from "node:fs/promises";

const BASE = process.env.APP_URL ?? "http://localhost:4321";
const [file, limitArg] = process.argv.slice(2);
const LIMIT = Number(limitArg ?? 500);

const rows = (await readFile(file ?? "data/work/queries.tsv", "utf8"))
  .trim().split("\n")
  .map((l) => { const [q, n] = l.split("\t"); return { q: q!, n: Number(n) }; })
  .slice(0, LIMIT);

interface Res { q: string; n: number; found: number; fuzzy: boolean; top: string }

async function run(q: string, curated: boolean): Promise<Omit<Res, "q" | "n">> {
  const u = `${BASE}/api/search?q=${encodeURIComponent(q)}&rows=1${curated ? "" : "&curated=0"}`;
  const r = await fetch(u).then((x) => x.json()) as any;
  return { found: r.numFound, fuzzy: r.fuzzy, top: r.hits?.[0]?.title ?? "" };
}

async function sweep(curated: boolean): Promise<Res[]> {
  const out: Res[] = [];
  for (const { q, n } of rows) {
    try { out.push({ q, n, ...(await run(q, curated)) }); }
    catch { out.push({ q, n, found: -1, fuzzy: false, top: "ERROR" }); }
  }
  return out;
}

function report(label: string, res: Res[]): void {
  const totalN = res.reduce((s, r) => s + r.n, 0);
  const zero = res.filter((r) => r.found === 0);
  const zeroN = zero.reduce((s, r) => s + r.n, 0);
  const thin = res.filter((r) => r.found > 0 && r.found < 3).length;
  const fz = res.filter((r) => r.fuzzy).length;
  console.log(`
${label}
  queries tested     ${res.length.toLocaleString()}  (${totalN.toLocaleString()} real searches)
  zero results       ${zero.length} (${(100 * zero.length / res.length).toFixed(1)}% of queries)
  zero, weighted     ${zeroN.toLocaleString()} (${(100 * zeroN / totalN).toFixed(1)}% of searches)
  1-2 results only   ${thin}
  needed fuzzy       ${fz}`);
}

const curated = await sweep(true);
report("CURATED (what the demo shows)", curated);
const raw = await sweep(false);
report("UNCURATED (whole collection)", raw);

const misses = curated
  .filter((r) => r.found === 0)
  .sort((a, b) => b.n - a.n);
await writeFile(
  "data/work/zero-results.tsv",
  misses.map((r) => `${r.n}\t${r.q}`).join("\n") + "\n",
);
console.log(`\ntop misses (curated):`);
for (const m of misses.slice(0, 25)) console.log(`  ${String(m.n).padStart(5)}  ${m.q}`);
console.log(`\nfull list -> data/work/zero-results.tsv`);
