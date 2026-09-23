/**
 * Facet filters, built server-side from an allowlist.
 *
 * Client-supplied Solr `fq` strings were previously forwarded unchanged, which
 * let anyone run arbitrary filter queries against the index - including
 * function queries expensive enough to be an availability risk. Nothing the
 * client sends reaches Solr as syntax any more: it names a field and a value,
 * and we construct the filter.
 */

/** Only these may be filtered on, and only as exact terms. */
export const FACET_FIELDS = [
  "formats",
  "audiences",
  "locations",
  "itemtypes",
  "circulating",
] as const;

export type FacetField = (typeof FACET_FIELDS)[number];

const FIELD_SET = new Set<string>(FACET_FIELDS);

/** Solr query-parser metacharacters. */
function escapeTerm(v: string): string {
  return v.replace(/([+\-!(){}[\]^"~*?:\\/&|])/g, "\\$1");
}

export interface FacetSelection {
  field: string;
  value: string;
}

/**
 * Parses `field:value` from the client. Rejects unknown fields, over-long
 * values, and control characters. Returns only what survived, so hostile input
 * degrades to an unfiltered search rather than an error.
 */
export function parseSelections(raw: unknown): FacetSelection[] {
  if (!Array.isArray(raw)) return [];
  const out: FacetSelection[] = [];
  for (const item of raw.slice(0, 20)) {
    if (typeof item !== "string") continue;
    const i = item.indexOf(":");
    if (i <= 0) continue;
    const field = item.slice(0, i);
    // Values arrive quoted from the UI ( formats:"bk" ); tolerate either form.
    const value = item.slice(i + 1).replace(/^"|"$/g, "");
    if (!FIELD_SET.has(field)) continue;
    if (!value || value.length > 64) continue;
    // Reject control characters.
    if (/[\p{Cc}]/u.test(value)) continue;
    out.push({ field, value });
  }
  return out;
}

/** Renders validated selections as Solr filter queries. */
export function toFilterQueries(sel: FacetSelection[]): string[] {
  return sel.map((s) =>
    s.field === "circulating"
      ? `circulating:${s.value === "true"}`
      : `${s.field}:"${escapeTerm(s.value)}"`,
  );
}

export const LIMITS = {
  /** Longest accepted query string. */
  qMaxLength: 200,
  /** Deep paging is expensive and nothing legitimate needs it. */
  startMax: 1000,
  rowsMax: 100,
  /** Solr-side cap, so a pathological query cannot hold a thread open. */
  timeAllowedMs: 5000,
  /** Client-side cap on the whole round trip. */
  fetchTimeoutMs: 10000,
} as const;
