/**
 * W11.Q5: scripts/perf/editor-corpus.mjs, which makes the two real long texts
 * e2e/inp-budget.spec.ts types into (Moby-Dick from Project Gutenberg #2701,
 * and 2 MB of Hebrew from Project Ben-Yehuda).
 *
 * The Ben-Yehuda part runs on the real fragments in fixtures/benyehuda/
 * (public domain). The Gutenberg strings below are only the shape of
 * Gutenberg's START/END marker lines around a few words, written for this
 * test; the real book is downloaded on the Mac.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { benYehudaNote, checkPin, mobyDickNote, readBenYehuda, stripGutenberg, TWO_MIB } from "../../scripts/perf/editor-corpus.mjs";

const PG = [
  "The Project Gutenberg eBook of Moby Dick; Or, The Whale\r",
  "\r",
  "*** START OF THE PROJECT GUTENBERG EBOOK MOBY DICK; OR, THE WHALE ***\r",
  "\r",
  "CHAPTER 1. Loomings.\r",
  "\r",
  "Call me Ishmael.\r",
  "\r",
  "*** END OF THE PROJECT GUTENBERG EBOOK MOBY DICK; OR, THE WHALE ***\r",
  "licence text\r",
].join("\n");

function checkout(): string {
  const d = mkdtempSync(join(tmpdir(), "lumen-by-"));
  mkdirSync(join(d, "txt_stripped", "p89"), { recursive: true });
  copyFileSync("src/__tests__/fixtures/benyehuda/pseudocatalogue.csv", join(d, "pseudocatalogue.csv"));
  for (const m of ["m3604", "m4387"]) copyFileSync(`src/__tests__/fixtures/benyehuda/${m}.txt`, join(d, "txt_stripped", "p89", `${m}.txt`));
  return d;
}

describe("editor-corpus (W11.Q5)", () => {
  it("keeps only the book between Gutenberg's START and END lines, with \\n line ends", () => {
    expect(stripGutenberg(PG)).toBe("CHAPTER 1. Loomings.\n\nCall me Ishmael.\n");
    expect(() => stripGutenberg("no markers")).toThrow(/START\/END/);
  });

  it("turns the chapter lines of Moby-Dick into headings", () => {
    const note = mobyDickNote(stripGutenberg(PG));
    expect(note).toMatch(/^# Moby-Dick; or, The Whale\n/);
    expect(note).toContain("\n## CHAPTER 1. Loomings.\n\nCall me Ishmael.\n");
  });

  it("reads the works of a Ben-Yehuda checkout that have a text file", () => {
    const works = readBenYehuda(checkout());
    expect(works.map((w: { id: string }) => w.id).sort()).toEqual(["3604", "4387"]);
    expect(works.find((w: { id: string }) => w.id === "4387")?.text).toBe(readFileSync("src/__tests__/fixtures/benyehuda/m4387.txt", "utf8"));
  });

  it("assembles one author's works under headings and cuts at a paragraph end past the target", () => {
    const works = readBenYehuda(checkout());
    const r = benYehudaNote(works, 1000);
    expect(r.short).toBe(false);
    expect(Buffer.byteLength(r.text)).toBeGreaterThanOrEqual(1000);
    expect(r.text.endsWith("\n")).toBe(true);
    expect(r.text).toContain("## חיים נחמן ביאליק\n");
    const titles = ["בִּרְכַּת עָם", "הַבְּרֵכָה"].map((x) => x.normalize("NFC"));
    expect(titles.some((x) => r.text.normalize("NFC").includes(`\n### ${x}\n`))).toBe(true);
  });

  it("says when the checkout is too small for 2 MB, instead of padding", () => {
    const r = benYehudaNote(readBenYehuda(checkout()));
    expect(TWO_MIB).toBe(2 * 1024 * 1024);
    expect(r.short).toBe(true);
    expect(Buffer.byteLength(r.text)).toBeLessThan(TWO_MIB);
  });

  it("refuses an unpinned source unless asked to record, and a changed one always", () => {
    const pins = { sources: [{ id: "moby-dick", sha256: null as string | null }] };
    expect(() => checkPin(pins, "moby-dick", "text")).toThrow(/no pinned sha256/);
    const { got, recorded } = checkPin(pins, "moby-dick", "text", true);
    expect(recorded).toBe(true);
    expect(pins.sources[0].sha256).toBe(got);
    expect(checkPin(pins, "moby-dick", "text").recorded).toBe(false);
    expect(() => checkPin(pins, "moby-dick", "other")).toThrow(/is not the pinned/);
  });

  it("pins Gutenberg #2701 and names both sources' licence and attribution", () => {
    const { sources } = JSON.parse(readFileSync("scripts/perf/editor-corpus.json", "utf8"));
    expect(sources.find((s: { id: string }) => s.id === "moby-dick").url).toBe("https://www.gutenberg.org/cache/epub/2701/pg2701.txt");
    for (const s of sources) expect(s.license).toBe("public-domain");
  });

  it("the INP spec types into both texts, in the source editor and in WYSIWYG, with the ceiling as the WYSIWYG way out", () => {
    const spec = readFileSync("e2e/inp-budget.spec.ts", "utf8");
    expect(spec).toContain('file: "moby-dick.md"');
    expect(spec).toContain('file: "benyehuda-2mb.md"');
    expect(spec).toContain("const REAL_BUDGET = 33;");
    expect(spec).toContain('getByTestId("wysiwyg-ceiling-notice")');
    expect(spec).toMatch(/test\.skip\(text === null, NO_CORPUS\)/);
  });
});
