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
    const r = await search("*");
    const all = await fetch(`${BASE}/api/search?q=book&rows=1`).then((x) => x.json());
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
