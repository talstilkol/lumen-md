/**
 * Tests for the lightweight BibTeX parser. Covers the common subset:
 * entry-type detection, braced + quoted + bare values, comment stripping,
 * `~` non-breaking-space normalization, and the formatEntry pretty-printer.
 */

import { describe, it, expect } from "vitest";
import { parseBibtex, formatEntry } from "../data/bibtex";

describe("parseBibtex", () => {
  it("parses a single article entry with braced fields", () => {
    const src = `@article{einstein1905,
  author = {Albert Einstein},
  title  = {Zur Elektrodynamik bewegter Körper},
  journal= {Annalen der Physik},
  year   = {1905}
}`;
    const [e] = parseBibtex(src);
    expect(e.type).toBe("article");
    expect(e.key).toBe("einstein1905");
    expect(e.fields.author).toBe("Albert Einstein");
    expect(e.fields.title).toBe("Zur Elektrodynamik bewegter Körper");
    expect(e.fields.journal).toBe("Annalen der Physik");
    expect(e.fields.year).toBe("1905");
  });

  it("parses multiple entries from one file", () => {
    const src = `@book{turing1936,
  author = {Alan Turing},
  title  = {On Computable Numbers},
  year   = {1936}
}
@article{shannon1948,
  author = {Claude Shannon},
  title  = {A Mathematical Theory of Communication},
  year   = {1948}
}`;
    const entries = parseBibtex(src);
    expect(entries).toHaveLength(2);
    expect(entries[0].key).toBe("turing1936");
    expect(entries[1].key).toBe("shannon1948");
  });

  it("supports both quoted and braced field values", () => {
    const src = `@misc{x,
  author = "Quoted Author",
  title  = {Braced Title},
  year   = {2026}
}`;
    const [e] = parseBibtex(src);
    expect(e.fields.author).toBe("Quoted Author");
    expect(e.fields.title).toBe("Braced Title");
  });

  it("normalizes BibTeX `~` non-breaking-space markers to plain spaces", () => {
    const src = `@misc{x,
  author = {John~Doe and Jane~Smith},
  year   = {2026}
}`;
    const [e] = parseBibtex(src);
    expect(e.fields.author).toBe("John Doe and Jane Smith");
  });

  it("ignores @comment / @string / @preamble pseudo-entries when parseable", () => {
    // Each pseudo-entry must contain a comma to satisfy the regex shape;
    // they're then dropped by type, and the real article remains.
    const src = `@string{abbr,
  field = {value}
}
@article{real1999,
  title = {Real},
  year  = {1999}
}`;
    const entries = parseBibtex(src);
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe("real1999");
  });

  it("strips line-comments (% to end of line)", () => {
    const src = `% this is a comment
@misc{x,
  title = {Hello},
  year  = {2026}
}`;
    const entries = parseBibtex(src);
    expect(entries).toHaveLength(1);
    expect(entries[0].fields.title).toBe("Hello");
  });

  it("returns an empty list for input with no @-entries", () => {
    expect(parseBibtex("just plain text")).toEqual([]);
    expect(parseBibtex("")).toEqual([]);
  });

  it("lowercases field names so @Article{X,Title=...} works", () => {
    const src = `@Article{x,
  Title = {Mixed Case},
  YEAR  = {2026}
}`;
    const [e] = parseBibtex(src);
    expect(e.fields.title).toBe("Mixed Case");
    expect(e.fields.year).toBe("2026");
  });
});

describe("formatEntry", () => {
  it("renders [n], author, title, venue, year in order", () => {
    const e = {
      type: "article",
      key: "einstein1905",
      fields: {
        author: "Albert Einstein",
        title: "Zur Elektrodynamik bewegter Körper",
        journal: "Annalen der Physik",
        year: "1905",
      },
    };
    const out = formatEntry(e, 1);
    expect(out).toMatch(/^\[1\]/);
    expect(out).toContain("Albert Einstein");
    expect(out).toContain('"Zur Elektrodynamik');
    expect(out).toContain("Annalen der Physik");
    expect(out).toContain("1905");
  });

  it("joins multiple authors using ` and ` correctly", () => {
    const e = {
      type: "article",
      key: "x",
      fields: {
        author: "Alice and Bob and Carol",
        title: "Trio",
        year: "2026",
      },
    };
    expect(formatEntry(e, 1)).toContain("Alice, Bob, Carol");
  });

  it("falls back through journal → booktitle → publisher → school → institution", () => {
    const e = {
      type: "techreport",
      key: "x",
      fields: {
        author: "Author",
        title: "Title",
        institution: "MIT",
        year: "2026",
      },
    };
    expect(formatEntry(e, 1)).toContain("MIT");
  });

  it("includes pages, doi, and url when present", () => {
    const e = {
      type: "article",
      key: "x",
      fields: {
        author: "A",
        title: "T",
        year: "2026",
        pages: "1--10",
        doi: "10.1000/xyz",
        url: "https://example.com",
      },
    };
    const out = formatEntry(e, 5);
    expect(out).toContain("pp. 1--10");
    expect(out).toContain("doi:10.1000/xyz");
    expect(out).toContain("https://example.com");
  });

  it("omits empty fields gracefully", () => {
    const e = { type: "misc", key: "x", fields: { title: "Only Title" } };
    const out = formatEntry(e, 9);
    expect(out).toBe('[9]. "Only Title"');
  });
});
