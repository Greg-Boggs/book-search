/**
 * SPL CSV normalization. These quirks are documented in BRIEF.md and they
 * matter for relevance, not just tidiness.
 */

/** `Project Hail Mary : a novel / Andy Weir.` -> `Project Hail Mary : a novel` */
export function stripIsbdTail(title: string): string {
  const t = title.split(" / ")[0] ?? title;
  return t.replace(/\s*[.;,]\s*$/, "").trim();
}

/**
 * `Rawson, Philip, 1924-1995` -> `Philip Rawson`.
 * `Fitzgerald, F. Scott (Francis Scott), 1896-1940` -> `F. Scott Fitzgerald`.
 * Corporate and single-element names pass through unchanged.
 */
export function deinvertAuthor(author: string): string {
  let s = author.trim();

  // Parenthetical name expansions add a second comma and break naive splitting.
  s = s.replace(/\s*\([^)]*\)/g, "");

  // Life dates in their various cataloguing forms, always at the end.
  s = s
    .replace(/,?\s*(b\.|d\.|fl\.|ca\.|approximately)?\s*\d{3,4}\??\s*-\s*(ca\.\s*)?(\d{3,4})?\??\.?\s*$/i, "")
    .replace(/,?\s*(b\.|d\.|fl\.)\s*\d{3,4}\??\.?\s*$/i, "")
    .replace(/[,.]\s*$/, "")
    .trim();

  // Split on the FIRST comma only: everything after it is the forename part.
  const i = s.indexOf(",");
  if (i === -1) return s;
  const last = s.slice(0, i).trim();
  const first = s.slice(i + 1).trim();
  if (!last || !first) return s.replace(/,/g, " ").replace(/\s+/g, " ").trim();
  return `${first} ${last}`;
}

/** `[1968]` / `2026.` / `1847-` -> 1968 / 2026 / 1847. Null when absent or implausible. */
export function parseYear(raw: string): number | null {
  const m = raw.match(/(\d{4})/);
  if (!m?.[1]) return null;
  const y = Number(m[1]);
  return y >= 1000 && y <= 2100 ? y : null;
}

/**
 * SPL stripped the `--` subfield separators, so subjects arrive as a flat
 * comma-separated bag. Best we can do is split and trim.
 */
export function splitSubjects(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** ISBN-10 -> ISBN-13. Returns null if not a valid-shaped ISBN-10. */
export function isbn10to13(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/[-\s]/g, "");
  if (!/^\d{9}[\dX]$/.test(s)) return null;
  const core = "978" + s.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (i % 2 === 0 ? 1 : 3) * Number(core[i]);
  return core + String((10 - (sum % 10)) % 10);
}

/** Normalizes SPL's mixed ISBN-10/13 comma list to a deduped ISBN-13 set. */
export function normalizeIsbns(raw: string): string[] {
  const out = new Set<string>();
  for (const part of raw.split(",")) {
    const s = part.trim().toUpperCase().replace(/[-\s]/g, "");
    if (/^\d{13}$/.test(s)) out.add(s);
    else {
      const c = isbn10to13(s);
      if (c) out.add(c);
    }
  }
  return [...out];
}

export interface ItemType {
  audience: "adult" | "juvenile" | "other";
  circulating: boolean;
  format: string;
}

/** `acbk` -> adult / circulating / bk. `armfc` -> adult / reference / mfc. */
export function parseItemType(code: string): ItemType {
  const c = code.trim().toLowerCase();
  const audience = c[0] === "a" ? "adult" : c[0] === "j" ? "juvenile" : "other";
  const circulating = c[1] === "c";
  return { audience, circulating, format: c.slice(2) || "unknown" };
}

/** Reference, microform and periodicals are ~23% of item rows. */
export function isReferenceOrSerial(code: string): boolean {
  const t = parseItemType(code);
  return !t.circulating || t.format === "mfc" || t.format === "per";
}

/**
 * Grouping key so format siblings (book / large print / paperback / audio)
 * collapse into one result, the way patrons expect. Built from the title up to
 * its subtitle plus the author's surname - deliberately conservative, since
 * over-merging hides genuinely different works.
 */
export function workKey(title: string, author: string | undefined): string {
  const t = stripIsbdTail(title)
    .split(/\s+[:;]\s+/)[0]!
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(a|an|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const surname = (author ?? "")
    .split(",")[0]!
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return t ? `${t}|${surname}` : "";
}
