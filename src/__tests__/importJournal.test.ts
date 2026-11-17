/**
 * Plan W13.F2 — Apple Journal (HTML export), Samsung Notes (text and PDF
 * shares) and Tomboy / Gnote (.note XML).
 *
 * Apple Journal and Tomboy are checked against Obsidian Importer's own test
 * exports and recorded output (MIT, copied unchanged; SOURCES.md), and all
 * three against lumen-md's golden Hebrew exports (synthetic). Obsidian
 * Importer reads Samsung's `.sdocx`; lumen-md reads what Samsung Notes
 * shares (text, PDF) and reports `.sdocx` with that hint — see the PR.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { convertAppleJournal, journalHeaderDate } from "../storage/import/appleJournal";
import { samsungText, convertSamsungNotes } from "../storage/import/samsungNotes";
import { convertTomboy } from "../storage/import/tomboy";
import { convertExport, detectImportSource, openExport } from "../storage/import/convert";
import { linkStats } from "../storage/import/links";
// @ts-expect-error — plain .mjs helpers without types
import { CASES, runGolden, readFiles, goldenMarkdown } from "../../scripts/lib/importDiffCases.mjs";

const enc = new TextEncoder();
const G = "src/__tests__/fixtures/import-golden";
const golden = async (dir: string) => {
  const { opened } = await openExport(readFiles(`${G}/${dir}`));
  const source = detectImportSource([...opened.keys()], opened);
  return { source, v: convertExport(source, opened, `Imported/${dir}`) };
};
const oracle = async (id: string) => {
  const cases = CASES.filter((c: { id: string }) => c.id === id);
  expect(cases.length).toBe(1);
  const g = await runGolden((source: string, files: Map<string, Uint8Array>) => openExport(files).then(({ opened }) => convertExport(source as "tomboy", opened, "Imported/x")), { cases });
  expect(g.pass, goldenMarkdown(g)).toBe(true);
  return g.results[0];
};

describe("Apple Journal", () => {
  it("the page header's date, in English (both orders) and Hebrew", () => {
    expect(journalHeaderDate("Sunday, 3 November 2024")).toBe("2024-11-03");
    expect(journalHeaderDate("Sunday, November 3, 2024")).toBe("2024-11-03");
    expect(journalHeaderDate("יום שלישי, 3 בנובמבר 2026")).toBe("2026-11-03");
    expect(journalHeaderDate("someday")).toBeNull();
  });

  it("golden (Hebrew): prompt, text, bold and links; photos and audio embedded — 0 lost; place and state of mind as properties", async () => {
    const { source, v } = await golden("journal");
    expect(source).toBe("appleJournal");
    const md = v.notes.get("Entries/2026-11-03 יום של חורף.md")!;
    expect(md).toMatch(/^---\nplace:\n {2}- נמל תל אביב\nstate-of-mind:\n {2}- רגוע\n {2}- אסיר תודה\ndate: 2026-11-03\ntitle: יום של חורף\n---/);
    expect(md).toContain("> מה שימח אותך היום?\n\nגשם ראשון, ו**ריח** של אדמה.\n\nשיחה עם [אמא](https://example.org).");
    expect(md).toContain("![IMG1.jpg](../Resources/IMG1.jpg)");
    expect(v.notes.get("Entries/2026-11-04.md")).toContain("[voice memo.m4a](<../Resources/voice memo.m4a>)");
    expect(v.sourceAttachments - v.attachments.size).toBe(0);
    expect(v.attachments.size).toBe(3);
    const s = linkStats(v);
    expect(s.resolved).toBe(s.total);
    expect(s.total).toBe(3);
    expect(v.skipped).toEqual([{ path: "index.html", reason: "appFolder" }]);
  });

  it("against Obsidian Importer's Journal fixtures: every metric reached, and the entry text is there", async () => {
    const r = await oracle("apple-journal");
    expect(r.rows.find((x: { metric: string }) => x.metric === "notes")).toMatchObject({ lumen: 2, oracle: 2 });
    const v = convertAppleJournal(new Map([["Entries/e.html", new Uint8Array(readFileSync("src/__tests__/fixtures/obsidian-importer/journal/entry-complex-metadata.html"))]]));
    expect([...v.notes.values()][0]).toContain("Entry body text.");
  });
});

describe("Samsung Notes", () => {
  it("text: checklist marks → tasks, bullets → items, the title line kept as a heading unless it is the file name", () => {
    expect(samsungText("קניות\n\n☑ חלב\n□ לחם\n• פריט", "קניות")).toBe("- [x] חלב\n- [ ] לחם\n- פריט");
    expect(samsungText("סיכום\n\nשורה", "file")).toBe("# סיכום\n\nשורה");
  });

  it("golden (Hebrew): two text notes, a PDF shown in its own note, the .sdocx reported with how to share it", async () => {
    const { source, v } = await golden("samsung");
    expect(source).toBe("samsungNotes");
    expect([...v.notes.keys()].sort()).toEqual(["סקיצה ביד.md", "פגישה.md", "רשימת קניות.md"]);
    expect(v.notes.get("רשימת קניות.md")).toBe("- [x] חלב\n- [ ] לחם\n- [ ] קפה \u200fLavazza\u200f\n\nלזכור: החנות נסגרת ב-20:00\n");
    expect(v.notes.get("סקיצה ביד.md")).toContain("![סקיצה ביד](<סקיצה ביד.pdf>)");
    expect(v.warnings).toContainEqual({ path: "סקיצה ביד.md", reason: "pdfOnly" });
    expect(v.skipped).toEqual([{ path: "ישן.sdocx", reason: "unsupported", detail: "Share → Text file / PDF file" }]);
    expect(v.sourceAttachments - v.attachments.size).toBe(0);
    expect(linkStats(v).unresolved).toEqual([]);
  });

  it("an empty text file is reported, not imported", () => {
    expect(convertSamsungNotes(new Map([["a.txt", enc.encode("\n\n")]])).skipped).toEqual([{ path: "a.txt", reason: "empty" }]);
  });
});

describe("Tomboy / Gnote", () => {
  it("golden (Hebrew): a notebook becomes a folder, a TODO note (משימות) gets tasks, struck out = done, links and URLs, heading by size", async () => {
    const { source, v } = await golden("tomboy");
    expect(source).toBe("tomboy");
    const md = v.notes.get("בית/משימות לשבוע.md")!;
    expect(md).toContain("- [x] לשלם חשבון חשמל\n- [ ] להתקשר ל[[דנה]]");
    expect(md).toContain("### הערות\n\nטקסט **מודגש** ו*נטוי* עם <https://example.org>.");
    expect(md).toMatch(/^---\ncreated: 2026-11-01T07:00:00Z\nupdated: 2026-11-02T08:00:00Z\ntags:\n {2}- אישי\n---/);
    expect(linkStats(v)).toMatchObject({ total: 2, resolved: 2 });
    expect(v.skipped).toEqual([{ path: "manifest.xml", reason: "appFolder" }]);
  });

  it("a title the file name cannot keep stays on top as a heading; a template goes to Templates/; broken XML is reported", () => {
    const note = (title: string, tags = "") =>
      enc.encode(`<?xml version="1.0"?><note version="0.3" xmlns="http://beatniksoftware.com/tomboy"><title>${title}</title><text xml:space="preserve"><note-content version="0.1">${title}\n\nbody</note-content></text>${tags}</note>`);
    const v = convertTomboy(
      new Map([
        ["a.note", note("Bad #1")],
        ["t.note", note("Tpl", "<tags><tag>system:template</tag></tags>")],
        ["x.note", enc.encode("<note><oops")],
      ]),
    );
    expect(v.notes.get("Bad 1.md")).toBe("# Bad #1\n\nbody\n");
    expect(v.notes.get("Templates/Tpl.md")).toContain("tags:\n  - template");
    expect(v.skipped).toEqual([{ path: "x.note", reason: "unreadable" }]);
  });

  it("against Obsidian Importer's Tomboy fixtures: every metric reached (16 headings, 6 links)", async () => {
    const r = await oracle("tomboy");
    expect(r.rows.find((x: { metric: string }) => x.metric === "headings")).toMatchObject({ oracle: 16 });
    expect(r.rows.find((x: { metric: string }) => x.metric === "headings").lumen).toBeGreaterThanOrEqual(16);
  });
});

describe("fixtures", () => {
  it("the importer's Tomboy, Journal, CSV and Airtable fixtures are its files, byte for byte (sha256 in SOURCES.md)", () => {
    const fix = "src/__tests__/fixtures/obsidian-importer";
    const sources = readFileSync(`${fix}/SOURCES.md`, "utf8");
    const files = ["tomboy", "tomboy-expected", "journal", "journal-expected", "csv", "csv-expected", "airtable", "airtable-expected"].flatMap((d) => [...readFiles(`${fix}/${d}`).entries()]);
    expect(files.length).toBeGreaterThan(50);
    for (const [p, data] of files) expect(sources, p).toContain(createHash("sha256").update(data).digest("hex"));
  });
});
