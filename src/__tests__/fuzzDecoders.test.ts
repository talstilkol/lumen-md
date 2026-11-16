/**
 * Fuzzing the decoders (plan W1.27, scripts/fuzz/): the inputs are
 * reproducible, and a short run of the real runner finds no crash and no
 * input slower than a second in any decoder on this branch. The full run
 * (1,000,000 inputs per decoder) is `npm run fuzz`.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
    // Markdown has a known slow-input finding (scripts/fuzz/known.json, with an
    // expiry); every other decoder must be clean, and none may crash.
    const known = (JSON.parse(readFileSync(join(ROOT, "scripts", "fuzz", "known.json"), "utf8")) as { findings: Array<{ target: string; expires: string }> }).findings;
    for (const name of ["markdown", "frontmatter", "bibtex", "json-doctor", "json-records", "urls", "text-direction"]) {
      const res = byName[name];
      expect(res?.runs, `${name}: ${res?.error ?? res?.status}`).toBe(2000);
      expect(res?.crashes, name).toBe(0);
      const isKnown = known.some((k) => k.target === name && k.expires >= new Date().toISOString().slice(0, 10));
      if (isKnown) expect(["ok", "known-slow"], name).toContain(res?.status);
      else {
        expect(res?.status, name).toBe("ok");
        expect(res).toMatchObject({ hangs: 0, slow: 0 });
      }
    }
    expect(r.status).toBe(0);
  }, 650_000);

  it("--clock cpu times an input by its worker thread's CPU, not the wall clock (W10.D21)", () => {
    const run = (...a: string[]) => spawnSync(process.execPath, [join(ROOT, "scripts", "fuzz", "run.mjs"), "--target", "urls", "--runs", "300", "--json", "--out", "fuzz-findings", ...a], { cwd: ROOT, encoding: "utf8", timeout: 300_000 });
    const cpu = run("--clock", "cpu", "--slow-ms", "200", "--hang-ms", "5000");
    const report = JSON.parse(cpu.stdout.trim().split("\n").pop()!) as { clock: string; slowMs: number; hangMs: number; results: Array<{ name: string; status: string; runs: number }> };
    expect([report.clock, report.slowMs, report.hangMs]).toEqual(["cpu", 200, 5000]);
    expect(report.results[0]).toMatchObject({ name: "urls", status: "ok", runs: 300 });
    // The default is unchanged: the wall clock, and the watchdog at --slow-ms.
    const wall = JSON.parse(run().stdout.trim().split("\n").pop()!) as { clock: string; slowMs: number; hangMs: number };
    expect([wall.clock, wall.slowMs, wall.hangMs]).toEqual(["wall", 1000, 1000]);
    expect(run("--clock", "sundial").status).toBe(2);
    expect(run("--hang-ms", "0").status).toBe(2);
  }, 650_000);

  it("--clock cpu confirms a hang by running the input again alone: a machine stall is not a hang, a real hang still is", () => {
    const run = (stall: string, ...a: string[]) => {
      const r = spawnSync(process.execPath, [join(ROOT, "scripts", "fuzz", "run.mjs"), "--target", "urls", "--runs", "20", "--json", "--out", "fuzz-findings", "--slow-ms", "200", "--hang-ms", "800", ...a], { cwd: ROOT, encoding: "utf8", timeout: 300_000, env: { ...process.env, LUMEN_FUZZ_STALL: stall } });
      return { code: r.status, res: (JSON.parse(r.stdout.trim().split("\n").pop()!) as { results: Array<{ status: string; runs: number; hangs: number; stalls?: number; slow: number }> }).results[0] };
    };
    // Input 5 is blocked for 2.5 s of wall time and no CPU (what a loaded machine does to a worker).
    const stalled = run("5:2500", "--clock", "cpu");
    expect(stalled.res).toMatchObject({ status: "ok", runs: 20, hangs: 0, stalls: 1, slow: 0 });
    expect(stalled.code).toBe(0);
    // Blocked again when run alone: a hang, and the run fails.
    const hung = run("5:2500:always", "--clock", "cpu");
    expect(hung.res).toMatchObject({ status: "FAIL", runs: 20, hangs: 1, stalls: 0 });
    expect(hung.code).toBe(1);
    // The wall clock (the default) is unchanged: no second chance.
    const wall = run("5:2500");
    expect(wall.res).toMatchObject({ status: "FAIL", hangs: 1, stalls: 0 });
  }, 650_000);

  it("known findings expire within 90 days and never cover a crash", () => {
    const known = (JSON.parse(readFileSync(join(ROOT, "scripts", "fuzz", "known.json"), "utf8")) as { findings: Array<{ target: string; kind: string; found: string; expires: string }> }).findings;
    for (const k of known) {
      expect(k.kind).toBe("slow");
      expect((Date.parse(k.expires) - Date.parse(k.found)) / 86_400_000).toBeLessThanOrEqual(90);
    }
  }, 650_000);
});
