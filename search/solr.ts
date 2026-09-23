/** Minimal Solr client. Inside ddev the default host is the `solr` service. */
const BASE = process.env.SOLR_URL ?? "http://solr:8983/solr";
const CORE = process.env.SOLR_CORE ?? "bibs";

export interface SolrDoc { [k: string]: unknown }

export interface SelectResponse<T = SolrDoc> {
  responseHeader: { status: number; QTime: number };
  response: { numFound: number; start: number; docs: T[] };
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/${CORE}${path}`, init);
  if (!res.ok) throw new Error(`solr ${res.status} ${res.statusText} on ${path}`);
  return res.json() as Promise<T>;
}

export async function ping(): Promise<boolean> {
  const r = await req<{ status: string }>("/admin/ping?wt=json");
  return r.status === "OK";
}

export async function select<T = SolrDoc>(
  params: Record<string, string | number>,
): Promise<SelectResponse<T>> {
  const q = new URLSearchParams({ wt: "json", ...mapValues(params) });
  return req<SelectResponse<T>>(`/select?${q}`);
}

export async function add(docs: SolrDoc[], commit = true): Promise<void> {
  await req(`/update?commit=${commit}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(docs),
  });
}

/**
 * Wipes a core. Guarded: this once destroyed the live index because the
 * integration tests ran against 'bibs'. It now refuses any core that is not
 * explicitly a test core.
 */
export async function deleteAll(): Promise<void> {
  if (!/_test$/.test(CORE)) {
    throw new Error(
      `refusing to deleteAll() on core "${CORE}" - only *_test cores may be wiped`,
    );
  }
  await req(`/update?commit=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ delete: { query: "*:*" } }),
  });
}

function mapValues(o: Record<string, string | number>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]));
}
