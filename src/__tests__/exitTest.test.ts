/**
 * Plan W13.P3 — the exit test. A golden vault (notes in three languages,
 * properties, links, an attachment, a .base, a canvas, a Lumen chart block,
 * tracked changes), its history, settings and AI profiles go out as one
 * package; the package is zipped, unzipped into a clean install and read
 * back: every SHA-256 matches and nothing differs. The Obsidian report names
 * every item that isn't plain Markdown there.
 */
import { describe, it, expect } from "vitest";
import { buildExitPackage, obsidianReport, readExitPackage, sha256Hex, verifyExitPackage, EXIT_FORMAT, type ExitSources } from "../storage/exitPackage";
import { unzip, zip } from "../storage/zip";

const enc = new TextEncoder();
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 255, 0, 128]);
const GOLDEN: ExitSources = {
  created: "2026-11-17T00:00:00.000Z",
  files: [
    { path: "Welcome.md", data: enc.encode("---\ntitle: Welcome\ntags: [start]\nstatus: done\n---\n# Welcome\n\nSee [[Projects/Plan]] and ![[img/logo.png]].\n") },
    { path: "פתקים/שָׁלוֹם.md", data: enc.encode("---\nסטטוס: טיוטה\n---\n# שלום\n\nפסקה בעברית עם [[Welcome]].\n") },
    { path: "ملاحظات/مرحبا.md", data: enc.encode("# مرحبا\n\nفقرة عربية.\n") },
    { path: "Projects/Plan.md", data: enc.encode("# Plan\n\n```chart\ntype: bar\n```\n\nA {++tracked insertion++}.\n") },
    { path: "Projects/tasks.base", data: enc.encode("filters:\n  and:\n    - file.hasTag(\"task\")\nviews:\n  - type: table\n") },
    { path: "Board.canvas", data: enc.encode('{"nodes":[],"edges":[]}') },
    { path: "img/logo.png", data: png },
  ],
  history: { "Welcome.md": [{ timestamp: 1, content: "# Welcome" }, { timestamp: 2, content: "# Welcome\n\nSee", reason: "autosave" }], "פתקים/שָׁלוֹם.md": [{ timestamp: 3, content: "# שלום" }] },
  settings: { format: "lumen-settings", version: 1, app: { theme: "dark", locale: "he" }, local: { "lumen-reading": "{}" } },
  aiProfiles: { "lumen.ai.model": "qwen2.5:7b" },
};

describe("export everything → clean install: 0 differences (acceptance)", () => {
  it("round-trips the golden vault through a .zip with every hash equal", async () => {
    const pkg = await buildExitPackage(GOLDEN);
    const bytes = await zip(pkg.map((f) => ({ name: f.path, data: f.data })));
    const back = await unzip(bytes.buffer);
    const v = await verifyExitPackage(back);
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(pkg.length - 1);
    expect(v.manifest?.format).toBe(EXIT_FORMAT);
    expect(v.manifest?.counts).toEqual({ vault: 7, history: 2, settings: 1, aiProfiles: 1 });
    const fresh = readExitPackage(back);
    expect(fresh.files.map((f) => f.path)).toEqual([...GOLDEN.files.map((f) => f.path)].sort());
    for (const f of GOLDEN.files) {
      const got = fresh.files.find((x) => x.path === f.path)!;
      expect(await sha256Hex(got.data), f.path).toBe(await sha256Hex(f.data));
    }
    expect(fresh.history).toEqual(GOLDEN.history);
    expect(fresh.settings).toEqual(GOLDEN.settings);
    expect(fresh.aiProfiles).toEqual(GOLDEN.aiProfiles);
    // Exporting the clean install again gives the same package, byte for byte.
    const again = await buildExitPackage({ ...fresh, created: GOLDEN.created });
    expect(again.map((f) => f.path)).toEqual(pkg.map((f) => f.path));
    for (let i = 0; i < pkg.length; i++) expect(await sha256Hex(again[i].data), pkg[i].path).toBe(await sha256Hex(pkg[i].data));
  });

  it("the manifest catches a changed byte, a missing file and an extra one", async () => {
    const pkg = await buildExitPackage(GOLDEN);
    const map = new Map(pkg.map((f) => [f.path, f.data]));
    const note = new Uint8Array(map.get("vault/Welcome.md")!);
    note[3] ^= 1;
    map.set("vault/Welcome.md", note);
    map.delete("vault/img/logo.png");
    map.set("vault/extra.md", enc.encode("x"));
    const v = await verifyExitPackage(map);
    expect(v.ok).toBe(false);
    expect(v.problems).toEqual(["content differs: vault/Welcome.md", "missing: vault/img/logo.png", "not in the manifest: vault/extra.md"]);
    expect((await verifyExitPackage(new Map())).ok).toBe(false);
  });
});

describe("the Obsidian report lists every item that isn't plain Markdown (acceptance)", () => {
  it("names the .base, the chart block and the tracked changes; plain notes, the canvas and the image pass", () => {
    const items = obsidianReport(GOLDEN.files).map((i) => `${i.path}: ${i.what.split(":")[0]}`);
    expect(items).toEqual(["Projects/Plan.md: a ```chart block", "Projects/Plan.md: tracked changes (CriticMarkup)", "Projects/tasks.base: Bases view (.base)"]);
  });

  it("is in the package as OBSIDIAN.md", async () => {
    const pkg = await buildExitPackage(GOLDEN);
    const md = new TextDecoder().decode(pkg.find((f) => f.path === "OBSIDIAN.md")!.data);
    expect(md).toContain("`Projects/tasks.base`");
    expect(md).toContain("history/");
  });
});
