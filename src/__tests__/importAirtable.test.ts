/**
 * Plan W13.F2 — Airtable without the network (src/storage/import/airtable.ts):
 * a table's CSV download, or a base saved from Airtable's Web API to a
 * local JSON file. Each table → a folder of notes + a `.base`.
 *
 * Oracles: Obsidian Importer's Airtable fixture (its saved API responses and
 * its recorded output) and its CSV fixtures (how Obsidian imports an
 * Airtable CSV: a note per row) — MIT, copied unchanged. And lumen-md's
 * golden Hebrew base of two linked tables (synthetic). Last, the whole
 * `npm run import:diff` golden table, with every F2 row.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { parse } from "yaml";
import { convertAirtable, csvValue, looksLikeAirtable } from "../storage/import/airtable";
import { convertExport, detectImportSource, openExport } from "../storage/import/convert";
import { linkStats } from "../storage/import/links";
import { splitFrontmatter } from "../storage/import/frontmatter";
// @ts-expect-error — plain .mjs helpers without types
import { CASES, runGolden, readFiles, goldenMarkdown } from "../../scripts/lib/importDiffCases.mjs";

const enc = new TextEncoder();
const GOLDEN = "src/__tests__/fixtures/import-golden/airtable";

describe("cells", () => {
  it("numbers, checkboxes and text; a leading zero stays text (an id, a phone)", () => {
    expect(csvValue("42")).toBe(42);
    expect(csvValue("-1.5")).toBe(-1.5);
    expect(csvValue("checked")).toBe(true);
    expect(csvValue("0521234567")).toBe("0521234567");
    expect(csvValue("")).toBeUndefined();
  });
});

describe("golden: two linked Hebrew tables as CSV (synthetic)", () => {
  const run = async () => {
    const { opened } = await openExport(readFiles(GOLDEN));
    const source = detectImportSource([...opened.keys()], opened);
    return { source, v: convertExport(source, opened, "Imported/airtable") };
  };

  it("a note per record, named by the first column; typed properties; multiple selects as lists; a sentence with ', ' stays text", async () => {
    const { source, v } = await run();
    expect(source).toBe("airtable");
    expect([...v.notes.keys()].sort()).toEqual(["סופרים.base", "סופרים/לאה גולדברג.md", "סופרים/עמוס עוז.md", "ספרים.base", "ספרים/מיכאל שלי.md", "ספרים/פסנתר.md", "ספרים/שלום, עולם.md"]);
    const { props } = splitFrontmatter(v.notes.get("ספרים/מיכאל שלי.md")!);
    expect(props).toEqual({ סופר: ["[[עמוס עוז]]"], עמודים: 240, נקרא: true, תגיות: ["קלאסיקה", "ירושלים"], הערות: "ספר ראשון\nשל עוז" });
    expect(splitFrontmatter(v.notes.get("ספרים/שלום, עולם.md")!).props.הערות).toBe("עם פסיק, בשם");
  });

  it("linked records are links that reach their note (100%); each table's .base lists its columns in order, filtered to its folder", async () => {
    const { v } = await run();
    // Links in properties: every [[…]] value names a note of the import.
    const titles = new Set([...v.notes.keys()].map((k) => k.replace(/^.*\//, "").replace(/\.md$/, "")));
    const linked = [...v.notes.values()].flatMap((t) => [...t.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]));
    expect(linked.length).toBe(4);
    expect(linked.every((l) => titles.has(l))).toBe(true);
    const base = parse(v.notes.get("ספרים.base")!.replace(/^#.*\n/, "")) as { filters: { and: string[] }; views: { order: string[] }[] };
    expect(base.filters.and[0]).toBe('file.inFolder("Imported/airtable/ספרים")');
    expect(base.views[0].order).toEqual(["file.name", "note.סופר", "note.עמודים", "note.נקרא", "note.תגיות", "note.הערות"]);
    expect(linkStats(v).unresolved).toEqual([]);
  });
});

describe("a base saved from the API (local JSON, no network)", () => {
  it("is detected; linked records by title across tables; attachments stay URLs and are reported; buttons left out", () => {
    const json = {
      baseName: "בסיס",
      schema: {
        tables: [
          { id: "t1", name: "Books", primaryFieldId: "f1", fields: [{ id: "f1", name: "Title", type: "singleLineText" }, { id: "f2", name: "Authors", type: "multipleRecordLinks" }, { id: "f3", name: "Cover", type: "multipleAttachments" }, { id: "f4", name: "Go", type: "button" }] },
          { id: "t2", name: "Authors", primaryFieldId: "g1", fields: [{ id: "g1", name: "Name", type: "singleLineText" }] },
        ],
      },
      records: { t1: { records: [{ id: "r1", createdTime: "2024-01-01T00:00:00.000Z", fields: { Title: "ספר", Authors: ["a1"], Cover: [{ url: "https://dl.airtable.com/x.png", filename: "x.png" }], Go: { label: "Open" } } }] }, t2: [{ id: "a1", fields: { Name: "עדה" } }] },
    };
    expect(looksLikeAirtable(json)).toBe(true);
    const files = new Map([["base.json", enc.encode(JSON.stringify(json))]]);
    expect(detectImportSource([...files.keys()], files)).toBe("airtable");
    const v = convertAirtable(files);
    const { props } = splitFrontmatter(v.notes.get("בסיס/Books/ספר.md")!);
    expect(props).toEqual({ Authors: ["[[עדה]]"], Cover: ["https://dl.airtable.com/x.png"], created: "2024-01-01T00:00:00.000Z" });
    expect(v.notes.has("בסיס/Authors/עדה.md")).toBe(true);
    expect(v.warnings).toContainEqual({ path: "בסיס/Books.base", reason: "remoteAttachment", detail: "1" });
  });

  it("broken or foreign JSON, an empty CSV and other files are reported", () => {
    const v = convertAirtable(new Map([["a.json", enc.encode("{")], ["b.json", enc.encode("[]")], ["c.csv", enc.encode("Name\n")], ["d.png", new Uint8Array([1])]]));
    expect(v.skipped.map((s) => s.reason)).toEqual(["empty", "unreadable", "unreadable", "unsupported"]);
  });
});

describe("against Obsidian Importer", () => {
  it("its Airtable fixture (saved API responses) and its three CSV fixtures: every metric reached", async () => {
    const cases = CASES.filter((c: { source: string }) => c.source === "airtable");
    expect(cases.map((c: { id: string }) => c.id)).toEqual(["airtable-api", "airtable-csv-sample", "airtable-csv-comprehensive", "airtable-csv-semicolon"]);
    const g = await runGolden((source: string, files: Map<string, Uint8Array>) => openExport(files).then(({ opened }) => convertExport(source as "airtable", opened, "Imported/x")), { cases });
    expect(g.pass, goldenMarkdown(g)).toBe(true);
  });
});

describe("npm run import:diff — every format both importers cover", () => {
  it("the golden table has the F1 and F2 rows and passes", () => {
    const r = spawnSync(process.execPath, [join(process.cwd(), "scripts/import-diff.mjs"), "--json"], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const ids = JSON.parse(r.stdout).results.map((x: { case: { id: string } }) => x.case.id);
    for (const id of ["keep", "roam-shapes", "textbundle", "craft", "tomboy", "apple-journal", "airtable-api", "airtable-csv-sample", "airtable-csv-comprehensive", "airtable-csv-semicolon"]) expect(ids).toContain(id);
  });
});
