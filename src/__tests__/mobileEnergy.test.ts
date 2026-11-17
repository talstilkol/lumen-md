// @vitest-environment node
/** Plan W13.V4 — the battery report's check (npm run mobile:check): filled for both phones and modes, Lumen ≤ 1.5 × the system notes app. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations
import { energyProblems, ENERGY_RATIO } from "../../scripts/lib/mobileEnergy.mjs";

const ROOT = resolve(__dirname, "..", "..");
const row = (d: string, mode: string, l: string, n: string) => `| ${d} | 26.1 | ${mode} | ${l} | ${n} | | 2026-11-20 | owner |`;
const table = (l: string[][]) => ["| device | OS | mode | Lumen | notes | ratio | measured on | by |", "|---|---|---|---|---|---|---|---|", ...l.map((r) => row(r[0], r[1], r[2], r[3]))].join("\n");

describe("the energy report", () => {
  it("the committed report has the script and fails the check until it is measured", () => {
    const md = readFileSync(join(ROOT, "docs/perf/mobile-energy.md"), "utf8");
    expect(md).toMatch(/## The script \(30 minutes/);
    expect(energyProblems(md)).toHaveLength(4);
    expect(energyProblems(md)[0]).toMatch(/not measured yet/);
  });

  it("passes within 1.5 × the notes app on every row, and names a row over it", () => {
    expect(ENERGY_RATIO).toBe(1.5);
    const ok = table([["iPhone", "airplane", "30", "25"], ["iPhone", "sync on", "40", "30"], ["Pixel", "airplane", "45", "30"], ["Pixel", "sync on", "50", "40"]]);
    expect(energyProblems(ok)).toEqual([]);
    const over = ok.replace("| Pixel | 26.1 | airplane | 45 | 30 |", "| Pixel | 26.1 | airplane | 46 | 30 |");
    expect(energyProblems(over)).toEqual(["Pixel, airplane: Lumen 46 mAh > 1.5 × notes 30 mAh"]);
  });

  it("a missing report or row fails", () => {
    expect(energyProblems("")).toEqual(["docs/perf/mobile-energy.md is missing"]);
    expect(energyProblems(table([["iPhone", "airplane", "1", "1"]]))).toHaveLength(3);
  });

  it("mobile:check runs it", () => {
    expect(readFileSync(join(ROOT, "scripts/mobile-build.mjs"), "utf8")).toMatch(/report\("Energy", energyProblems\(/);
  });
});
