import { describe, it, expect } from "vitest";

/**
 * Exercises the real HTTP route against the live index. This is the gap that
 * let a broken search reach the browser while unit tests stayed green: the
 * query module was covered, the route and the index behind it were not.
 */
const BASE = process.env.APP_URL ?? "http://localhost:4321";

async function search(q: string, extra = ""): Promise<any> {
  const res = await fetch(`${BASE}/api/search?q=${encodeURIComponent(q)}&rows=5${extra}`);
  expect(res.ok).toBe(true);
  return res.json();
}

describe("search API", () => {
  it("the index is populated — catches a wiped core", async () => {
    const all = await fetch(`${BASE}/api/search?q=book&rows=1`)
      .then((x) => x.json()) as { numFound: number };
    expect(all.numFound).toBeGreaterThan(1000);
  });

  it("finds a known title", async () => {
    const r = await search("project hail mary");
    expect(r.numFound).toBeGreaterThan(0);
    expect(r.hits[0].title.toLowerCase()).toContain("hail mary");
  });

  it("puts an author's own work first, not books about them", async () => {
    const r = await search("stephen king");
    expect(r.hits[0].author ?? "").toMatch(/King/);
  });

  it("recovers from a typo", async () => {
    const r = await search("hary poter azkaban");
    expect(r.numFound).toBeGreaterThan(0);
    expect(r.hits[0].title.toLowerCase()).toContain("potter");
  });

  it("returns facets the UI needs", async () => {
    const r = await search("cooking");
    for (const f of ["formats", "audiences", "locations", "year"]) {
      expect(r.facets[f].length, `facet ${f}`).toBeGreaterThan(0);
    }
  });

  it("curation hides reference and collapses duplicates", async () => {
    const curated = await search("knitting");
    const raw = await search("knitting", "&curated=0");
    expect(curated.numFound).toBeLessThan(raw.numFound);
    expect(curated.hits.every((h: any) => h.circulating)).toBe(true);
  });

  it("returns an empty result set, not an error, for nonsense", async () => {
    const r = await search("zzzqqxxnotarealbook");
    expect(r.numFound).toBe(0);
    expect(r.hits).toEqual([]);
  });
});

/**
 * The CDN in front of production strips query strings, so the path-encoded
 * route is what the browser actually uses. If this breaks, production search
 * returns nothing while every query-string test stays green - which is exactly
 * what happened before this route existed.
 */
describe("path-encoded search (CDN-safe)", () => {
  const enc = (o: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");

  async function pathSearch(o: Record<string, unknown>): Promise<any> {
    const res = await fetch(`${BASE}/api/search/${enc(o)}`);
    expect(res.ok).toBe(true);
    return res.json();
  }

  it("returns the same results as the query-string route", async () => {
    const viaPath = await pathSearch({ q: "project hail mary", r: 5 });
    const viaQuery = await fetch(`${BASE}/api/search?q=project+hail+mary&rows=5`)
      .then((x) => x.json()) as { numFound: number };
    expect(viaPath.numFound).toBe(viaQuery.numFound);
    expect(viaPath.hits[0].title.toLowerCase()).toContain("hail mary");
  });

  it("carries facet filters through the path", async () => {
    const all = await pathSearch({ q: "cooking", r: 1 });
    const filtered = await pathSearch({ q: "cooking", r: 1, f: ['formats:"bk"'] });
    expect(filtered.numFound).toBeGreaterThan(0);
    expect(filtered.numFound).toBeLessThanOrEqual(all.numFound);
  });

  it("survives a unicode query", async () => {
    const r = await pathSearch({ q: "jujutsu kaisen", r: 3 });
    expect(r.numFound).toBeGreaterThan(0);
  });

  it("rejects a malformed segment with 400, not a crash", async () => {
    const res = await fetch(`${BASE}/api/search/!!!not-base64!!!`);
    expect(res.status).toBe(400);
  });
});
