/**
 * W12.R3 — PDF highlights as Hebrew APA 7 quotations, through the W11.H15
 * formatter: the guide examples come out the same as there, a page
 * locator ("עמ׳ 14") inside FSI … PDI, printed page labels for a scanned
 * book, Hebrew references before English ones, and missing metadata
 * reported for the caller to ask about.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { exportNoteApa, highlightCitation, type SourceMeta } from "../highlights/apaExport";
import { bibliography, yearSuffixes } from "../citations/cite";
import { runsToMarkdown, type CitationRecord } from "../data/citationStyles";
import type { HighlightItem } from "../highlights/hub";

type Example = { id: string; kind: "reference" | "parenthetical" | "narrative"; record: CitationRecord; expected: string };
const guide = JSON.parse(readFileSync("src/__tests__/fixtures/apa7-he-guides.json", "utf8")) as { examples: Example[] };
const FSI = "⁨";
const PDI = "⁩";
/** The same normalisation as apa7Hebrew.test.ts (W11.H15). */
const norm = (s: string) =>
  s
    .replace(/[⁨⁩]/g, "")
    .replace(/\*/g, "")
    .replace(/([א-ת])[׳'.](?=[\s,)]|$)/g, "$1׳")
    .replace(/[’]/g, "'");

const hl = (source: string, page: number | null, text = "ציטוט", kind: HighlightItem["kind"] = "pdf"): HighlightItem => ({
  key: `${kind}:${source}:${page}`,
  kind,
  source,
  notePath: `${source}.highlights.md`,
  id: "a1",
  text,
  note: "",
  tags: [],
  location: page,
  link: `${source}#page=${page}&highlight=a1`,
  created: null,
  haystack: "",
});
const labels = { title: "הדגשות", references: "מקורות", where: (it: HighlightItem) => `עמ׳ ${it.location}` };
const ctx = (cited: Array<{ key: string; record: CitationRecord }>) => ({ style: "il" as const, lang: "he" as const, suffix: yearSuffixes(cited, "il") });

const cohen: CitationRecord = { type: "book", authors: [{ family: "כהן", given: "א" }, { family: "לוי", given: "ב" }, { family: "מזרחי", given: "ג" }], year: "2020", title: "ספר על קריאה", publisher: "מאגנס" } as CitationRecord;
const smith: CitationRecord = { type: "book", authors: [{ family: "Smith", given: "J" }], year: "2019", title: "Reading", publisher: "Pub" } as CitationRecord;

describe("the W11.H15 guide examples, through the highlight export", () => {
  const rendered = guide.examples.map((e) => {
    const meta: SourceMeta = { key: "k", record: e.record };
    if (e.kind === "reference") {
      const r = exportNoteApa([hl("a.pdf", 1)], () => meta, labels);
      if (!r.ok) throw new Error("metadata");
      return { e, got: r.markdown.split("## מקורות\n\n")[1].trim() };
    }
    // No page: an EPUB highlight without a chapter carries no locator, as the guide's examples.
    return { e, got: highlightCitation(hl("a.epub", null, "x", "epub"), meta, ctx([{ key: "k", record: e.record }])) };
  });

  it("match exactly where W11.H15 matches (6 of the 8 transcribed; the 2 guide quirks differ there too)", () => {
    const ok = rendered.filter((r) => r.e.kind !== "narrative" && norm(r.got) === norm(r.e.expected)).map((r) => r.e.id);
    expect(ok.length).toBe(5); // the narrative form is not a highlight citation; 6 − 1
    expect(rendered.filter((r) => r.e.kind !== "narrative" && norm(r.got) !== norm(r.e.expected)).map((r) => r.e.id)).toEqual(["biu-book-2", "haifa-book-1"]);
  });

  it("the export's reference entry is exactly the W11.H15 bibliography entry", () => {
    for (const { e, got } of rendered.filter((r) => r.e.kind === "reference")) {
      const lib = [{ key: "k", record: e.record }];
      expect(got).toBe(runsToMarkdown(bibliography(lib, ctx(lib))[0][0].runs));
    }
  });
});

describe("page locators", () => {
  it("(כהן ואחרים, 2020, עמ׳ 14), as an isolate", () => {
    const meta = { key: "cohen2020", record: cohen };
    expect(highlightCitation(hl("c.pdf", 14), meta, ctx([meta]))).toBe(`${FSI}(כהן ואחרים, 2020, עמ׳ 14)${PDI}`);
  });

  it("a scanned page uses the printed page label when the PDF has one", () => {
    const meta = { key: "cohen2020", record: cohen, pageLabels: { 5: "14", 6: "xii" } };
    expect(highlightCitation(hl("c.pdf", 5), meta, ctx([meta]))).toContain("עמ׳ 14)");
    expect(highlightCitation(hl("c.pdf", 6), meta, ctx([meta]))).toContain("עמ׳ xii)");
    expect(highlightCitation(hl("c.pdf", 7), meta, ctx([meta]))).toContain("עמ׳ 7)");
  });
});

describe("the exported note", () => {
  it("quotes with their citation and a link back; references Hebrew first, then English", () => {
    const metas: Record<string, SourceMeta> = { "he.pdf": { key: "cohen2020", record: cohen }, "en.pdf": { key: "smith2019", record: smith } };
    const r = exportNoteApa([hl("en.pdf", 3, "English words"), hl("he.pdf", 14, "מילים בעברית"), hl("he.pdf", 2, "ראשון")], (s) => metas[s] ?? null, labels);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cited).toBe(2);
    expect(r.markdown).toContain(`> ״מילים בעברית״ ${FSI}(כהן ואחרים, 2020, עמ׳ 14)${PDI}\n> — [[he.pdf#page=14&highlight=a1|עמ׳ 14]]`);
    // Within a document, by page.
    expect(r.markdown.indexOf("ראשון")).toBeLessThan(r.markdown.indexOf("מילים בעברית"));
    const refs = r.markdown.split("## מקורות\n\n")[1];
    expect(refs.indexOf("כהן")).toBeLessThan(refs.indexOf("Smith"));
  });

  it("without metadata for a document, nothing is written and the documents to ask about are named", () => {
    expect(exportNoteApa([hl("a.pdf", 1), hl("b.pdf", 1)], (s) => (s === "a.pdf" ? { key: "k", record: cohen } : null), labels)).toEqual({ ok: false, missing: ["b.pdf"] });
  });
});
