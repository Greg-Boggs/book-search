import { describe, it, expect } from "vitest";
import {
  stripIsbdTail, deinvertAuthor, parseYear, splitSubjects,
  isbn10to13, normalizeIsbns, parseItemType, isReferenceOrSerial,
} from "../ingest/normalize.js";

// Every fixture below is a real row from data/raw/spl-2026-09.csv.

describe("stripIsbdTail", () => {
  it("drops the statement of responsibility", () => {
    expect(stripIsbdTail("Project Hail Mary : a novel / Andy Weir."))
      .toBe("Project Hail Mary : a novel");
  });
  it("keeps internal colons but drops a trailing semicolon clause author", () => {
    expect(stripIsbdTail("Birdless summer : China : autobiography, history / Suyin Han."))
      .toBe("Birdless summer : China : autobiography, history");
  });
  it("handles the bracketed-translator case", () => {
    expect(stripIsbdTail("Rembrandt paintings. / [Translated by Heinz Norden."))
      .toBe("Rembrandt paintings");
  });
  it("leaves a title with no tail alone", () => {
    expect(stripIsbdTail("Wild dark shore")).toBe("Wild dark shore");
  });
});

describe("deinvertAuthor", () => {
  it("swaps and drops life dates", () => {
    expect(deinvertAuthor("Rawson, Philip, 1924-1995")).toBe("Philip Rawson");
  });
  it("handles an open-ended birth date", () => {
    expect(deinvertAuthor("Witzleben, Elisabeth von, 1905-")).toBe("Elisabeth von Witzleben");
  });
  it("handles no dates at all", () => {
    expect(deinvertAuthor("Weir, Andy")).toBe("Andy Weir");
  });
  it("passes a corporate name through", () => {
    expect(deinvertAuthor("Hakluyt Society")).toBe("Hakluyt Society");
  });
});

describe("parseYear", () => {
  it.each([
    ["[1968]", 1968],
    ["2026.", 2026],
    ["[2021]", 2021],
    ["1847-", 1847],
  ])("parses %s", (raw, want) => expect(parseYear(raw)).toBe(want));

  it("returns null when there is no year", () => {
    expect(parseYear("")).toBeNull();
    expect(parseYear("n.d.")).toBeNull();
  });
});

describe("splitSubjects", () => {
  it("splits the separator-stripped bag", () => {
    expect(splitSubjects("Erotic art East Asia, Art Asian"))
      .toEqual(["Erotic art East Asia", "Art Asian"]);
  });
  it("drops the trailing empty from SPL's trailing comma", () => {
    expect(splitSubjects("Science fiction, Apocalyptic fiction, "))
      .toEqual(["Science fiction", "Apocalyptic fiction"]);
  });
});

describe("isbn10to13", () => {
  it("converts and computes the check digit", () => {
    expect(isbn10to13("0593135202")).toBe("9780593135204");
  });
  it("handles a trailing X", () => {
    expect(isbn10to13("059335527X")).toBe("9780593355275");
  });
  it("rejects junk", () => {
    expect(isbn10to13("not-an-isbn")).toBeNull();
  });
});

describe("normalizeIsbns", () => {
  it("dedupes a mixed 10/13 list to ISBN-13", () => {
    // Real value for bib 3642327. The 10s collapse onto their own 13s.
    const got = normalizeIsbns(
      "0593135202, 059335527X, 9780593135204, 9780593135211, 9780593355275",
    );
    expect(got.sort()).toEqual(
      ["9780593135204", "9780593135211", "9780593355275"].sort(),
    );
  });
});

describe("parseItemType", () => {
  it("reads adult circulating book", () => {
    expect(parseItemType("acbk")).toEqual({
      audience: "adult", circulating: true, format: "bk",
    });
  });
  it("reads adult reference microform", () => {
    expect(parseItemType("armfc")).toEqual({
      audience: "adult", circulating: false, format: "mfc",
    });
  });
  it("reads juvenile circulating dvd", () => {
    expect(parseItemType("jcdvd")).toEqual({
      audience: "juvenile", circulating: true, format: "dvd",
    });
  });
});

describe("isReferenceOrSerial", () => {
  it.each(["arbk", "armfc", "arper"])("flags %s", (c) =>
    expect(isReferenceOrSerial(c)).toBe(true));
  it.each(["acbk", "jcbk", "accd"])("passes %s", (c) =>
    expect(isReferenceOrSerial(c)).toBe(false));
});

// ---------------------------------------------------------------------------

import { BibAccumulator, type SplRow } from "../ingest/bib.js";

function row(over: Partial<SplRow> = {}): SplRow {
  return {
    bibnum: "3642327",
    title: "Project Hail Mary : a novel / Andy Weir.",
    author: "Weir, Andy",
    isbn: "0593135202, 9780593135204",
    publicationyear: "[2021]",
    publisher: "Ballantine Books,",
    subjects: "Survival Fiction, Science fiction",
    itemtype: "acbk",
    itemcollection: "canf",
    floatingitem: "NA",
    itemlocation: "cen",
    reportdate: "2026-09-01T00:00:00.000",
    itemcount: "3",
    ...over,
  };
}

describe("BibAccumulator", () => {
  it("builds a clean doc from one row", () => {
    const d = new BibAccumulator(row()).build();
    expect(d.id).toBe("3642327");
    expect(d.title).toBe("Project Hail Mary : a novel");
    expect(d.author).toBe("Andy Weir");
    expect(d.author_inverted).toBe("Weir, Andy");
    expect(d.year).toBe(2021);
    expect(d.publisher).toBe("Ballantine Books");
    expect(d.copies).toBe(3);
    expect(d.circulating).toBe(true);
  });

  it("sums copies and unions locations across item rows", () => {
    const a = new BibAccumulator(row({ itemlocation: "cen", itemcount: "3" }));
    a.add(row({ itemlocation: "bal", itemcount: "2" }));
    a.add(row({ itemlocation: "cen", itemcount: "1" }));
    const d = a.build();
    expect(d.copies).toBe(6);
    expect(d.locations.sort()).toEqual(["bal", "cen"]);
  });

  it("collects distinct formats across item rows", () => {
    const a = new BibAccumulator(row({ itemtype: "acbk" }));
    a.add(row({ itemtype: "accd" }));
    a.add(row({ itemtype: "acbk" }));
    const d = a.build();
    expect(d.formats.sort()).toEqual(["bk", "cd"]);
  });

  it("is non-circulating when every item row is reference", () => {
    const a = new BibAccumulator(row({ itemtype: "arbk" }));
    a.add(row({ itemtype: "armfc" }));
    expect(a.build().circulating).toBe(false);
  });

  it("omits author entirely when absent", () => {
    const d = new BibAccumulator(row({ author: "" })).build();
    expect(d.author).toBeUndefined();
  });

  it("tolerates a bad itemcount", () => {
    expect(new BibAccumulator(row({ itemcount: "" })).build().copies).toBe(0);
  });
});

import { workKey } from "../ingest/normalize.js";

describe("workKey", () => {
  it("collapses format siblings of the same work", () => {
    const a = workKey("Project Hail Mary : a novel / Andy Weir.", "Weir, Andy, 1972-");
    const b = workKey("Project Hail Mary / by Andy Weir.", "Weir, Andy");
    expect(a).toBe(b);
  });
  it("ignores a leading article", () => {
    expect(workKey("The great Gatsby", "Fitzgerald, F. Scott"))
      .toBe(workKey("Great Gatsby", "Fitzgerald, F. Scott"));
  });
  it("keeps different works by the same author apart", () => {
    expect(workKey("The Martian", "Weir, Andy"))
      .not.toBe(workKey("Project Hail Mary", "Weir, Andy"));
  });
  it("keeps same-titled works by different authors apart", () => {
    expect(workKey("Ulysses", "Joyce, James"))
      .not.toBe(workKey("Ulysses", "Tennyson, Alfred"));
  });
});

describe("deinvertAuthor — messy real-world forms", () => {
  it.each([
    ["Fitzgerald, F. Scott (Francis Scott), 1896-1940", "F. Scott Fitzgerald"],
    ["Rombauer, Irma von Starkloff, 1877-1962", "Irma von Starkloff Rombauer"],
    ["Witzleben, Elisabeth von, 1905-", "Elisabeth von Witzleben"],
    ["Smith, John, approximately 1500-1560", "John Smith"],
    ["Doe, Jane, b. 1920", "Jane Doe"],
    ["Weir, Andy", "Andy Weir"],
    ["Hakluyt Society", "Hakluyt Society"],
    ["Morrison, Toni", "Toni Morrison"],
  ])("%s -> %s", (raw, want) => expect(deinvertAuthor(raw)).toBe(want));

  it("leaves no digits or parens behind", () => {
    const out = deinvertAuthor("Fitzgerald, F. Scott (Francis Scott), 1896-1940");
    expect(out).not.toMatch(/[\d()]/);
  });
});
