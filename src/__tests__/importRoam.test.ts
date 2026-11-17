/**
 * Plan W13.F1 — the Roam Research import (src/storage/import/roam.ts):
 * blocks → an outline, `((uid))` → `^id` and references, daily-note
 * titles → `journal/YYYY-MM-DD`, attributes → properties, tables, tasks.
 *
 * Two kinds of input: Obsidian Importer's own public Roam fixtures (MIT,
 * copied unchanged — fixtures/obsidian-importer/SOURCES.md), against its
 * recorded output; and lumen-md's golden Hebrew graph (synthetic,
 * fixtures/import-golden/SOURCES.md), where every link has its target in
 * the export, so "≥ 98% of internal links" is measurable.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { convertRoam, looksLikeRoam, roamDailyDate } from "../storage/import/roam";
import { convertExport, detectImportSource, openExport } from "../storage/import/convert";
import { linkStats } from "../storage/import/links";
// @ts-expect-error — plain .mjs helpers without types
import { CASES, runGolden, readFiles } from "../../scripts/lib/importDiffCases.mjs";

const enc = new TextEncoder();
const graph = (pages: unknown) => new Map([["Roam-Export/graph.json", enc.encode(JSON.stringify(pages))]]);
const one = (pages: unknown) => convertRoam(graph(pages));
const GOLDEN = "src/__tests__/fixtures/import-golden/roam";

describe("daily-note titles", () => {
  it("Roam's `Month Nth, YYYY` → ISO; anything else is not a date", () => {
    expect(roamDailyDate("January 1st, 2021")).toBe("2021-01-01");
    expect(roamDailyDate("November 22nd, 2026")).toBe("2026-11-22");
    expect(roamDailyDate("March 13th, 2024")).toBe("2024-03-13");
    expect(roamDailyDate("March 3rd, 2024")).toBe("2024-03-03");
    expect(roamDailyDate("March 3th, 2024")).toBeNull(); // the wrong suffix is a title, not a date
    expect(roamDailyDate("Smarch 1st, 2024")).toBeNull();
    expect(roamDailyDate("1st of January")).toBeNull();
  });
});

describe("one page", () => {
  it("blocks stay an outline; tasks, italics, highlights, page links", () => {
    const v = one([
      { title: "A", children: [{ string: "{{[[TODO]]}} write __this__", uid: "a1", children: [{ string: "^^nested^^ [[B]]", uid: "a2" }] }, { string: "{{DONE}} done", uid: "a3" }] },
      { title: "B", children: [] },
    ]);
    expect(v.notes.get("A.md")).toContain("- [ ] write *this*\n    - ==nested== [[B]]\n- [x] done");
  });

  it("top-level `Name:: value` blocks become properties (not one with children or a referenced one)", () => {
    const v = one([
      {
        title: "Book",
        children: [
          { string: "Author:: [[Ada]]", uid: "p1" },
          { string: "Status:: read", uid: "p2" },
          { string: "Themes::", uid: "p3", children: [{ string: "#history", uid: "p4" }] },
          { string: "Quoted:: yes", uid: "quoted-1" },
        ],
      },
      { title: "Other", children: [{ string: "see ((quoted-1))", uid: "o1" }] },
    ]);
    const book = v.notes.get("Book.md")!;
    expect(book).toMatch(/^---\nAuthor: "\[\[Ada\]\]"\nStatus: read\n/);
    expect(book).toContain("- Themes::\n    - #history");
    expect(book).toContain("- Quoted:: yes ^quoted-1");
  });

  it("headings leave the outline as Markdown headings; a deep one restarts the outline under it", () => {
    const v = one([{ title: "H", children: [{ string: "Top", uid: "h1", heading: 2, children: [{ string: "child", uid: "h2" }] }, { string: "item", uid: "h3", children: [{ string: "**Deep**", uid: "h4", heading: 3, children: [{ string: "under", uid: "h5" }] }] }] }]);
    const md = v.notes.get("H.md")!;
    expect(md).toContain("## Top\n\n- child");
    expect(md).toContain("### Deep\n\n- under");
    expect(md).not.toMatch(/^ {4}- under/m); // no list item left indented under a heading (it would read as code)
  });

  it("a table: each path to a leaf is a row; a pipe in a cell is escaped; inside an item it is indented to the item", () => {
    const v = one([{ title: "T", children: [{ string: "{{[[table]]}}", uid: "t", children: [{ string: "k", uid: "t1", children: [{ string: "a|b", uid: "t2" }] }, { string: "x", uid: "t3", children: [{ string: "y", uid: "t4" }] }] }] }]);
    expect(v.notes.get("T.md")).toContain("| k | a\\|b |\n| --- | --- |\n| x | y |");
  });

  it("block references: `^id` on the target, `![[Page#^id]]`, aliases, embeds; `((an aside))` and missing uids stay text", () => {
    const v = one([
      { title: "Src", children: [{ string: "the claim", uid: "claim_01x" }, { string: "```js\nx()```", uid: "fence0001" }] },
      {
        title: "Refs",
        children: [
          { string: "see ((claim_01x))", uid: "r1" },
          { string: "[alias](((claim_01x)))", uid: "r2" },
          { string: "{{embed: ((fence0001))}}", uid: "r3" },
          { string: "{{[[embed]]: [[Src]]}}", uid: "r4" },
          { string: "a ((long aside)) and ((nosuchblk))", uid: "r5" },
        ],
      },
    ]);
    const src = v.notes.get("Src.md")!;
    // `_` is not allowed in a block id: it becomes `-`.
    expect(src).toContain("- the claim ^claim-01x");
    // A block of several lines carries its id on a line of its own, after the fence.
    expect(src).toContain("  ```\n  ^fence0001");
    const refs = v.notes.get("Refs.md")!;
    expect(refs).toContain("see ![[Src#^claim-01x]]");
    expect(refs).toContain("[[Src#^claim-01x|alias]]");
    expect(refs).toContain("![[Src#^fence0001]]");
    expect(refs).toContain("![[Src]]");
    expect(refs).toContain("a ((long aside)) and ((nosuchblk))");
  });

  it("daily notes go to journal/YYYY-MM-DD.md and every link follows, even to a day not in the export", () => {
    const v = one([
      { title: "January 2nd, 2021", children: [{ string: "back to [[Index]] and [[January 3rd, 2021]]", uid: "d1" }] },
      { title: "Index", children: [{ string: "[[January 2nd, 2021]]", uid: "i1" }] },
    ]);
    expect([...v.notes.keys()].sort()).toEqual(["Index.md", "journal/2021-01-02.md"]);
    expect(v.notes.get("Index.md")).toContain("[[2021-01-02|January 2nd, 2021]]");
    expect(v.notes.get("journal/2021-01-02.md")).toContain("[[2021-01-03|January 3rd, 2021]]");
  });

  it("namespaces become folders; titles a link cannot carry lose `[]#|^`, two that collide both survive", () => {
    const v = one([
      { title: "roam/css", children: [{ string: "x", uid: "c" }] },
      { title: "Colliding [name]", children: [{ string: "one", uid: "c1" }] },
      { title: "Colliding name", children: [{ string: "two", uid: "c2" }] },
      { title: "Use", children: [{ string: "[[roam/css]] [[Colliding [name]]]", uid: "u" }] },
    ]);
    expect([...v.notes.keys()].sort()).toEqual(["Colliding name 2.md", "Colliding name.md", "Use.md", "roam/css.md"]);
    expect(v.notes.get("Use.md")).toContain("[[roam/css]]");
  });

  it("Roam-only components go; others lose their fake link; CSS class refs go; firebase files stay links with a warning", () => {
    const v = one([{ title: "C", children: [{ string: "{{[[POMO]]}} {{word-count}} {{[[kanban]]}} [[.rm-grid]] text #.rm-hide ![](https://firebasestorage.googleapis.com/x.png)", uid: "c" }] }]);
    const md = v.notes.get("C.md")!;
    expect(md).not.toContain("POMO");
    expect(md).not.toContain("[[kanban]]");
    expect(md).not.toContain("rm-");
    expect(md).toContain("![](https://firebasestorage.googleapis.com/x.png)");
    expect(v.warnings).toContainEqual({ path: "C.md", reason: "remoteAttachment", detail: "1" });
  });

  it("dates become created / updated; a page without them is reported", () => {
    const v = one([{ title: "D", "create-time": 1600000000000, "edit-time": 1600000100000, children: [] }, { title: "N", children: [] }]);
    expect(v.notes.get("D.md")).toContain("created: 2020-09-13T12:26:40Z\nupdated: 2020-09-13T12:28:20Z");
    expect(v.warnings).toContainEqual({ path: "N.md", reason: "noDates" });
  });

  it("broken JSON, a JSON that is not Roam, and an untitled page are reported, never thrown", () => {
    const v = convertRoam(
      new Map([
        ["bad.json", enc.encode("[{")],
        ["other.json", enc.encode('{"a":1}')],
        ["g.json", enc.encode(JSON.stringify([{ title: "", uid: "x", children: [] }, { title: "Ok", children: [] }]))],
      ]),
    );
    expect(v.skipped.map((s) => s.reason)).toEqual(["unreadable", "unreadable", "unreadable"]);
    expect([...v.notes.keys()]).toEqual(["Ok.md"]);
  });
});

describe("detection", () => {
  it("a Roam JSON export is detected from its contents, a Keep Takeout is not mistaken for it", () => {
    const files = graph([{ title: "A", uid: "u", children: [] }]);
    expect(detectImportSource([...files.keys()], files)).toBe("roam");
    expect(looksLikeRoam([{ a: 1 }])).toBe(false);
    const keep = new Map([["Takeout/Keep/n.json", enc.encode('[{"title":"x","children":[]}]')]]);
    expect(detectImportSource([...keep.keys()], keep)).not.toBe("roam");
  });
});

describe("golden: lumen-md's Hebrew Roam graph (synthetic)", () => {
  const run = async () => {
    const { opened } = await openExport(readFiles(GOLDEN));
    return convertExport(detectImportSource([...opened.keys()], opened), opened, "Imported/roam");
  };

  it("0 attachments lost, 100% of internal links reach their note (≥ 98% required)", async () => {
    const v = await run();
    expect(v.notes.size).toBe(5);
    expect(v.sourceAttachments - v.attachments.size).toBe(0);
    const s = linkStats(v);
    expect(s.total).toBeGreaterThanOrEqual(15);
    expect(s.resolved / s.total).toBeGreaterThanOrEqual(0.98);
    expect(s.unresolved).toEqual([]);
  });

  it("Hebrew comes through word for word (niqqud NFC), direction marks too", async () => {
    const v = await run();
    const all = [...v.notes.values()].join("\n");
    const src = readFileSync(`${GOLDEN}/Lumen-golden.json`, "utf8");
    for (const w of ["שִׁירָה", "עִבְרִית", "החלטה", "מרכזית"]) expect(all).toContain(w.normalize("NFC"));
    expect((all.match(/\u200f/g) ?? []).length).toBe((src.match(/\u200f/g) ?? []).length);
    expect(v.notes.get("ספרים/שירה.md")).toContain("![[פרויקט אלפא#^blk-decision]]");
    expect(v.notes.get("פרויקט אלפא.md")).toMatch(/^---\nסטטוס: בעבודה\n/);
    expect(v.notes.get("journal/2026-11-03.md")).toContain("[[2026-11-10|November 10th, 2026]]");
  });
});

describe("against Obsidian Importer, on its own Roam fixtures", () => {
  it("the fixtures are the importer's files, byte for byte (sha256 in SOURCES.md)", () => {
    const fix = "src/__tests__/fixtures/obsidian-importer";
    const sources = readFileSync(`${fix}/SOURCES.md`, "utf8");
    const files = [...readFiles(`${fix}/roam`).entries(), ...readFiles(`${fix}/roam-expected`).entries(), ...readFiles(`${fix}/textbundle`).entries(), ...readFiles(`${fix}/textbundle-expected`).entries()];
    expect(files.length).toBeGreaterThan(40);
    for (const [p, data] of files) expect(sources, p).toContain(createHash("sha256").update(data).digest("hex"));
  });

  it("reaches the importer's recorded output on every metric, for all three graphs", async () => {
    const cases = CASES.filter((c: { source: string }) => c.source === "roam");
    expect(cases.length).toBe(3);
    const g = await runGolden((source: string, files: Map<string, Uint8Array>) => convertExport(source as "roam", files, "Imported/x"), { cases });
    for (const r of g.results) expect(r.pass, `${r.case.id}: ${JSON.stringify(r.rows.filter((x: { status: string }) => x.status === "fail"))}`).toBe(true);
    expect(g.pass).toBe(true);
  });
});

describe("scale", () => {
  it("10,000 pages with cross-references convert in well under 10 s", () => {
    const uid = (i: number) => `b${String(i).padStart(8, "0")}`; // Roam's uids are 9 characters
    const pages = Array.from({ length: 10_000 }, (_, i) => ({ title: `דף ${i}`, uid: `p${i}`, children: [{ string: `קישור ל[[דף ${(i + 1) % 10_000}]] ו-((${uid((i + 7) % 10_000)}))`, uid: uid(i) }] }));
    const t0 = performance.now();
    const v = one(pages);
    const ms = performance.now() - t0;
    expect(v.notes.size).toBe(10_000);
    expect(v.notes.get("דף 3.md")).toContain(`^${uid(3)}`);
    expect(v.notes.get("דף 9996.md")).toContain(`![[דף 3#^${uid(3)}]]`);
    expect(ms).toBeLessThan(10_000);
  });
});
