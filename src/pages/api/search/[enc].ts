import type { APIRoute } from "astro";
import { search } from "../../../../search/query.js";
import { decodeParams } from "../../../../search/params.js";

export const prerender = false;

/**
 * Path-encoded search: /api/search/<base64url-json>
 *
 * The query-string form at /api/search?q=... still works and is what tests and
 * direct-to-origin calls use. This variant exists because the CDN in front of
 * production strips query strings before they reach us.
 */
export const GET: APIRoute = async ({ params }) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });

  let p;
  try {
    p = decodeParams(params.enc ?? "");
  } catch {
    return json({ error: "malformed search parameters" }, 400);
  }

  try {
    return json(await search({
      q: p.q,
      rows: Math.min(p.rows ?? 24, 100),
      start: Math.max(p.start ?? 0, 0),
      filters: p.fq ?? [],
      curated: p.curated,
    }));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "search failed" }, 502);
  }
};
