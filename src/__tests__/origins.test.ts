// @vitest-environment node
/**
 * Plan W10.B13: every golden-set part and every test fixture has an origin
 * (eval/origins.json): synthetic, real or derived-from-docs. Without the
 * label nobody can tell which number measures something real.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error plain JavaScript
import { falseRealClaims } from "../../scripts/golden/origin-claims.mjs";

type Entry = { origin: string; why: string };
const origins = JSON.parse(readFileSync("eval/origins.json", "utf8")) as { golden: Record<string, Entry>; fixtures: Record<string, Entry> };
const ALLOWED = ["synthetic", "real", "derived-from-docs"];

describe("origins (W10.B13)", () => {
  it("100% of golden-set parts have an origin, and no entry is stale", () => {
    const parts: string[] = [];
    for (const set of readdirSync("eval/golden", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
      const m = JSON.parse(readFileSync(join("eval/golden", set, "manifest.json"), "utf8")) as { parts: Array<{ id: string }> };
      for (const p of m.parts) parts.push(`${set}/${p.id}`);
    }
    expect(parts.length).toBeGreaterThan(30);
    expect(Object.keys(origins.golden).sort()).toEqual(parts.sort());
    for (const [k, v] of Object.entries(origins.golden)) {
      expect(ALLOWED, k).toContain(v.origin);
      expect(v.why.length, k).toBeGreaterThan(5);
    }
  });

  it("agrees with each SOURCES.md: 'Written for this set' is synthetic, 'The owner's …' is real", () => {
    for (const [k, v] of Object.entries(origins.golden)) {
      const [set, part] = k.split("/");
      const row = readFileSync(join("eval/golden", set, "SOURCES.md"), "utf8").split("\n").find((l) => l.startsWith(`| ${part} |`));
      expect(row, k).toBeDefined();
      if (/\| Written for this set \|/.test(row!)) expect(v.origin, k).toBe("synthetic");
      if (/\| The owner's/.test(row!)) expect(v.origin, k).toBe("real");
    }
  });

  it("100% of fixtures have an origin; unknown provenance is synthetic, never real", () => {
    const names = readdirSync("src/__tests__/fixtures");
    expect(Object.keys(origins.fixtures).sort()).toEqual([...names].sort());
    for (const [k, v] of Object.entries(origins.fixtures)) {
      expect(ALLOWED, k).toContain(v.origin);
      if (/provenance not recorded/.test(v.why)) expect(v.origin, k).toBe("synthetic");
    }
    // The corpus called "real" is synthetic apart from Evernote (W10.B5).
    expect(origins.fixtures["real-corpus"].origin).toBe("synthetic");
    expect(origins.fixtures["obsidian-corpus"].origin).toBe("real");
    expect(origins.fixtures["relatedGold.ts"].origin).toBe("synthetic");
  });
});

describe("falseRealClaims: a status may not call a synthetic set real (W10.B13)", () => {
  const flag = (t: string) => (falseRealClaims(t, origins) as Array<{ name: string }>).map((h) => h.name);

  it("flags 'real' said of a synthetic set's data", () => {
    expect(flag("Import fidelity on the real-corpus: a real corpus of 245 files.")).toContain("real-corpus");
    expect(flag("relatedGold: Recall@5 100% on 100 real pairs.")).toContain("relatedGold");
    expect(flag("bidi: סט אמיתי של 40 שורות.")).toContain("bidi");
  });

  it("does not flag a real app or library, or a real set", () => {
    expect(flag("mermaidGolden 21/21 with the real Mermaid 11.16.1.")).toEqual([]);
    expect(flag("חסר: הרצה ב-Obsidian אמיתי אצל הבעלים.")).toEqual([]);
    expect(flag("retrieval/heq: real data from HeQ.")).toEqual([]);
    expect(flag("obsidian-corpus: real vaults at pinned commits.")).toEqual([]);
  });
});
