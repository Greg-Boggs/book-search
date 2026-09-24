import { describe, it, expect, beforeAll } from "vitest";
import { JSDOM } from "jsdom";

/**
 * Executes the page's client script the way a browser would.
 *
 * This exists because a refactor once deleted four helpers that `go()` still
 * called. Every API test stayed green while the browser threw
 * "ReferenceError: startWorking is not defined" before a single request was
 * made. An API that answers correctly says nothing about whether the page works.
 */
const BASE = process.env.APP_URL ?? "http://localhost:4321";

let html: string;

beforeAll(async () => {
  html = await fetch(BASE).then((r) => r.text());
});

/** Loads the page, stubs fetch with a fixed payload, and returns the window. */
async function boot(payload: unknown) {
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: BASE,
  });
  const w = dom.window as unknown as Window & typeof globalThis & Record<string, unknown>;

  // Covers are fetched from third parties; never reach out from a test.
  class StubImage {
    naturalWidth = 200;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) {
      setTimeout(() => this.onload?.(), 0);
    }
  }
  (w as Record<string, unknown>).Image = StubImage;
  // jsdom implements no matchMedia; real browsers do.
  (w as Record<string, unknown>).matchMedia = (q: string) => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {},
  });
  (w as Record<string, unknown>).fetch = () =>
    Promise.resolve({ json: () => Promise.resolve(payload) });

  await new Promise((r) => setTimeout(r, 50));
  return w;
}

function hit(over: Record<string, unknown> = {}) {
  return {
    id: "1",
    title: "Joy of cooking",
    title_full: "Joy of cooking",
    author: "Irma S. Rombauer",
    year: 1997,
    publisher: "Scribner",
    subjects: ["Cooking American"],
    formats: ["bk"],
    locations: ["cen"],
    isbn: ["9780684818702"],
    copies: 12,
    circulating: true,
    ...over,
  };
}

const payload = (hits: unknown[], numFound = hits.length) => ({
  hits,
  numFound,
  qtime: 12,
  fuzzy: false,
  facets: {
    formats: [["bk", 9000]],
    audiences: [["adult", 8000]],
    locations: [["cen", 500]],
    circulating: [["true", 9168]],
    year: [["2010", 400]],
  },
});

describe("page script", () => {
  it("defines every helper the search path calls", async () => {
    const w = await boot(payload([hit()]));
    // Only `function` declarations become window properties in a classic
    // script; `const` arrow helpers (sleep, esc) are covered by the
    // end-to-end test below, which throws ReferenceError if any are missing.
    for (const fn of [
      "go", "startWorking", "encodeSearch", "resolveCovers",
      "coverSources", "renderFacets", "setCount", "card",
    ]) {
      expect(typeof w[fn], `${fn} is missing from the page script`).toBe("function");
    }
  });

  it("runs a search end to end and renders results", async () => {
    const w = await boot(payload([hit(), hit({ id: "2", title: "What's cooking?" })], 9168));
    const errors: string[] = [];
    w.addEventListener("error", (e) => errors.push(String((e as ErrorEvent).message)));

    (w.document.getElementById("q") as HTMLInputElement).value = "cooking";
    await (w.go as () => Promise<void>)();
    await new Promise((r) => setTimeout(r, 1400));

    expect(errors, "uncaught errors during search").toEqual([]);
    expect(w.document.querySelectorAll(".card").length).toBe(2);
    expect(w.document.querySelector(".card .title")?.textContent).toContain("Joy of cooking");
    expect(w.document.getElementById("working")?.hasAttribute("hidden")).toBe(true);
  });

  it("renders facets without executing catalogue data as markup", async () => {
    // A branch code containing an apostrophe previously broke out of a
    // single-quoted attribute and became an event handler.
    const evil = `cen' onclick='window.__pwned=1`;
    const w = await boot({
      ...payload([hit()]),
      facets: { formats: [["bk", 1]], audiences: [], locations: [[evil, 3]], circulating: [], year: [] },
    });
    (w.document.getElementById("q") as HTMLInputElement).value = "cooking";
    await (w.go as () => Promise<void>)();
    await new Promise((r) => setTimeout(r, 1400));

    expect(w.__pwned).toBeUndefined();
    const btn = [...w.document.querySelectorAll("#facets button")]
      .find((b) => (b as HTMLElement).dataset.f?.includes("onclick"));
    expect(btn, "the hostile facet should still render, as inert text").toBeTruthy();
    expect(btn?.querySelector("span")?.textContent).toContain("onclick");
  });

  it("shows a designed empty state rather than a blank page", async () => {
    const w = await boot(payload([], 0));
    (w.document.getElementById("q") as HTMLInputElement).value = "zzzznotathing";
    await (w.go as () => Promise<void>)();
    await new Promise((r) => setTimeout(r, 1400));

    expect(w.document.getElementById("empty")?.hasAttribute("hidden")).toBe(false);
    expect(w.document.getElementById("empty")?.textContent).toContain("Nothing matched");
  });
});
