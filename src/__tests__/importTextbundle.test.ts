/**
 * Plan W13.F1 — TextBundle and TextPack (src/storage/import/textbundle.ts):
 * the bundle format of Ulysses, iA Writer, Craft and Bear. `info.json` and
 * `assets/` are read; each bundle becomes a note, its assets follow it.
 *
 * Inputs: Obsidian Importer's public TextBundle fixtures (MIT, copied
 * unchanged: a v1 and a v2 bundle, two .textpack files, a Ulysses export)
 * against its recorded output, and lumen-md's golden Hebrew bundles
 * (synthetic). Last, `npm run import:diff` with no folders: the golden table
 * of every format, whose new rows are Roam, TextBundle and Craft.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { zip } from "../storage/zip";
import { convertTextBundle, bundleCreator } from "../storage/import/textbundle";
import { convertExport, detectImportSource, expandArchives, openExport } from "../storage/import/convert";
import { linkStats } from "../storage/import/links";
// @ts-expect-error — plain .mjs helpers without types
import { CASES, runGolden, readFiles, goldenMarkdown } from "../../scripts/lib/importDiffCases.mjs";

const enc = new TextEncoder();
const GOLDEN = "src/__tests__/fixtures/import-golden/textbundle";

describe("one bundle", () => {
  it("the note is named after the bundle, its assets move to assets/<note>/ and every link follows — Markdown, <img>, percent-encoded", () => {
    const v = convertTextBundle(
      new Map([
        ["Essay.textbundle/text.md", enc.encode("# Essay\n\n![](assets/a%20b.png) <img src=\"assets/c.png\" width=\"9\">\n\n`![](assets/a b.png)` stays an example\n")],
        ["Essay.textbundle/info.json", enc.encode('{"version":2,"creatorIdentifier":"pro.writer.mac"}')],
        ["Essay.textbundle/assets/a b.png", new Uint8Array([1])],
        ["Essay.textbundle/assets/c.png", new Uint8Array([2])],
        ["Essay.textbundle/assets/d.pdf", new Uint8Array([3])],
      ]),
    );
    const md = v.notes.get("Essay.md")!;
    expect(md).toContain("![](<assets/Essay/a b.png>)");
    expect(md).toContain('<img src="assets/Essay/c.png" width="9">');
    expect(md).toContain("`![](assets/a b.png)` stays an example");
    // An asset no link points at is listed at the end: nothing is lost.
    expect(md).toContain("[d](assets/Essay/d.pdf)");
    expect(md).toContain("source: iA Writer");
    expect(v.sourceAttachments).toBe(3);
    expect(v.attachments.size).toBe(3);
  });

  it("a bundle without text is reported; a broken info.json does not stop the note", () => {
    const v = convertTextBundle(
      new Map([
        ["Empty.textbundle/info.json", enc.encode("{}")],
        ["Broken.textbundle/text.markdown", enc.encode("hello")],
        ["Broken.textbundle/info.json", enc.encode("{nope")],
      ]),
    );
    expect(v.skipped).toEqual([{ path: "Empty.textbundle", reason: "unreadable", detail: "no text.md" }]);
    expect(v.notes.get("Broken.md")).toBe("hello");
  });

  it("the creator is read from info.json", () => {
    expect(bundleCreator({ creatorIdentifier: "com.ulyssesapp.mac" })).toBe("Ulysses");
    expect(bundleCreator({ creatorIdentifier: "net.shinyfrog.bear" })).toBe("Bear");
    expect(bundleCreator({})).toBeUndefined();
  });
});

describe("archives and detection", () => {
  it("a .textpack opens in place (no extra folder), nested in a zip too", async () => {
    const pack = await zip([{ name: "Note.textbundle/text.md", data: "x" }, { name: "Note.textbundle/info.json", data: "{}" }]);
    const opened = await expandArchives(new Map([["Export/Note.textpack", new Uint8Array(pack)], ["Export/other.md", enc.encode("y")]]));
    expect([...opened.keys()].sort()).toEqual(["Export/Note.textbundle/info.json", "Export/Note.textbundle/text.md", "Export/other.md"]);
  });

  it("bundles from Bear stay Bear; from Ulysses or iA Writer they are TextBundle; by paths alone (no contents) it stays Bear as before", () => {
    const bear = new Map([["N.textbundle/info.json", enc.encode('{"net.shinyfrog.bear":{}}')], ["N.textbundle/text.md", enc.encode("x")]]);
    const ul = new Map([["N.textbundle/info.json", enc.encode('{"creatorIdentifier":"com.ulyssesapp.mac"}')], ["N.textbundle/text.md", enc.encode("x")]]);
    expect(detectImportSource([...bear.keys()], bear)).toBe("bear");
    expect(detectImportSource([...ul.keys()], ul)).toBe("textbundle");
    expect(detectImportSource([...ul.keys()])).toBe("bear");
  });
});

describe("golden: Hebrew bundles from iA Writer and Ulysses, one of them a .textpack (synthetic)", () => {
  it("0 attachments lost, 100% of internal links reach their note or file (≥ 98%), niqqud intact", async () => {
    const { opened } = await openExport(readFiles(GOLDEN));
    expect(detectImportSource([...opened.keys()], opened)).toBe("textbundle");
    const v = convertExport("textbundle", opened, "Imported/tb");
    expect([...v.notes.keys()].sort()).toEqual(["Ulysses/פרק א.md", "Ulysses/פרק ב.md", "מאמר.md"]);
    expect(v.sourceAttachments).toBe(6);
    expect(v.attachments.size).toBe(6);
    const s = linkStats(v);
    expect(s.total).toBeGreaterThanOrEqual(8);
    expect(s.resolved / s.total).toBeGreaterThanOrEqual(0.98);
    expect(s.unresolved).toEqual([]);
    expect(v.notes.get("מאמר.md")).toContain("בְּרֵאשִׁית בָּרָא".normalize("NFC"));
  });
});

describe("against Obsidian Importer, on its own TextBundle fixtures", () => {
  it("reaches the importer's recorded output on every metric", async () => {
    const cases = CASES.filter((c: { source: string }) => c.source === "textbundle");
    const g = await runGolden((source: string, files: Map<string, Uint8Array>) => openExport(files).then(({ opened }) => convertExport(source as "textbundle", opened, "Imported/x")), { cases });
    expect(g.pass, goldenMarkdown(g)).toBe(true);
    expect(g.results[0].rows.find((r: { metric: string }) => r.metric === "notes")).toMatchObject({ lumen: 6, oracle: 6 });
  });

  it("an empty golden table fails: nothing compared proves nothing", async () => {
    expect((await runGolden(async () => ({ notes: new Map(), attachments: new Map() }), { cases: [] })).pass).toBe(false);
    const missing = await runGolden(async () => ({ notes: new Map(), attachments: new Map() }), { cases: [{ id: "x", format: "x", source: "lumen", input: "nope", oracle: "nope" }] });
    expect(missing.pass).toBe(false);
  });
});

describe("npm run import:diff (no folders: the golden table)", () => {
  it("prints a row per case — Keep, Roam ×3, TextBundle, Craft — all passing, and exits 0", () => {
    // The script loads the TypeScript converters through tsx, and jsdom (a dev dependency) for Keep's HTML.
    const script = join(process.cwd(), "scripts/import-diff.mjs");
    const r = spawnSync(process.execPath, [script, "--json"], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const g = JSON.parse(r.stdout);
    expect(g.pass).toBe(true);
    const ids = g.results.map((x: { case: { id: string } }) => x.case.id);
    for (const id of ["keep", "roam-shapes", "roam-help", "roam-theme", "textbundle", "craft"]) expect(ids).toContain(id);
  });
});
