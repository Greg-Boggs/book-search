/**
 * Post-deploy smoke test: drives the DEPLOYED page in a DOM and asserts a real
 * search renders results.
 *
 *   node deploy/smoke.mjs https://books.gregboggs.com
 *
 * Why this and not the helper-name grep in update.sh: checking that functions
 * are defined cannot prove search works. And the vitest browser test runs
 * against the dev server, while production serves a minified build - those
 * differ, and only this exercises what patrons actually load.
 */
import { JSDOM } from "jsdom";

const BASE = (process.argv[2] ?? "http://127.0.0.1:4321").replace(/\/$/, "");
const fail = (m) => { console.error(`FAILED: ${m}`); process.exit(1); };

// Cloudflare varies its content-encoding per edge node and Node's fetch does
// not decode zstd, which silently yields binary instead of HTML. Pin identity.
const H = { "Accept-Encoding": "identity" };

const res = await fetch(BASE, { headers: H }).catch((e) => fail(`cannot reach ${BASE}: ${e.message}`));
if (!res.ok) fail(`${BASE} returned HTTP ${res.status}`);
const html = await res.text();
if (!html.trimStart().startsWith("<!")) fail("response is not HTML (encoding problem?)");

const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: BASE });
const w = dom.window;
await new Promise((r) => (w.document.readyState === "complete" ? r() : w.addEventListener("load", r)));

w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
class StubImage {
  naturalWidth = 200; onload = null; onerror = null;
  set src(_v) { setTimeout(() => this.onload?.(), 0); }
}
w.Image = StubImage;
w.fetch = (u, o) => fetch(new URL(u, BASE).href, { ...o, headers: { ...(o?.headers ?? {}), ...H } });

const errors = [];
w.addEventListener("error", (e) => errors.push(e.message));

const input = w.document.getElementById("q") || fail("no search input on the page");
input.value = "project hail mary";
if (typeof w.go !== "function") fail("the page script did not define go()");
await w.go();
await new Promise((r) => setTimeout(r, 5000));

if (errors.length) fail(`uncaught errors in the page: ${errors.join("; ")}`);

const cards = w.document.querySelectorAll(".card").length;
if (cards < 1) fail("search returned no rendered results");

const title = w.document.querySelector(".card .title")?.textContent?.trim() ?? "";
if (!/hail mary/i.test(title)) fail(`unexpected first result: ${title}`);

const facets = w.document.querySelectorAll("#facets button").length;
if (facets < 1) fail("no facets rendered");

console.log(`smoke ok: ${cards} results, first "${title}", ${facets} facets, no page errors`);
