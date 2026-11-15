/**
 * Plan W11.P5: the TTFV performance spec's budgets, verdict and wiring.
 * The spec itself (e2e/ttfv.spec.ts) runs in Playwright on a production
 * build; this checks in Node what can be checked without a browser.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  FIRST_NOTE_P75_BUDGET_MS,
  TTFV1_P75_BUDGET_MS,
  TTFV_RUNS,
  isExternalRequest,
  ttfvVerdict,
} from "../../e2e/perf/ttfv";

describe("budgets (R6 §1.2)", () => {
  it("TTFV-1 ≤ 2 s and first note ≤ 4 s at p75, over 10 runs", () => {
    expect(TTFV1_P75_BUDGET_MS).toBe(2000);
    expect(FIRST_NOTE_P75_BUDGET_MS).toBe(4000);
    expect(TTFV_RUNS).toBe(10);
  });
});

describe("ttfvVerdict", () => {
  const ten = [900, 950, 1000, 1100, 1200, 1300, 1400, 1500, 2600, 3000];

  it("takes the nearest-rank p75 (the 8th of 10)", () => {
    const v = ttfvVerdict(ten, TTFV1_P75_BUDGET_MS);
    expect(v.p75).toBe(1500);
    expect(v.max).toBe(3000);
    expect(v.pass).toBe(true);
  });

  it("fails when the p75 is over budget, not just one slow run", () => {
    expect(ttfvVerdict([...ten.slice(0, 7), 2100, 2200, 2300], TTFV1_P75_BUDGET_MS).pass).toBe(false);
  });

  it("never passes with fewer than 10 runs, or with junk values dropped below 10", () => {
    expect(ttfvVerdict(ten.slice(0, 9), TTFV1_P75_BUDGET_MS).pass).toBe(false);
    expect(ttfvVerdict([...ten.slice(0, 9), Number.NaN], TTFV1_P75_BUDGET_MS).pass).toBe(false);
    expect(ttfvVerdict([], TTFV1_P75_BUDGET_MS)).toMatchObject({ runs: 0, pass: false });
  });

  it("the boundary is inclusive", () => {
    expect(ttfvVerdict(Array(10).fill(4000), FIRST_NOTE_P75_BUDGET_MS).pass).toBe(true);
    expect(ttfvVerdict(Array(10).fill(4001), FIRST_NOTE_P75_BUDGET_MS).pass).toBe(false);
  });
});

describe("no network: what the spec refuses", () => {
  const base = "http://localhost:4173";
  it("refuses every other origin, keeps the app's own and data:/blob:", () => {
    expect(isExternalRequest("http://localhost:4173/assets/index.js", base)).toBe(false);
    expect(isExternalRequest("data:font/woff2;base64,AA", base)).toBe(false);
    expect(isExternalRequest("blob:http://localhost:4173/1234", base)).toBe(false);
    expect(isExternalRequest("https://fonts.googleapis.com/css", base)).toBe(true);
    expect(isExternalRequest("http://localhost:5173/", base)).toBe(true);
    expect(isExternalRequest("not a url", base)).toBe(true);
  });
});

describe("wiring", () => {
  const config = readFileSync("playwright.config.ts", "utf8");
  const spec = readFileSync("e2e/ttfv.spec.ts", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

  it("three ttfv projects, one per engine, and the PR runs skip @ttfv", () => {
    for (const name of ["ttfv-chromium", "ttfv-firefox", "ttfv-webkit"]) {
      expect(config).toMatch(new RegExp(`name: "${name}", grep: TTFV`));
      expect(pkg.scripts["perf:ttfv"]).toContain(`--project=${name}`);
    }
    expect(config).toMatch(/NOT_IN_PR_RUNS = \/[^/]*@ttfv/);
  });

  it("both tests are tagged, run TTFV_RUNS fresh contexts, refuse the network and assert on a production build", () => {
    expect(spec.match(/tag: "@ttfv"/g)?.length).toBe(2);
    expect(spec.match(/for \(let i = 0; i < TTFV_RUNS; i\+\+\)/g)?.length).toBe(2);
    expect(spec.match(/browser\.newContext/g)?.length).toBe(2);
    expect(spec.match(/await offline\(page/g)?.length).toBe(2);
    expect(spec).toMatch(/if \(PROD\) expect\(v\.p75.*TTFV1_P75_BUDGET_MS/);
    expect(spec).toMatch(/if \(PROD\) expect\(v\.p75.*FIRST_NOTE_P75_BUDGET_MS/);
  });
});
