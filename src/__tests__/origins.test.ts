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
const origins = JSON.parse(readFileSync("eval/origins.json", "utf8")) as { golden: Record<string, Entry>; synthetic: Record<string, Entry>; fixtures: Record<string, Entry> };
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

  it("every part of every eval/synthetic set has an origin under `synthetic`, and it is synthetic (W7.13)", () => {
    const parts: string[] = [];
    for (const set of readdirSync("eval/synthetic", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
      const m = JSON.parse(readFileSync(join("eval/synthetic", set, "manifest.json"), "utf8")) as { origin?: string; parts: Array<{ id: string }> };
      expect(m.origin, set).toBe("synthetic");
      for (const p of m.parts) parts.push(`${set}/${p.id}`);
    }
    expect(parts).toEqual(expect.arrayContaining(["retrieval-hard/hard", "retrieval-hard/crosslingual"]));
    expect(Object.keys(origins.synthetic).sort()).toEqual(parts.sort());
    for (const [k, v] of Object.entries(origins.synthetic)) {
      expect(v.origin, k).toBe("synthetic");
      expect(v.why.length, k).toBeGreaterThan(5);
      const [set, part] = k.split("/");
      expect(readFileSync(join("eval/synthetic", set, "SOURCES.md"), "utf8").split("\n").some((l) => l.startsWith(`| ${part} |`)), k).toBe(true);
    }
    // A synthetic set is never listed as golden too.
    for (const k of Object.keys(origins.synthetic)) expect(origins.golden[k], k).toBeUndefined();
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
    // eval/synthetic sets count too (W7.13).
    expect(flag("retrieval-hard: a real set of 300 HeQ questions.")).toContain("retrieval-hard");
    expect(flag("retrieval-hard/hard: real queries from HeQ.")).toContain("retrieval-hard/hard");
  });

  it("does not flag a real app or library, or a real set", () => {
    expect(flag("mermaidGolden 21/21 with the real Mermaid 11.16.1.")).toEqual([]);
    expect(flag("חסר: הרצה ב-Obsidian אמיתי אצל הבעלים.")).toEqual([]);
    expect(flag("retrieval/heq: real data from HeQ.")).toEqual([]);
    expect(flag("obsidian-corpus: real vaults at pinned commits.")).toEqual([]);
  });
});

describe("plan:check runs the origin rule (W10.B13)", () => {
  it("a plan status that calls a synthetic set real fails plan:check; the checked-in plan passes", async () => {
    const { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    // @ts-expect-error plain JavaScript
    const { run } = await import("../../scripts/plan/build.mjs");
    const dir = mkdtempSync(join(tmpdir(), "lumen-origins-"));
    try {
      mkdirSync(join(dir, "plan"), { recursive: true });
      mkdirSync(join(dir, "eval"), { recursive: true });
      for (const f of ["plan/plan.json", "plan/board.html", "MASTER_PLAN.md", "eval/origins.json"]) cpSync(f, join(dir, f));
      const plan = JSON.parse(readFileSync("plan/plan.json", "utf8"));
      // A ⏳ task anywhere in the plan, told it was measured on "real data" from a synthetic set.
      let target: { id: string; status: string } | null = null;
      const walk = (o: unknown): void => {
        if (target || !o || typeof o !== "object") return;
        const x = o as { id?: unknown; status?: unknown };
        if (typeof x.id === "string" && typeof x.status === "string" && x.status.startsWith("⏳")) target = x as { id: string; status: string };
        else Object.values(o).forEach(walk);
      };
      walk(plan);
      expect(target).not.toBeNull();
      target!.status = "⏳ measured on real data: spell-en/moby recall 0.99.";
      writeFileSync(join(dir, "plan/plan.json"), JSON.stringify(plan, null, 1) + "\n");
      expect(() => run({ root: dir, check: true })).toThrow(/synthetic set called real[\s\S]*spell-en\/moby/);
      // Without the false claim the same copy gets past the rule.
      target!.status = "⏳ measured on the synthetic set spell-en/moby: recall 0.99.";
      writeFileSync(join(dir, "plan/plan.json"), JSON.stringify(plan, null, 1) + "\n");
      expect(() => run({ root: dir, check: true })).not.toThrow(/synthetic set called real/);
      // Review 10, L8: the notes are read too (a status's detail moves there).
      (target as { notes?: string }).notes = "Measured on real data: spell-en/moby recall 0.99.";
      writeFileSync(join(dir, "plan/plan.json"), JSON.stringify(plan, null, 1) + "\n");
      expect(() => run({ root: dir, check: true })).toThrow(/synthetic set called real[\s\S]*\(notes\)[\s\S]*spell-en\/moby/);
      // And without eval/origins.json the rule cannot run: plan:check fails instead of passing.
      (target as { notes?: string }).notes = "Measured on the synthetic set.";
      writeFileSync(join(dir, "plan/plan.json"), JSON.stringify(plan, null, 1) + "\n");
      rmSync(join(dir, "eval/origins.json"));
      expect(() => run({ root: dir, check: true })).toThrow(/eval\/origins\.json is missing/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
