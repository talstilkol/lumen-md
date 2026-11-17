/**
 * Plan W13.F2 — the Day One import (src/storage/import/dayOne.ts): the JSON
 * export, its media by MD5, the place and weather as properties.
 *
 * Obsidian Importer has no Day One converter, so there is no oracle: the
 * golden export is lumen-md's own (synthetic, Hebrew — fixtures/import-golden,
 * SOURCES.md), in the shape Day One's JSON export has (`{ metadata, entries }`,
 * `photos/<md5>.jpeg`, `pdfs/<md5>.pdf`, `dayone-moment://` links).
 */
import { describe, expect, it } from "vitest";
import { convertDayOne, dayOneText, looksLikeDayOne } from "../storage/import/dayOne";
import { convertExport, detectImportSource, openExport } from "../storage/import/convert";
import { linkStats } from "../storage/import/links";
import { parseLocation } from "../map/cluster";
import { splitFrontmatter } from "../storage/import/frontmatter";
// @ts-expect-error — plain .mjs helpers without types
import { readFiles } from "../../scripts/lib/importDiffCases.mjs";

const enc = new TextEncoder();
const GOLDEN = "src/__tests__/fixtures/import-golden/dayone";
const run = async () => {
  const { opened } = await openExport(readFiles(GOLDEN));
  const source = detectImportSource([...opened.keys()], opened);
  return { source, v: convertExport(source, opened, "Imported/dayone") };
};

describe("Day One's text", () => {
  it("needless escapes are undone; a `\\-` that would start a list, and code, are left as they are", () => {
    expect(dayOneText("1\\. one\\! (a\\)\n\\- not a list\nmid \\- dash\n`a\\.b`")).toBe("1. one! (a)\n\\- not a list\nmid - dash\n`a\\.b`");
  });
  it("only a `{ metadata, entries }` JSON is Day One", () => {
    expect(looksLikeDayOne({ metadata: { version: "1.0" }, entries: [{ uuid: "x", creationDate: "2026-01-01T00:00:00Z" }] })).toBe(true);
    expect(looksLikeDayOne({ entries: [] })).toBe(false);
    expect(looksLikeDayOne([{ title: "Roam" }])).toBe(false);
  });
});

describe("golden: a Hebrew Day One journal (synthetic)", () => {
  it("is detected; each entry is a note under <journal>/<year>/; the empty one is reported, not imported", async () => {
    const { source, v } = await run();
    expect(source).toBe("dayOne");
    expect([...v.notes.keys()].sort()).toEqual(["יומן/2026/2026-11-03 בוקר בירושלים.md", "יומן/2026/2026-11-04 ערב עם מסמך מצורף החוזה.md"]);
    expect(v.skipped).toEqual([{ path: "יומן.json#C1", reason: "empty" }]);
  });

  it("0 attachments lost: every photo and PDF is in the vault and shown by its entry (the one the text does not show is added below it)", async () => {
    const { v } = await run();
    expect(v.sourceAttachments).toBe(3);
    expect(v.attachments.size).toBe(3);
    const s = linkStats(v);
    expect(s.total).toBe(3);
    expect(s.resolved).toBe(3);
    const morning = v.notes.get("יומן/2026/2026-11-03 בוקר בירושלים.md")!;
    expect(morning).toContain("![](../../photos/57da6f2e0f139e118c7930ae76570491.jpeg)");
    expect(morning).toContain("![](../../photos/2cd8bde463f5d82aae0f0cec061d6b8f.png)");
    expect(v.notes.get("יומן/2026/2026-11-04 ערב עם מסמך מצורף החוזה.md")).toContain("[החוזה](../../pdfs/f05285f24eb4ca080ccbd573c23954ea.pdf)");
    // A photo the entry names but the export does not hold is reported.
    expect(v.warnings).toContainEqual({ path: "יומן/2026/2026-11-04 ערב עם מסמך מצורף החוזה.md", reason: "missingAttachment", detail: "1" });
  });

  it("place, coordinates (as Lumen's map reads them), weather, tags, star and dates are properties; Hebrew and RLM marks intact", async () => {
    const { v } = await run();
    const { props, body } = splitFrontmatter(v.notes.get("יומן/2026/2026-11-03 בוקר בירושלים.md")!);
    expect(props).toMatchObject({ created: "2026-11-03T07:15:00Z", updated: "2026-11-03T09:00:00Z", tags: ["טיולים", "בוקר-טוב"], starred: true, place: "שער יפו, ירושלים, ישראל", weather: "Partly Cloudy, 18°C", timezone: "Asia/Jerusalem" });
    expect(parseLocation(props.coordinates)).toEqual([31.7767, 35.2275]);
    expect(body).toContain("טיול קצר ב\u200fOld City\u200f עם הקפה הראשון.");
    expect(body).toContain("1. לכתוב\n2. לקרוא");
  });
});

describe("edge cases", () => {
  it("broken JSON is reported; an entry without a date is imported and reported", () => {
    const v = convertDayOne(
      new Map([
        ["bad.json", enc.encode("{")],
        ["J.json", enc.encode(JSON.stringify({ metadata: {}, entries: [{ uuid: "U", text: "שלום" }] }))],
      ]),
    );
    expect(v.skipped).toEqual([{ path: "bad.json", reason: "unreadable" }]);
    expect([...v.notes.keys()]).toEqual(["J/שלום.md"]);
    expect(v.warnings).toContainEqual({ path: "J/שלום.md", reason: "noDates" });
  });

  it("10,000 entries convert in well under 10 s", () => {
    const entries = Array.from({ length: 10_000 }, (_, i) => ({ uuid: `u${i}`, creationDate: new Date(Date.UTC(2020, 0, 1) + i * 3_600_000).toISOString(), text: `רשומה ${i}` }));
    const t0 = performance.now();
    const v = convertDayOne(new Map([["Journal.json", enc.encode(JSON.stringify({ metadata: {}, entries }))]]));
    expect(v.notes.size).toBe(10_000);
    expect(performance.now() - t0).toBeLessThan(10_000);
  });
});
