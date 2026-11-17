/**
 * Plan W13.F1 — the Craft import (src/storage/import/craft.ts): Craft's
 * Markdown and TextBundle exports, with `craftdocs://` links turned into
 * wikilinks where the export holds their target.
 *
 * Obsidian Importer has no Craft converter (its help sends Craft through the
 * Markdown import, which copies the files as they are), so the golden export
 * here is lumen-md's own (synthetic, Hebrew: fixtures/import-golden/SOURCES.md)
 * and the import:diff oracle for it is the export itself.
 */
import { describe, expect, it } from "vitest";
import { convertCraft, craftToMarkdown } from "../storage/import/craft";
import { convertExport, detectImportSource, openExport } from "../storage/import/convert";
import { linkStats } from "../storage/import/links";
// @ts-expect-error — plain .mjs helpers without types
import { CASES, runGolden, readFiles } from "../../scripts/lib/importDiffCases.mjs";

const enc = new TextEncoder();
const GOLDEN = "src/__tests__/fixtures/import-golden/craft";
const idx = (titles: Record<string, string>, blocks: Record<string, { doc: string; id: string }> = {}) => ({ titles: new Map(Object.entries(titles)), blocks: new Map(Object.entries(blocks)) });

describe("craftdocs:// links", () => {
  it("to a document of the export (by its title), to a block (by its id), and to something outside", () => {
    const counts = { intoCraft: 0 };
    const md = craftToMarkdown(
      "[Plan](craftdocs://open?blockId=AAA-1&spaceId=S) [the call](craftdocs://open?blockId=BBBB2222-0000&amp;spaceId=S) [Gone](craftdocs://open?blockId=CCC&spaceId=S)",
      idx({ plan: "Plan" }, { "bbbb2222-0000": { doc: "Notes", id: "bbbb2222-0000" } }),
      counts,
    );
    expect(md).toBe("[[Plan]] [[Notes#^bbbb2222-0000|the call]] Gone");
    expect(counts.intoCraft).toBe(1);
  });

  it("a block-id comment becomes `^id` on its block; <mark> becomes ==…==", () => {
    expect(craftToMarkdown('A decision. <!-- {"blockId":"DDDD0000-1111"} -->\n<mark>hot</mark>', idx({}), { intoCraft: 0 })).toBe("A decision. ^dddd0000-1111\n==hot==");
  });
});

describe("golden: a Craft space exported as Markdown (Hebrew, synthetic)", () => {
  const run = async () => {
    const { opened } = await openExport(readFiles(GOLDEN));
    return { v: convertExport(detectImportSource([...opened.keys()], opened), opened, "Imported/craft"), detected: detectImportSource([...opened.keys()], opened) };
  };

  it("is detected as Craft; 0 attachments lost; 100% of internal links reach their note (≥ 98%)", async () => {
    const { v, detected } = await run();
    expect(detected).toBe("craft");
    expect(v.notes.size).toBe(3);
    expect(v.sourceAttachments).toBe(3);
    expect(v.attachments.size).toBe(3);
    const s = linkStats(v);
    expect(s.total).toBeGreaterThanOrEqual(7);
    expect(s.resolved / s.total).toBeGreaterThanOrEqual(0.98);
    expect(s.unresolved).toEqual([]);
    expect(v.warnings.filter((w) => w.reason === "craftLink")).toEqual([]);
  });

  it("links between documents and to a block are wikilinks; images and files keep working; Hebrew and RLM marks are intact", async () => {
    const { v } = await run();
    const plan = v.notes.get("תכנון רבעוני.md")!;
    expect(plan).toContain("[[גרסה 2]]");
    expect(plan).toContain("[[מסמך הדרישות]]");
    expect(plan).toContain("[[גרסה 2#^dddd0000-1111-4222-8333-444455556666|ההחלטה]]");
    expect(plan).toContain("==לוח הזמנים==");
    expect(plan).not.toContain("craftdocs://");
    expect(v.notes.get("גרסה 2.md")).toContain("נשיק בחורף. ^dddd0000-1111-4222-8333-444455556666");
    expect(v.notes.get("גרסה 2.md")).toContain("‏2.0‏");
  });

  it("a link to a document that is not in the export keeps its text and is reported", () => {
    const v = convertCraft(new Map([["a.md", enc.encode("[Elsewhere](craftdocs://open?blockId=ZZZ&spaceId=S)\n")]]));
    expect(v.notes.get("a.md")).toBe("Elsewhere\n");
    expect(v.warnings).toEqual([{ path: "a.md", reason: "craftLink", detail: "1" }]);
  });

  it("a Craft TextBundle (info.json from Craft) is detected as Craft and converted the same way", async () => {
    const files = new Map([
      ["Doc.textbundle/text.md", enc.encode("# Doc\n\n[Other](craftdocs://open?blockId=1&spaceId=S)\n\n![](assets/i.png)\n")],
      ["Doc.textbundle/info.json", enc.encode('{"version":2,"creatorIdentifier":"com.lukilabs.lukiapp"}')],
      ["Doc.textbundle/assets/i.png", new Uint8Array([1])],
      ["Other.md", enc.encode("# Other\n")],
    ]);
    expect(detectImportSource([...files.keys()], files)).toBe("craft");
    const v = convertCraft(files);
    expect(v.notes.get("Doc.md")).toContain("[[Other]]");
    expect(v.notes.get("Doc.md")).toContain("![](assets/Doc/i.png)");
    expect(v.notes.get("Doc.md")).toContain("source: Craft");
  });
});

describe("import:diff", () => {
  it("Craft is a row of the golden table and passes (the oracle: Obsidian's Markdown import, the files as they are)", async () => {
    const cases = CASES.filter((c: { source: string }) => c.source === "craft");
    expect(cases.length).toBe(1);
    const g = await runGolden((source: string, files: Map<string, Uint8Array>) => convertExport(source as "craft", files, "Imported/x"), { cases });
    expect(g.pass, JSON.stringify(g.results[0].rows)).toBe(true);
    expect(g.results[0].rows.find((r: { metric: string }) => r.metric === "hebrew").oracle).toBeGreaterThan(40);
  });
});
