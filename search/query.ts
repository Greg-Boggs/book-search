/** Query construction and the fuzzy fallback. */
import { parseSelections, toFilterQueries, LIMITS } from "./filters.js";
const BASE = process.env.SOLR_URL ?? "http://solr:8983/solr";
const CORE = process.env.SOLR_CORE ?? "bibs";

export interface Hit {
  id: string; title: string; title_full?: string;
  author?: string; year?: number; publisher?: string;
  subjects?: string[]; formats?: string[]; locations?: string[];
  isbn?: string[]; copies?: number; circulating?: boolean;
  score?: number;
}

export interface SearchResult {
  hits: Hit[];
  numFound: number;
  qtime: number;
  fuzzy: boolean;
  facets: Record<string, [string, number][]>;
}

export interface SearchOpts {
  q: string;
  rows?: number;
  start?: number;
  /**
   * Facet selections as `field:value`. Validated against an allowlist and
   * rendered into Solr syntax server-side - never forwarded as raw `fq`.
   */
  filters?: string[];
  /**
   * Demo curation: hide reference/microform/periodicals, collapse format
   * siblings, prefer records that have cover art. On for the demo, OFF for
   * evaluation - the number has to be measured against the whole collection,
   * not the flattering slice of it.
   */
  curated?: boolean;
}

const QF = [
  "title^12", "title_ngram^3",
  "author^8", "author_ngram^2",
  "subjects^3", "publisher^1", "text^1",
].join(" ");

/**
 * Require every term up to 5, then allow slack. Catalog queries are short and
 * deliberate: dropping a term from "project hail mary" surfaces craft books
 * that merely contain "mary".
 */
const MM = "5<-1 8<-2";

function params(o: SearchOpts, q: string, mm: string): URLSearchParams {
  const curated = o.curated !== false;
  const p = new URLSearchParams({
    q,
    defType: "edismax",
    qf: QF,
    // An exact author-name phrase is a strong statement of intent: someone typing
    // "stephen king" wants his novels, not biographies of him.
    pf: "title^25 author^45",
    ps: "1",
    mm,
    // Copies held is a librarian-curated demand signal. Multiplicative and
    // log-damped so it breaks ties without outranking a better match.
    // NOT scale() - that scans the whole index on every query.
    boost: curated
      ? "product(log(sum(def(copies,0),2)),if(has_cover,1.25,1))"
      : "log(sum(def(copies,0),2))",
    rows: String(Math.min(Math.max(o.rows ?? 24, 1), LIMITS.rowsMax)),
    start: String(Math.min(Math.max(o.start ?? 0, 0), LIMITS.startMax)),
    // Server-side ceiling so no single query can pin a Solr thread.
    timeAllowed: String(LIMITS.timeAllowedMs),
    fl: "id,title,title_full,author,year,publisher,subjects,formats,locations,isbn,copies,circulating,score",
    wt: "json",
    "facet": "true",
    "facet.mincount": "1",
    "facet.limit": "12",
  });
  for (const f of ["formats", "audiences", "locations", "circulating"]) p.append("facet.field", f);
  p.append("facet.range", "year");
  p.set("f.year.facet.range.start", "1900");
  p.set("f.year.facet.range.end", "2030");
  p.set("f.year.facet.range.gap", "10");
  if (curated) {
    // Circulating only: drops reference, microform and periodicals, which are
    // ~30% of bibs and account for most of the ugly results.
    p.append("fq", "circulating:true");
    // One row per work, keeping the copy most likely to look good.
    p.append("fq", "{!collapse field=work_key sort='has_cover desc,copies desc'}");
  }
  // Built here from validated selections; the client never supplies Solr syntax.
  for (const f of toFilterQueries(parseSelections(o.filters))) p.append("fq", f);
  return p;
}

/** Appends ~1 to each term so transpositions still land. */
function fuzzify(q: string): string {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => {
      if (!/^[\p{L}\d]+$/u.test(t)) return t;
      // ~1 covers transpositions and single slips, which is what real typos
      // are. ~2 drags in product/protect/proctor and wrecks precision.
      return t.length >= 4 ? `${t}~1` : t;
    })
    .join(" ");
}

async function run(p: URLSearchParams): Promise<any> {
  const res = await fetch(`${BASE}/${CORE}/select?${p}`, {
    signal: AbortSignal.timeout(LIMITS.fetchTimeoutMs),
  });
  if (!res.ok) throw new Error(`solr ${res.status}`);
  return res.json();
}

function readFacets(j: any): Record<string, [string, number][]> {
  const out: Record<string, [string, number][]> = {};
  const ff = j.facet_counts?.facet_fields ?? {};
  for (const [name, flat] of Object.entries(ff as Record<string, unknown[]>)) {
    const pairs: [string, number][] = [];
    for (let i = 0; i < flat.length; i += 2) {
      pairs.push([String(flat[i]), Number(flat[i + 1])]);
    }
    out[name] = pairs;
  }
  const yr = j.facet_counts?.facet_ranges?.year?.counts as unknown[] | undefined;
  if (yr) {
    const pairs: [string, number][] = [];
    for (let i = 0; i < yr.length; i += 2) pairs.push([String(yr[i]), Number(yr[i + 1])]);
    out["year"] = pairs;
  }
  return out;
}

export async function search(o: SearchOpts): Promise<SearchResult> {
  // Bound the input before it reaches the query parser.
  const q = o.q.trim().slice(0, LIMITS.qMaxLength);
  if (!q) return { hits: [], numFound: 0, qtime: 0, fuzzy: false, facets: {} };

  let j = await run(params(o, q, MM));
  let fuzzy = false;

  // Too few results usually means a typo, not an empty collection.
  if (j.response.numFound < 3) {
    const alt = await run(params(o, fuzzify(q), "5<-1 8<-2"));
    if (alt.response.numFound > j.response.numFound) {
      j = alt;
      fuzzy = true;
    }
  }

  return {
    hits: j.response.docs as Hit[],
    numFound: j.response.numFound,
    qtime: j.responseHeader.QTime,
    fuzzy,
    facets: readFacets(j),
  };
}
