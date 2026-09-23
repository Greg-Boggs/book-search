/**
 * Search parameters encoded into a single URL path segment.
 *
 * Our CDN is configured to strip query strings before requests reach the
 * origin - a deliberate, fleet-wide setting we do not control. So nothing may
 * depend on `?a=b`. Everything the API needs travels in the path instead,
 * which also gives each distinct search its own cache key for free.
 */
export interface SearchParams {
  q: string;
  rows?: number;
  start?: number;
  fq?: string[];
  curated?: boolean;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Base64url of the JSON, so unicode queries and filter arrays survive intact. */
export function encodeParams(p: SearchParams): string {
  const compact: Record<string, unknown> = { q: p.q };
  if (p.rows !== undefined) compact.r = p.rows;
  if (p.start) compact.s = p.start;
  if (p.fq?.length) compact.f = p.fq;
  if (p.curated === false) compact.c = 0;
  return toBase64Url(new TextEncoder().encode(JSON.stringify(compact)));
}

export function decodeParams(seg: string): SearchParams {
  const raw = JSON.parse(new TextDecoder().decode(fromBase64Url(seg))) as Record<string, unknown>;
  return {
    q: typeof raw.q === "string" ? raw.q : "",
    rows: typeof raw.r === "number" ? raw.r : undefined,
    start: typeof raw.s === "number" ? raw.s : undefined,
    fq: Array.isArray(raw.f) ? (raw.f as string[]).filter((x) => typeof x === "string") : undefined,
    curated: raw.c === 0 ? false : undefined,
  };
}
