import type { APIRoute } from "astro";
import { search } from "../../../search/query.js";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get("q") ?? "";
  const rows = Math.min(Number(url.searchParams.get("rows") ?? 24), 100);
  const start = Math.max(Number(url.searchParams.get("start") ?? 0), 0);
  const filters = url.searchParams.getAll("fq");
  const curated = url.searchParams.get("curated") !== "0";

  try {
    const r = await search({ q, rows, start, filters, curated });
    return new Response(JSON.stringify(r), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "search failed" }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
};
