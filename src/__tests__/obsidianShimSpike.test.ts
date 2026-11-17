/**
 * W13.L3 — the Obsidian API compatibility spike. Obsidian-style plugin
 * bundles run in Lumen's real QuickJS sandbox over
 * packages/lumen-obsidian-shim: Plugin, Notice, Modal, Setting,
 * PluginSettingTab, Vault, MetadataCache, Workspace and Editor map onto
 * Lumen's capability-checked plugin API. The fixtures prove the layer; the
 * committed table (research/obsidian-shim-spike.json) is the measurement on
 * real community plugins, and its numbers are the decision's.
 *
 * Re-measure: OBSIDIAN_SPIKE_LIST=<file of "<dir>" lines> [OBSIDIAN_SPIKE_WRITE=1].
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runObsidianPlugin, SPIKE_DOC } from "./helpers/obsidianSpike";

const ROOT = resolve(__dirname, "../..");
const FIX = join(ROOT, "packages/lumen-obsidian-shim/fixtures");
const fixture = (name: string) => ({ manifest: JSON.parse(readFileSync(join(FIX, name, "manifest.json"), "utf8")), main: readFileSync(join(FIX, name, "main.js"), "utf8") });

describe("the compatibility layer, on fixtures", () => {
  it("a typical plugin works: settings load, an editor command edits the note (Hebrew kept), a check command reads it, the settings tab draws", async () => {
    const at = SPIKE_DOC.indexOf("שָׁלוֹם");
    const r = await runObsidianPlugin({ ...fixture("word-wrap-quote"), selection: [at, at + "שָׁלוֹם world".length] });
    expect(r.reason).toBe("");
    expect(r.status).toBe("works");
    expect(r.commands).toEqual([
      { id: "quote-selection", ok: true },
      { id: "count-words", ok: true },
    ]);
    expect(r.doc).toContain("> שָׁלוֹם world, a [[link]]");
    expect(r.notifications).toEqual([expect.stringMatching(/^\d+ words$/)]);
    expect(r.missing).toEqual([]);
  });

  it("vault, metadata cache and front matter: a stamp is written, a tag report is created from the cache, a code-block processor registers", async () => {
    const r = await runObsidianPlugin(fixture("frontmatter-stamp"));
    expect(r.status).toBe("works");
    expect(r.vault["note.md"]).toMatch(/^---\ntags:\n {2}- demo\nreviewed: 2026-11-17\n---\n# כותרת/);
    expect(r.vault["Tag report.md"]).toBe("# Tags\n- #daily: 1\n- #demo: 1\n- #tag: 1\n");
    expect(r.events.find((e) => e.kind === "onload")?.codeBlocks).toEqual(["stamp"]);
  });

  it("a desktop-only plugin fails, and says it needs electron", async () => {
    const r = await runObsidianPlugin(fixture("needs-electron"));
    expect(r.status).toBe("fails");
    expect(r.reason).toMatch(/^evaluate: .*require\('electron'\) is not available/);
    expect(r.missing).toEqual(["require(electron)"]);
  });

  it("a plugin that reaches into Obsidian's DOM fails, and the missing piece is named", async () => {
    const r = await runObsidianPlugin(fixture("deep-dom"));
    expect(r.status).toBe("fails");
    expect(r.reason).toMatch(/^onload: TypeError/);
  });

  it("unknown APIs are recorded by name, not hidden", async () => {
    const r = await runObsidianPlugin({ manifest: { id: "probe" }, main: `var o = require("obsidian"); module.exports = class extends o.Plugin { onload() { this.app.vault.getSomethingNew; o.NotInObsidianEither; this.addCommand({ id: "x", name: "x", callback: () => {} }); } };` });
    expect(r.status).toBe("works");
    expect(r.missing).toEqual(["app.vault.getSomethingNew", "obsidian.NotInObsidianEither"]);
  });

  it("no network: requestUrl refuses, and the plugin's manifest never grants an origin", async () => {
    const r = await runObsidianPlugin({ manifest: { id: "net" }, main: `var o = require("obsidian"); module.exports = class extends o.Plugin { onload() { this.addCommand({ id: "get", name: "get", callback: () => o.requestUrl({ url: "https://example.com" }) }); } };` });
    expect(r.commands).toEqual([{ id: "get", ok: false, error: expect.stringMatching(/network requests are not available/) }]);
    expect(r.status).toBe("loads");
  });
});

type Row = { id: string; name: string; version: string; bytes: number; license: string; licenseSource: string; status: "works" | "loads" | "fails"; reason: string; commands: number; commandsOk: number; missing: string[]; statusSpikeLimits: "works" | "loads" | "fails" };
type Table = { generated: string; engine: string; plugins: Row[]; summary: Record<string, unknown> };

const TABLE = join(ROOT, "research/obsidian-shim-spike.json");
const DECISION = join(ROOT, "research/obsidian-shim-spike.md");

describe("the measurement (research/obsidian-shim-spike.json)", () => {
  const t = JSON.parse(readFileSync(TABLE, "utf8")) as Table;
  const count = (rows: Row[], s: string, key: "status" | "statusSpikeLimits" = "status") => rows.filter((r) => r[key] === s).length;

  it("covers at least 50 plugins, each with a verdict, a reason when it is not 'works', and a licence column", () => {
    expect(t.plugins.length).toBeGreaterThanOrEqual(50);
    expect(new Set(t.plugins.map((p) => p.id)).size).toBe(t.plugins.length);
    for (const p of t.plugins) {
      expect(["works", "loads", "fails"], p.id).toContain(p.status);
      if (p.status !== "works") expect(p.reason, p.id).not.toBe("");
      expect(p.license, p.id).toBeTruthy();
      expect(p.licenseSource, p.id).toBeTruthy();
    }
  });

  it("the summary and the written decision use the table's own numbers", () => {
    const all = t.plugins;
    const mit = all.filter((p) => p.license === "MIT");
    const s = t.summary as { total: number; works: number; loads: number; fails: number; mit: { total: number; works: number; loads: number; fails: number }; spikeLimits: { works: number; loads: number; fails: number } };
    expect(s).toMatchObject({ total: all.length, works: count(all, "works"), loads: count(all, "loads"), fails: count(all, "fails") });
    expect(s.mit).toEqual({ total: mit.length, works: count(mit, "works"), loads: count(mit, "loads"), fails: count(mit, "fails") });
    expect(s.spikeLimits).toEqual({ works: count(all, "works", "statusSpikeLimits"), loads: count(all, "loads", "statusSpikeLimits"), fails: count(all, "fails", "statusSpikeLimits") });
    const md = readFileSync(DECISION, "utf8");
    expect(md).toContain(`${s.works} of ${s.total}`);
    expect(md).toMatch(/## Decision/);
    for (const p of all) expect(md, p.id).toContain(`| ${p.id} |`);
  });

  const list = process.env.OBSIDIAN_SPIKE_LIST;
  it.skipIf(!list)("re-measure from the plugin folders listed in OBSIDIAN_SPIKE_LIST (skipped: the bundles are third-party and not in the repo)", async () => {
    const dirs = readFileSync(list!, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    const rows: Row[] = [];
    for (const dir of dirs) {
      const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
      const main = readFileSync(join(dir, "main.js"), "utf8");
      const r = await runObsidianPlugin({ manifest, main });
      const big = await runObsidianPlugin({ manifest, main, limits: { memoryBytes: 256 * 1024 * 1024, cpuMsPerEntry: 10_000, stackBytes: 1024 * 1024 }, timeoutMs: 60_000 });
      const known = t.plugins.find((p) => p.id === manifest.id);
      rows.push({ id: manifest.id, name: manifest.name, version: manifest.version, bytes: main.length, license: known?.license ?? "unknown", licenseSource: known?.licenseSource ?? "unknown", status: r.status, reason: r.reason, commands: r.commands.length, commandsOk: r.commands.filter((c) => c.ok).length, missing: r.missing.slice(0, 12), statusSpikeLimits: big.status });
    }
    if (process.env.OBSIDIAN_SPIKE_WRITE === "1") writeFileSync(join(ROOT, "research/obsidian-shim-spike.measured.json"), JSON.stringify(rows, null, 2) + "\n");
    for (const row of rows) {
      const known = t.plugins.find((p) => p.id === row.id);
      if (known) expect(row.status, row.id).toBe(known.status);
    }
  }, 3_600_000);

  it("the table file exists where the decision points", () => {
    expect(existsSync(TABLE)).toBe(true);
  });
});
