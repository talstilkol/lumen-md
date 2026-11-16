/**
 * Wave g6 lane L6: the Mac pack and the owner pack (plan/mac-pack/L6.json,
 * plan/owner-pack/L6.json) cover every task of the lane, each entry has the
 * fields the integrator's aggregator reads, every file and npm script a
 * command names exists in the repo, the English and Hebrew pages list every
 * entry, and the lane runner (scripts/mac-pack/L6.mjs) checks `expect`
 * correctly.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { evaluate, getPath, globCount, lastJson, loadPacks } from "../../scripts/mac-pack/L6.mjs";

const ROOT = join(__dirname, "../..");
type Mac = { id: string; task: string; cmd: string; expect: Record<string, unknown>; needs: string[]; minutes: number };
type Owner = { id: string; task: string; decision: string; options: string[]; recommendation: string; why: string; sources: string[]; changes: string; draftPr: string | null; cmd: string; expect: Record<string, unknown> };
const { mac, owner } = loadPacks(ROOT) as { mac: Mac[]; owner: Owner[] };

const MAC_TASKS = ["W7.1", "W7.3", "W7.4", "W7.5", "W7.6", "W7.13", "W7.15", "W7.22", "W10.M1", "W10.M2", "W10.M3", "W10.M4", "W10.M5", "W10.M6", "W10.M7", "W10.M8", "W10.M9", "W10.M10", "W10.M11", "W10.M12", "W10.M13", "W10.C7", "W10.C8", "W10.C9", "W10.C10", "W10.C14", "W10.C16", "W10.C25", "W10.C31", "3.3", "3.5", "3.6", "3.7", "W12.E2", "W12.E3", "W12.E5", "W12.E7", "R12.8"];
const OWNER_TASKS = ["W7.7", "W7.8", "W7.10", "W7.11", "W7.12", "W7.17", "W7.19", "W7.21", "W7.23", "W7.25", "W10.C19", "W10.C29", "3.4", "W11.L4", "W11.L5", "W11.L6", "W11.L7", "W11.L8", "R12.1"];

const scripts = Object.keys(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts);
const PATH = /(?:^|[\s"'=(])((?:scripts|src|e2e|docs|data|mcp-server|packages)\/[\w@./{}-]+\.(?:mjs|ts|tsx|sh|json|md))\b/g;

describe("lane L6 packs", () => {
  it("every Mac task has a Mac entry and every owner task an owner entry; ids are unique", () => {
    expect([...new Set(mac.map((e) => e.task))].sort()).toEqual([...MAC_TASKS].sort());
    expect([...new Set(owner.map((e) => e.task))].sort()).toEqual([...OWNER_TASKS].sort());
    const ids = [...mac, ...owner].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^L6-/);
  });

  it("Mac entries: {id, cmd, expect, needs, minutes}, and expect is machine-checkable", () => {
    for (const e of mac) {
      expect(typeof e.cmd, e.id).toBe("string");
      expect(Array.isArray(e.needs), e.id).toBe(true);
      expect(typeof e.minutes, e.id).toBe("number");
      expect(Object.keys(e.expect).filter((k) => ["exit", "json", "stdout", "count"].includes(k)).length, e.id).toBeGreaterThan(0);
    }
  });

  it("owner entries: decision, options, recommendation, why, sources, changes, draftPr", () => {
    for (const o of owner) {
      for (const k of ["decision", "recommendation", "why", "changes", "cmd"] as const) expect(o[k].length, `${o.id} ${k}`).toBeGreaterThan(10);
      expect(o.options.length, o.id).toBeGreaterThanOrEqual(2);
      expect(o.sources.length, o.id).toBeGreaterThanOrEqual(1);
      expect("draftPr" in o, o.id).toBe(true);
    }
  });

  it("every repo file and npm script a command names exists", () => {
    const missing: string[] = [];
    for (const e of [...mac, ...owner]) {
      for (const m of e.cmd.matchAll(PATH)) if (!m[1].includes("{") && !m[1].includes("<") && !existsSync(join(ROOT, m[1]))) missing.push(`${e.id}: ${m[1]}`);
      // A command that moves into mcp-server/ runs that package's scripts.
      const own = e.cmd.split(/cd mcp-server/)[0];
      for (const m of own.matchAll(/npm run (?:-s )?([\w:-]+)/g)) if (!scripts.includes(m[1])) missing.push(`${e.id}: npm run ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });

  it("the English and Hebrew pages list every entry", () => {
    for (const [dir, list] of [["mac-pack", mac], ["owner-pack", owner]] as const) {
      for (const f of ["L6.md", "L6.he.md"]) {
        const text = readFileSync(join(ROOT, "plan", dir, f), "utf8");
        for (const e of list) expect(text, `${dir}/${f}`).toContain(`## ${e.id}`);
      }
    }
  });
});

describe("lane L6 runner: expect", () => {
  const dir = mkdtempSync(join(tmpdir(), "l6-"));
  mkdirSync(join(dir, "r/a"), { recursive: true });
  writeFileSync(join(dir, "r/x.json"), JSON.stringify({ stats: { unexpected: 0, expected: 3 }, "0.5": { met: true } }));
  writeFileSync(join(dir, "r/a/one.apk"), "");
  writeFileSync(join(dir, "r/a/two.ipa"), "");

  it("paths with dotted keys, the last JSON line of stdout, globs", () => {
    expect(getPath({ a: { "b.c": 1 } }, ["a", "b.c"])).toBe(1);
    expect(getPath({ a: { b: 2 } }, "a.b")).toBe(2);
    expect(lastJson("noise\n{\"pass\":true}\n")).toEqual({ pass: true });
    expect(globCount("r/a/*.{apk,aab,ipa}", dir)).toBe(2);
    expect(globCount("r/*/one.apk", dir)).toBe(1);
  });

  it("passes only when every part holds", () => {
    const pw = { exit: 0, json: [{ file: "r/x.json", path: "stats.unexpected", equals: 0 }, { file: "r/x.json", path: "stats.expected", gte: 1 }] };
    expect(evaluate(pw, { exit: 0, stdout: "" }, dir).ok).toBe(true);
    expect(evaluate(pw, { exit: 1, stdout: "" }, dir).ok).toBe(false);
    expect(evaluate({ json: [{ file: "r/x.json", path: ["0.5", "met"], equals: true }] }, { exit: 0 }, dir).ok).toBe(true);
    expect(evaluate({ json: [{ file: "r/missing.json", path: "a", equals: 1 }] }, { exit: 0 }, dir).ok).toBe(false);
    expect(evaluate({ exit: 0, stdout: { path: "count", gte: 20000 } }, { exit: 0, stdout: '{"count":19999}' }, dir).ok).toBe(false);
    expect(evaluate({ count: { glob: "r/a/*.apk", gte: 2 } }, { exit: 0 }, dir).ok).toBe(false);
    expect(evaluate({}, { exit: 0 }, dir).ok).toBe(false);
  });
});
