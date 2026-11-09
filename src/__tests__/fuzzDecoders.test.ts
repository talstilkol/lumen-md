/**
 * Fuzzing the decoders (plan W1.27, scripts/fuzz/): the inputs are
 * reproducible, and a short run of the real runner finds no crash and no
 * input slower than a second in any decoder on this branch. The full run
 * (1,000,000 inputs per decoder) is `npm run fuzz`.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { generate, type GenKind } from "../../scripts/fuzz/generators";

const ROOT = resolve(__dirname, "..", "..");
const KINDS: GenKind[] = ["markdown", "yaml", "json", "bibtex", "url", "text", "csv", "manifest"];

describe("decoder fuzzing", () => {
  it("each input is a pure function of (seed, index), and the inputs vary", () => {
    for (const kind of KINDS) {
      const a = Array.from({ length: 200 }, (_, i) => generate(kind, 7, i));
      expect(Array.from({ length: 200 }, (_, i) => generate(kind, 7, i))).toEqual(a);
      expect(new Set(a).size, kind).toBeGreaterThan(150);
      expect(a.some((s) => s.length > 1000), kind).toBe(true);
    }
    expect(generate("markdown", 1, 0)).not.toBe(generate("markdown", 2, 0));
  });

  it("the runner: 2,000 inputs per decoder, every decoder on the branch loads, 0 crashes, 0 inputs over 1 s", () => {
    const r = spawnSync(process.execPath, [join(ROOT, "scripts", "fuzz", "run.mjs"), "--runs", "2000", "--json", "--out", "fuzz-findings"], { cwd: ROOT, encoding: "utf8", timeout: 600_000 });
    const report = JSON.parse(r.stdout.trim().split("\n").pop()!) as { results: Array<{ name: string; status: string; runs?: number; crashes?: number; hangs?: number; slow?: number; error?: string }> };
    const byName = Object.fromEntries(report.results.map((x) => [x.name, x]));
    for (const name of ["markdown", "frontmatter", "bibtex", "json-doctor", "json-records", "urls", "text-direction"]) {
      expect(byName[name]?.status, `${name}: ${byName[name]?.error ?? ""}`).toBe("ok");
      expect(byName[name]).toMatchObject({ runs: 2000, crashes: 0, hangs: 0, slow: 0 });
    }
    expect(r.status).toBe(0);
  }, 650_000);
});
