/**
 * W1.35: the Vercel build is the gate. A preview runs every check; a
 * production build only builds; the deploy config calls the script.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { GATES, GATE_EXTRA, PREVIEW_GATES, PRODUCTION_GATES, gatesFor, vitestSummary } from "../../scripts/vercel-build.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { E2E_SPECS, boxMinutes } from "../../scripts/e2e-gate.mjs";

const ROOT = resolve(__dirname, "..", "..");
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };

describe("scripts/vercel-build.mjs", () => {
  it("runs every gate on a preview, and only build + budget in production", () => {
    expect(gatesFor({ VERCEL_ENV: "preview" })).toEqual(["build", "budget", "vitest", "e2e", "i18n:check", "hygiene", "docs:sync", "licenses"]);
    expect(gatesFor({ VERCEL_ENV: "production" })).toEqual(["build", "budget"]);
    // Not on Vercel: a local run reproduces a preview build.
    expect(gatesFor({})).toEqual(PREVIEW_GATES);
    expect(gatesFor({ VERCEL_ENV: "preview" }, ["--production"])).toEqual(PRODUCTION_GATES);
  });

  it("every gate is an npm script that exists", () => {
    for (const gate of PREVIEW_GATES) {
      const args = GATES[gate] as string[];
      const script = args[args.length - 1];
      expect(pkg.scripts[script], gate).toBeDefined();
    }
  });

  it("a failed vitest run ends with one block naming every failing file (W1.1)", () => {
    expect(GATE_EXTRA.vitest).toContain("--reporter=json");
    const lines = vitestSummary({
      numFailedTestSuites: 2,
      numTotalTestSuites: 3,
      numFailedTests: 1,
      numPassedTests: 9,
      numTotalTests: 10,
      testResults: [
        { name: "/vercel/path0/src/__tests__/a.test.ts", status: "failed", assertionResults: [{ fullName: "a works", status: "failed", failureMessages: ["\u001b[31mAssertionError: expected 1 to be 2\u001b[39m\n    at x"] }] },
        { name: "/vercel/path0/src/__tests__/b.test.ts", status: "failed", message: "Error: Failed to load url ./missing\n stack", assertionResults: [] },
        { name: "/vercel/path0/src/__tests__/c.test.ts", status: "passed", assertionResults: [] },
      ],
    }) as string[];
    expect(lines[0]).toBe("✗ vitest summary: files 2 failed / 3; tests 1 failed, 9 passed / 10");
    expect(lines).toContain("  src/__tests__/a.test.ts: 1 failed");
    expect(lines).toContain("      AssertionError: expected 1 to be 2");
    expect(lines).toContain("  src/__tests__/b.test.ts: the file failed to run");
    expect(lines.join("\n")).not.toContain("c.test.ts");
    expect(vitestSummary(null)).toBeNull();
  });

  it("the upload keeps what the gates read: e2e specs, docs, native configs (W1.1)", () => {
    const ignore = readFileSync(resolve(ROOT, ".vercelignore"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    for (const tree of ["e2e", "docs", "src-tauri", "ios", "android"]) expect(ignore, tree).not.toContain(tree);
  });

  it("the e2e gate's time box ends by minute 38 of the build (Vercel stops at 45)", () => {
    const t0 = 1_000_000_000_000;
    const min = 60_000;
    expect(boxMinutes({}, t0)).toBe(8); // not inside vercel-build: the default box
    expect(boxMinutes({ LUMEN_BUILD_STARTED: String(t0) }, t0 + 5 * min)).toBe(8);
    expect(boxMinutes({ LUMEN_BUILD_STARTED: String(t0) }, t0 + 32.5 * min)).toBe(5);
    expect(boxMinutes({ LUMEN_BUILD_STARTED: String(t0) }, t0 + 40 * min)).toBe(0);
    expect(GATES.e2e).toEqual(["run", "-s", "e2e:gate"]);
    // The whole chromium project took 29.7 min on the build machine; the gate runs the specs that fit.
    expect(E2E_SPECS).toEqual(["e2e/smoke.spec.ts"]);
    expect(PREVIEW_GATES.indexOf("e2e")).toBe(PREVIEW_GATES.indexOf("vitest") + 1);
  });

  it("deploy/vercel.base.json builds through it", () => {
    const base = JSON.parse(readFileSync(resolve(ROOT, "deploy/vercel.base.json"), "utf8")) as { buildCommand?: string };
    expect(base.buildCommand).toBe("node scripts/vercel-build.mjs");
  });
});
