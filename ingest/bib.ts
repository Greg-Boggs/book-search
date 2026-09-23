import {
  stripIsbdTail, deinvertAuthor, parseYear, splitSubjects,
  normalizeIsbns, parseItemType, workKey,
} from "./normalize.js";

/** One row of the SPL CSV. */
export interface SplRow {
  bibnum: string; title: string; author: string; isbn: string;
  publicationyear: string; publisher: string; subjects: string;
  itemtype: string; itemcollection: string; floatingitem: string;
  itemlocation: string; reportdate: string; itemcount: string;
}

/** One Solr document: a bib, with its item rows rolled up. */
export interface BibDoc {
  id: string;
  title: string;
  title_full: string;
  author?: string;
  author_inverted?: string;
  subjects: string[];
  publisher?: string;
  year?: number;
  isbn: string[];
  itemtypes: string[];
  formats: string[];
  audiences: string[];
  locations: string[];
  copies: number;
  circulating: boolean;
  work_key: string;
  has_cover: boolean;
}

/** Accumulates item rows for a single bib. */
export class BibAccumulator {
  private readonly itemtypes = new Set<string>();
  private readonly locations = new Set<string>();
  private copies = 0;
  private circulating = false;
  private first: SplRow;

  constructor(row: SplRow) {
    this.first = row;
    this.add(row);
  }

  add(row: SplRow): void {
    const t = row.itemtype.trim();
    if (t) this.itemtypes.add(t);
    const loc = row.itemlocation.trim();
    if (loc) this.locations.add(loc);
    const n = Number.parseInt(row.itemcount, 10);
    this.copies += Number.isFinite(n) ? n : 0;
    if (t && parseItemType(t).circulating) this.circulating = true;
  }

  build(): BibDoc {
    const r = this.first;
    const types = [...this.itemtypes];
    const parsed = types.map(parseItemType);
    const author = r.author.trim();
    const doc: BibDoc = {
      id: r.bibnum,
      title: stripIsbdTail(r.title),
      title_full: r.title.trim(),
      subjects: splitSubjects(r.subjects),
      isbn: normalizeIsbns(r.isbn),
      itemtypes: types,
      formats: [...new Set(parsed.map((p) => p.format))],
      audiences: [...new Set(parsed.map((p) => p.audience))],
      locations: [...this.locations],
      copies: this.copies,
      circulating: this.circulating,
      work_key: "",
      has_cover: false,
    };
    if (author) {
      doc.author = deinvertAuthor(author);
      doc.author_inverted = author;
    }
    // Demo surfaces cover-bearing records first; an ISBN is our proxy for one.
    doc.has_cover = doc.isbn.length > 0;
    doc.work_key = workKey(r.title, author) || r.bibnum;
    const pub = r.publisher.trim().replace(/[,;]\s*$/, "");
    if (pub) doc.publisher = pub;
    const y = parseYear(r.publicationyear);
    if (y !== null) doc.year = y;
    return doc;
  }
}
