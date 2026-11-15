/**
 * Plan W12.X2 — the reading list: a built-in "source" type with status,
 * progress and rating; the PDF and EPUB readers write their place into the
 * source note that names the file; a source from a Zotero (CSL-JSON) item
 * or a captured page; the type's Base has a kanban view by status.
 *
 * The notes and the library item here are SYNTHETIC, written for the test.
 * The real reader path (open a PDF in the app, scroll to page 50) is an e2e
 * that runs on the Mac (see the PR).
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { loadTypeRegistry } from "../types/typeRegistry";
import { typeBaseObject } from "../types/typeBase";
import { builtinTypes } from "../types/vaultTypes";
import { fromCslJson } from "../citations/library";
import { SOURCE_TYPE_ID, sourceTypeDef } from "../reading/sourceType";
import { applyProgress, frontmatterOf, linkedPath, namesDocument, percentRead, progressValues, recordReaderProgress, sourcesNaming, type ProgressIO } from "../reading/progress";
import { sourceNoteFromCapture, sourceNoteFromCitation } from "../reading/sourceFrom";

const reg = loadTypeRegistry([], [sourceTypeDef()]);

const SOURCE = (file: string, extra = "") =>
  `---\ntype: source\nkind: book\nstatus: to-read\nprogress: 0\nfile: "${file}"\n${extra}---\n\n# ספר\n\nהערות שלי על הספר.\n`;

function memoryVault(files: Record<string, string>): ProgressIO & { files: Record<string, string>; writes: string[] } {
  const v = {
    files: { ...files },
    writes: [] as string[],
    list: async () => Object.keys(v.files),
    read: async (p: string) => {
      if (!(p in v.files)) throw new Error("missing");
      return v.files[p];
    },
    write: async (p: string, t: string) => {
      v.writes.push(p);
      v.files[p] = t;
    },
  };
  return v;
}

describe("the source type", () => {
  it("is a built-in type with status, kind, progress and rating in the frontmatter", () => {
    const t = reg.get(SOURCE_TYPE_ID)!;
    expect(t).toBeDefined();
    expect(t.label).toEqual({ he: "מקור", en: "Source" });
    const byName = Object.fromEntries(t.effective.map((f) => [f.name, f]));
    expect(byName.status.options).toEqual(["to-read", "reading", "done"]);
    expect(byName.kind.options).toEqual(["book", "article", "website"]);
    expect(byName.progress.kind).toBe("number");
    expect(byName.rating.kind).toBe("number");
    expect(builtinTypes().map((d) => d.id)).toContain(SOURCE_TYPE_ID);
  });

  it("its Base has a kanban view grouped by status, in reading order (the reading list)", () => {
    const base = typeBaseObject(reg, SOURCE_TYPE_ID);
    const kanban = (base.views as Array<Record<string, unknown>>).find((v) => v.type === "kanban")!;
    expect(kanban.groupBy).toEqual({ property: "note.status", direction: "ASC" });
    expect(kanban.groupOrder).toEqual(["to-read", "reading", "done", null]);
    expect(kanban.name).toBe("לפי מצב");
  });
});

describe("progress from the readers", () => {
  it("page 50 of 200 is 25%", () => {
    expect(percentRead({ page: 50, pages: 200 })).toBe(25);
    expect(percentRead({ page: 1, pages: 0 })).toBe(0);
    expect(percentRead({ page: 300, pages: 200 })).toBe(100);
  });

  it("writes page, pages, progress and status into the frontmatter only; the body is untouched", () => {
    const text = SOURCE("[[papers/paper.pdf]]");
    const out = applyProgress(text, { page: 50, pages: 200 }, "2026-11-15");
    const fm = frontmatterOf(out);
    expect(fm).toMatchObject({ type: "source", status: "reading", progress: 25, page: 50, pages: 200, file: "[[papers/paper.pdf]]" });
    expect(out.slice(out.indexOf("\n---\n", 4))).toBe(text.slice(text.indexOf("\n---\n", 4)));
    expect(YAML.parse(out.split("---")[1])).toMatchObject({ progress: 25 });
  });

  it("the last page marks it done with the day it was finished; a done source stays done when reopened", () => {
    const done = applyProgress(SOURCE("[[b.epub]]", "status: reading\n").replace("status: to-read\n", ""), { page: 12, pages: 12 }, "2026-11-15");
    expect(frontmatterOf(done)).toMatchObject({ status: "done", progress: 100, finished: "2026-11-15" });
    expect(progressValues({ status: "done", page: 3, pages: 12, progress: 25 }, { page: 3, pages: 12 }, "x")).toBeNull();
    expect(progressValues({ status: "done" }, { page: 4, pages: 12 }, "x")).toEqual({ page: 4, pages: 12, progress: 33 });
  });

  it("finds the source by its file: link in its several spellings", () => {
    expect(linkedPath("[[papers/a b.pdf|Cohen 2020]]")).toBe("papers/a b.pdf");
    expect(linkedPath("![[a.pdf]]")).toBe("a.pdf");
    expect(linkedPath("[x](papers/a%20b.pdf)")).toBe("papers/a b.pdf");
    expect(namesDocument({ file: "[[a b.pdf]]" }, "papers/a b.pdf")).toBe(true);
    expect(namesDocument({ file: "[[other/a b.pdf]]" }, "papers/a b.pdf")).toBe(false);
  });

  it("the reader at page 50 updates the source note that names the PDF, and nothing else", async () => {
    const vault = memoryVault({
      "sources/paper.md": SOURCE("[[papers/paper.pdf]]"),
      "sources/other.md": SOURCE("[[papers/other.pdf]]"),
      "notes/plain.md": `---\nfile: "[[papers/paper.pdf]]"\n---\nnot a source\n`,
      "notes/broken.md": `---\ntype: source\nfile: "[[papers/paper.pdf]]"\n  bad: [\n---\n`,
      "papers/paper.pdf": "%PDF",
    });
    const wrote = await recordReaderProgress(vault, "papers/paper.pdf", { page: 50, pages: 200 }, new Date("2026-11-15T10:00:00Z"));
    expect(wrote).toEqual(["sources/paper.md"]);
    expect(frontmatterOf(vault.files["sources/paper.md"])).toMatchObject({ progress: 25, status: "reading", page: 50 });
    expect(vault.files["sources/other.md"]).toBe(SOURCE("[[papers/other.pdf]]"));
    // The same place again writes nothing.
    expect(await recordReaderProgress(vault, "papers/paper.pdf", { page: 50, pages: 200 })).toEqual([]);
    // The readers look the notes up once, then read only those.
    expect(await sourcesNaming(vault, "papers/paper.pdf")).toEqual(["sources/paper.md"]);
    expect(await recordReaderProgress(vault, "papers/paper.pdf", { page: 60, pages: 200 }, new Date(), ["sources/paper.md"])).toEqual(["sources/paper.md"]);
    expect(frontmatterOf(vault.files["sources/paper.md"]).progress).toBe(30);
  });

  it("an EPUB's chapters are its pages", async () => {
    const vault = memoryVault({ "s.md": SOURCE("[[books/novel.epub]]") });
    await recordReaderProgress(vault, "books/novel.epub", { page: 3, pages: 12 });
    expect(frontmatterOf(vault.files["s.md"])).toMatchObject({ progress: 25, page: 3, pages: 12, status: "reading" });
  });
});

describe("new sources", () => {
  it("a Zotero item (CSL-JSON, as Better BibTeX exports it) becomes a source with its key, author, year and DOI", () => {
    const [item] = fromCslJson(
      JSON.stringify([
        { id: "cohen2020", "citation-key": "cohen2020", type: "article-journal", title: "Reading in Hebrew", author: [{ family: "Cohen", given: "Dana" }, { family: "Levi", given: "Avi" }], issued: { "date-parts": [[2020]] }, DOI: "10.1000/xyz" },
      ]),
      ".lumen/zotero-library.csl.json",
      "zotero",
    );
    const made = sourceNoteFromCitation(reg, item.key, item.record)!;
    expect(made.name).toBe("Reading in Hebrew.md");
    expect(frontmatterOf(made.text)).toMatchObject({ type: "source", kind: "article", status: "to-read", progress: 0, citekey: "cohen2020", author: "Dana Cohen, Avi Levi", year: "2020", url: "https://doi.org/10.1000/xyz" });
    expect(made.text).toContain("# Reading in Hebrew");
  });

  it("a page captured in the browser becomes a website source", () => {
    const made = sourceNoteFromCapture(reg, { url: "https://example.org/a", title: "מאמר: על קריאה" })!;
    expect(made.name).toBe("מאמר על קריאה.md");
    expect(frontmatterOf(made.text)).toMatchObject({ type: "source", kind: "website", url: "https://example.org/a", status: "to-read" });
  });
});
