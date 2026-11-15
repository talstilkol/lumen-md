/**
 * W11.Q12: the Vercel CI (Beta) trial for lint and unit tests, next to
 * Buildkite. ci/vercel-ci-trial/turbo.json tags exactly those two tasks (it is
 * kept out of the repo root so the existing Vercel project's build is unchanged); scripts/ci/ci-compare.mjs
 * turns one commit's runs into the decision. The Buildkite build below has the
 * shape of Buildkite's REST answer and is written for this test (synthetic
 * times); the real comparison needs both CIs to run (owner).
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error — plain .mjs script without type declarations
import { buildkiteTimes, decide } from "../../scripts/ci/ci-compare.mjs";

const TRIAL_TURBO = "ci/vercel-ci-trial/turbo.json";
const turbo = JSON.parse(readFileSync(TRIAL_TURBO, "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

const job = (step_key: string, name: string, start: string, end: string, state = "passed") => ({ type: "script", step_key, name, started_at: `2026-11-20T10:${start}Z`, finished_at: `2026-11-20T10:${end}Z`, state });
const build = {
  commit: "abc123",
  jobs: [
    { type: "waiter" },
    job("vitest-plan", ":scissors: vitest: plan the shards", "00:00", "00:30"),
    job("vitest", ":vitest: vitest shard 1", "00:40", "05:00"),
    job("vitest", ":vitest: vitest shard 2", "00:41", "06:10"),
    job("vitest-merge", ":vitest: vitest: merge + coverage gate", "06:20", "07:00"),
    job("lint", ":eslint: lint", "00:05", "02:05"),
    job("e2e-chromium", ":playwright: e2e chromium", "00:05", "20:00"),
  ],
};

describe("the Vercel CI trial (W11.Q12)", () => {
  it("keeps the trial config out of the repo root, so the existing Vercel project's build does not change", () => {
    // Vercel detects Turborepo from a root turbo.json; the trial must not be picked up by the production project.
    expect(existsSync("turbo.json")).toBe(false);
    expect(existsSync(TRIAL_TURBO)).toBe(true);
    // No root vercel.json either: the project is configured by vercel.ts, which has no `ci` key.
    expect(existsSync("vercel.json")).toBe(false);
    expect(readFileSync("vercel.ts", "utf8")).not.toMatch(/\bci\s*:/);
  });

  it("tags exactly lint and the unit tests for Vercel CI, and both are real npm scripts", () => {
    const tagged = Object.entries(turbo.tasks as Record<string, { tags?: string[] }>).filter(([, t]) => t.tags?.includes("ci")).map(([k]) => k);
    expect(tagged).toEqual(["lint", "test"]);
    expect(pkg.scripts.lint).toBe("eslint src");
    expect(pkg.scripts.test).toBe("vitest run");
    // The build, e2e and the gates stay on Buildkite.
    for (const k of ["build", "test:e2e", "e2e"]) expect(turbo.tasks[k]).toBeUndefined();
  });

  it("reads the lint step and the sharded unit tests out of a Buildkite build", () => {
    const t = buildkiteTimes(build);
    expect(t.lint).toBe(120);
    expect(t.test).toBe(420); // plan start to merge end
    expect(t.agentSeconds).toBe(120 + 30 + 260 + 329 + 40);
    expect(t.passed).toBe(true);
    expect(t.commit).toBe("abc123");
  });

  it("keeps Vercel CI only if it needs no restructuring, costs nothing and is not 1.5x slower", () => {
    const bk = { lint: 120, test: 420 };
    expect(decide(bk, { lint: 150, test: 600 })).toEqual({ decision: "keep as fallback", reasons: [] });
    expect(decide(bk, { lint: 181, test: 400 }).reasons).toEqual(["lint: 181 s on Vercel vs 120 s on Buildkite"]);
    expect(decide(bk, { lint: 100 }).reasons).toEqual(["no Vercel time for test"]);
    expect(decide(bk, { lint: 100, test: 100 }, { cost: 20, restructure: true })).toEqual({ decision: "drop", reasons: ["needs the repo restructured for Turborepo", "costs $20/month"] });
  });

  it("the decision record has the rule, the Buildkite Free terms and an empty result to fill", () => {
    const doc = readFileSync("docs/dev/decisions/vercel-ci-trial.md", "utf8");
    expect(doc).toContain("10 concurrent self-hosted jobs");
    expect(doc).toContain("1.5× slower");
    expect(doc).toMatch(/\| lint \| owed \| owed \|/);
    // How to run it, on a branch the existing project's deployments ignore.
    expect(doc).toContain("## How to run the trial");
    expect(doc).toContain("cp ci/vercel-ci-trial/turbo.json turbo.json");
    expect(doc).toContain("trial/vercel-ci");
  });
});
