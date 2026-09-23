import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Must be set before importing the client, which reads it at module load.
process.env.SOLR_CORE = "bibs_test";
const { ping, add, select, deleteAll } = await import("../search/solr.js");

/**
 * Proves the ddev <-> Solr wiring end to end. If this fails, the environment
 * is broken, not the code. Run `ddev restart` before debugging anything else.
 */
describe("solr wiring", () => {
  beforeAll(async () => { await deleteAll(); });
  afterAll(async () => { await deleteAll(); });

  it("answers a ping", async () => {
    expect(await ping()).toBe(true);
  });

  it("round-trips a document", async () => {
    await add([{ id: "smoke-1", title_t: "Project Hail Mary" }]);
    const r = await select({ q: 'title_t:"Project Hail Mary"' });
    expect(r.response.numFound).toBe(1);
    expect(r.response.docs[0]?.id).toBe("smoke-1");
  });

  it("returns nothing for a miss", async () => {
    const r = await select({ q: "title_t:zzzznotathing" });
    expect(r.response.numFound).toBe(0);
  });
});

describe("deleteAll guard", () => {
  it("refuses to wipe a non-test core", async () => {
    // Regression: the integration suite once destroyed the live 'bibs' index
    // because it shared a core with the app. Never again.
    process.env.SOLR_CORE = "bibs";
    const live = await import("../search/solr.js?guard");
    await expect(live.deleteAll()).rejects.toThrow(/refusing to deleteAll/);
    process.env.SOLR_CORE = "bibs_test";
  });
});
