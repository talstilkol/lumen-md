/**
 * Plan W13.F4 — accessible EPUB: EPUB Accessibility 1.1 discovery metadata
 * (schema.org in the OPF), a page list with page-break markers, RTL reading
 * order, in both EPUB exporters (the book, src/book/epub.ts; the note,
 * src/storage/exportFormats.ts).
 *
 * The golden EPUBs in fixtures/epub-a11y were made by those exporters in
 * Chromium and passed epubcheck 5.3.0 (0 errors, 0 warnings) and axe-core
 * 4.10 (Ace's engine: 0 serious/critical) when made — see SOURCES.md; Ace by
 * DAISY itself is the owner's run on the Mac.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { a11yMetadata, countImages, pageListNav, paginate } from "../book/epubA11y";
import { buildEpub } from "../book/epub";
import { markdownToEpubBytes } from "../storage/exportFormats";
import { unzip } from "../storage/zip";

const FIX = "src/__tests__/fixtures/epub-a11y";
const text = async (bytes: Uint8Array) => {
  const files = await unzip(bytes.slice().buffer);
  const dec = new TextDecoder();
  return new Map([...files].map(([k, v]) => [k, dec.decode(v)]));
};
const metas = (opf: string, prop: string) => [...opf.matchAll(new RegExp(`<meta property="${prop}">([^<]*)</meta>`, "g"))].map((m) => m[1]);

describe("discovery metadata", () => {
  it("text only: textual is sufficient; the features of a structured book; no hazard; a Hebrew summary for a Hebrew book", () => {
    const m = a11yMetadata({ lang: "he", images: 0, imagesWithoutAlt: 0, pages: 7 });
    expect(metas(m, "schema:accessMode")).toEqual(["textual"]);
    expect(metas(m, "schema:accessModeSufficient")).toEqual(["textual"]);
    expect(metas(m, "schema:accessibilityFeature")).toEqual(["structuralNavigation", "tableOfContents", "readingOrder", "displayTransformability", "pageNavigation", "pageBreakMarkers"]);
    expect(metas(m, "schema:accessibilityHazard")).toEqual(["none"]);
    expect(metas(m, "schema:accessibilitySummary")[0]).toMatch(/^ספר עם מבנה של כותרות/);
    expect(metas(m, "schema:accessibilitySummary")[0]).toContain("(7)");
  });

  it("images: visual too; all described → alternativeText and textual is enough; one undescribed → textual,visual and the summary says so", () => {
    const ok = a11yMetadata({ lang: "en", images: 2, imagesWithoutAlt: 0, pages: 1 });
    expect(metas(ok, "schema:accessMode")).toEqual(["textual", "visual"]);
    expect(metas(ok, "schema:accessibilityFeature")).toContain("alternativeText");
    expect(metas(ok, "schema:accessModeSufficient")).toEqual(["textual"]);
    const bad = a11yMetadata({ lang: "en", images: 2, imagesWithoutAlt: 1, pages: 1 });
    expect(metas(bad, "schema:accessibilityFeature")).not.toContain("alternativeText");
    expect(metas(bad, "schema:accessModeSufficient")).toEqual(["textual,visual"]);
    expect(metas(bad, "schema:accessibilitySummary")[0]).toContain("1 of 2 images have no text alternative");
  });

  it("never claims conformance (an evaluation does that)", () => {
    expect(a11yMetadata({ lang: "he", images: 0, imagesWithoutAlt: 0, pages: 1 })).not.toContain("conformsTo");
  });

  it("counts images and the undescribed ones", () => {
    expect(countImages('<img src="a" alt="x"/><img src="b" alt=""/><img src="c"/>')).toEqual({ images: 3, withoutAlt: 2 });
  });
});

describe("the page list", () => {
  it("a marker at the start, then one before the block where ~300 words have passed; numbered on from the chapter before", () => {
    const body = Array.from({ length: 8 }, (_, i) => `<p>${"מילה ".repeat(100)}${i}</p>`).join("");
    const r = paginate(body, 5);
    expect(r.pages.map((p) => p.n)).toEqual([5, 6, 7]);
    expect(r.body.startsWith('<span epub:type="pagebreak" id="page-5" title="5"></span><p>')).toBe(true);
    // Never inside a paragraph.
    expect(r.body).not.toMatch(/<p>[^<]*<span epub:type="pagebreak"/);
  });

  it("the page-list nav links every marker, hidden for the reader's own UI", () => {
    expect(pageListNav([{ href: "c1.xhtml", n: 1, id: "page-1" }], "עמודים")).toBe('<nav epub:type="page-list" id="page-list" aria-label="עמודים" hidden="hidden"><ol><li><a href="c1.xhtml#page-1">1</a></li></ol></nav>');
  });
});

describe("the note exporter", () => {
  it("a Hebrew note: metadata, a page list whose every link reaches a marker, RTL page progression, navigation in Hebrew", async () => {
    const f = await text(await markdownToEpubBytes("# מבוא\n\n" + Array.from({ length: 6 }, () => "משפט בעברית. ".repeat(60)).join("\n\n") + "\n\n# סוף\n\nטקסט.\n", "פתק"));
    const opf = f.get("OEBPS/content.opf")!;
    expect(opf).toContain('page-progression-direction="rtl"');
    expect(metas(opf, "schema:accessibilityHazard")).toEqual(["none"]);
    expect(metas(opf, "schema:accessibilityFeature")).toContain("pageNavigation");
    const nav = f.get("OEBPS/nav.xhtml")!;
    expect(nav).toContain("<title>תוכן העניינים</title>");
    const links = [...nav.matchAll(/<a href="(chapter\d+\.xhtml)#(page-\d+)">(\d+)<\/a>/g)];
    expect(links.length).toBeGreaterThanOrEqual(3);
    for (const [, href, id] of links) expect(f.get(`OEBPS/${href}`)).toContain(`id="${id}"`);
    expect(f.get("OEBPS/chapter1.xhtml")).toContain('xmlns:epub="http://www.idpf.org/2007/ops"');
    // The landmarks name only spine documents (the nav is not in this package's spine).
    expect(nav).not.toMatch(/epub:type="toc" href="nav.xhtml"/);
  });
});

describe("the book exporter", () => {
  it("chapters paginated, the page list in the nav, the metadata counting the described image", async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const f = await text(
      await buildEpub({
        title: "ספר",
        lang: "he",
        dir: "rtl",
        identifier: "urn:uuid:00000000-0000-4000-8000-000000000000",
        modified: new Date("2026-01-01T00:00:00Z"),
        labels: { contents: "תוכן", titlePage: "שער" },
        chapters: [
          { title: "א", lang: "he", dir: "rtl", html: `<p>${"מילה ".repeat(350)}</p><p>עוד</p><img src="a.png" alt="מפה">` },
          { title: "ב", lang: "he", dir: "rtl", html: "<p>קצר</p>" },
        ],
        assets: async () => ({ bytes: png, mediaType: "image/png" }),
      }),
    );
    const opf = f.get("OEBPS/content.opf")!;
    expect(metas(opf, "schema:accessMode")).toEqual(["textual", "visual"]);
    expect(metas(opf, "schema:accessibilityFeature")).toContain("alternativeText");
    const nav = f.get("OEBPS/nav.xhtml")!;
    expect(nav).toContain('aria-label="עמודים"');
    expect([...nav.matchAll(/#(page-\d+)">/g)].map((m) => m[1])).toEqual(["page-1", "page-2", "page-3"]);
  });
});

describe("golden EPUBs (made in Chromium; epubcheck 0 errors and axe 0 serious when made)", () => {
  it.each(["he-book.epub", "he-note.epub", "en-note.epub"])("%s carries the EPUB Accessibility 1.1 metadata, a page list that resolves, and its language", async (name) => {
    const f = await text(new Uint8Array(readFileSync(`${FIX}/${name}`)));
    const opf = f.get("OEBPS/content.opf")!;
    for (const p of ["schema:accessMode", "schema:accessModeSufficient", "schema:accessibilityFeature", "schema:accessibilityHazard", "schema:accessibilitySummary"]) expect(metas(opf, p).length, p).toBeGreaterThan(0);
    const nav = f.get("OEBPS/nav.xhtml")!;
    const links = [...nav.matchAll(/<a href="([^"#]+)#(page-\d+)">/g)];
    expect(links.length).toBeGreaterThan(0);
    for (const [, href, id] of links) expect(f.get(`OEBPS/${href}`)).toContain(`id="${id}"`);
    if (name.startsWith("he")) {
      expect(opf).toContain('page-progression-direction="rtl"');
      expect(opf).toContain("<dc:language>he</dc:language>");
    }
  });
});
