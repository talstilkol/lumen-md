// @vitest-environment node
/**
 * Plan 0.19 (W10.E25): Buildkite posts the pr:check report on the PR (one
 * comment, edited on every build, pass or fail), and renovate.json groups
 * and schedules the dependency updates.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
// @ts-expect-error — plain .mjs module without type declarations
import { MARKER, MAX_BODY, commentBody, planComment } from "../../scripts/buildkite/pr-comment.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { buildPipeline, pipelineRules } from "../../scripts/buildkite/lib.mjs";

type Step = { key: string; command: string };
const ci = () => parse(readFileSync(".github/workflows/ci.yml", "utf8"), { uniqueKeys: false });

describe("the pr:check comment", () => {
  it("carries the marker, the report and the build; a huge report is cut under GitHub's limit", () => {
    const body = commentBody("## PR check (plan 0.19)\n**PR check: passed.**", { buildUrl: "https://buildkite.com/x/1", sha: "a".repeat(40) });
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain("**PR check: passed.**");
    expect(body).toContain("([build](https://buildkite.com/x/1)) for `aaaaaaaaaaaa`");
    const big = commentBody("x".repeat(200_000));
    expect(big.length).toBeLessThanOrEqual(MAX_BODY);
    expect(big).toContain("ci-out/pr-check.md");
  });

  it("edits our own marked comment, never someone else's, and creates one otherwise", () => {
    const bot = "lumen-ci";
    expect(planComment([], bot)).toEqual({ action: "create" });
    expect(planComment([{ id: 1, body: `${MARKER}\nold`, user: { login: "someone" } }], bot)).toEqual({ action: "create" });
    expect(planComment([{ id: 2, body: "hi", user: { login: bot } }, { id: 3, body: `${MARKER}\nold`, user: { login: bot } }], bot)).toEqual({ action: "update", id: 3 });
  });

  it("outside a PR build or without a token it says so and exits 0", () => {
    const run = (env: Record<string, string>) => spawnSync(process.execPath, ["scripts/buildkite/pr-comment.mjs", "ci-out/none.md"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } });
    const notPr = run({ BUILDKITE_PULL_REQUEST: "false" });
    expect(notPr.status).toBe(0);
    expect(notPr.stdout).toContain("not a pull-request build");
    const noReport = run({ BUILDKITE_PULL_REQUEST: "12" });
    expect(noReport.status).toBe(0);
    expect(noReport.stdout).toContain("no report");
  });
});

describe("the pr-check job posts after pr:check, pass or fail, and keeps pr:check's result", () => {
  const prCheck = () => buildPipeline(ci()).steps.find((s: Step) => s.key === "pr-check") as Step;

  it("is in the committed pipeline and the rule catches its removal", () => {
    const committed = parse(readFileSync(".buildkite/pipeline.yml", "utf8")).steps.find((s: Step) => s.key === "pr-check");
    expect(committed.command).toContain("node scripts/buildkite/pr-comment.mjs ci-out/pr-check.md || true");
    expect(pipelineRules(buildPipeline(ci()))).toEqual([]);
    const p = buildPipeline(ci());
    const s = p.steps.find((x: Step) => x.key === "pr-check");
    s.command = s.command.replace(/node scripts\/buildkite\/pr-comment\.mjs[^\n]*\n/, "");
    expect(pipelineRules(p).join("\n")).toContain("pr-check does not post its report");
  });

  it("run under Buildkite's `bash -e`: a red pr:check still posts and the job stays red; a green one stays green", () => {
    const dir = mkdtempSync(join(tmpdir(), "prc-"));
    try {
      const posted = join(dir, "posted");
      // Buildkite turns $$ into $; the job script and the poster are stood in for by shell commands.
      const shell = (jobExit: number) =>
        prCheck()
          .command.replace(/\$\$/g, "$")
          .replace("bash scripts/buildkite/run.sh", `bash -c 'cat > /dev/null; exit ${jobExit}'`)
          .replace("node scripts/buildkite/pr-comment.mjs ci-out/pr-check.md", `echo ${jobExit} >> ${posted}`);
      const red = spawnSync("bash", ["-e", "-c", shell(3)], { encoding: "utf8" });
      expect(red.status).toBe(3);
      const green = spawnSync("bash", ["-e", "-c", shell(0)], { encoding: "utf8" });
      expect(green.status).toBe(0);
      expect(readFileSync(posted, "utf8").trim().split("\n")).toEqual(["3", "0"]);
      // A poster that fails never changes the job's result.
      const failingPoster = prCheck().command.replace(/\$\$/g, "$").replace("bash scripts/buildkite/run.sh", "bash -c 'cat > /dev/null; exit 0'").replace("node scripts/buildkite/pr-comment.mjs ci-out/pr-check.md", "false");
      expect(spawnSync("bash", ["-e", "-c", failingPoster]).status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("renovate.json", () => {
  const r = JSON.parse(readFileSync("renovate.json", "utf8"));
  it("groups the update families, runs on a schedule, never auto-merges, skips GitHub Actions", () => {
    expect(r.schedule).toEqual(["before 6am on monday"]);
    expect(r.automerge).toBe(false);
    expect(r.prConcurrentLimit).toBeGreaterThan(0);
    expect(r.commitMessageSuffix).toBe("[skip ci]");
    const groups = r.packageRules.map((p: { groupName?: string | null }) => p.groupName).filter(Boolean);
    expect(groups.length).toBeGreaterThanOrEqual(8);
    expect(r.packageRules.find((p: { matchManagers?: string[] }) => p.matchManagers?.includes("github-actions"))?.enabled).toBe(false);
    expect(r.vulnerabilityAlerts.schedule).toEqual(["at any time"]);
    for (const p of r.packageRules) for (const n of p.matchPackageNames ?? []) if (n.startsWith("/")) expect(() => new RegExp(n.slice(1, -1))).not.toThrow();
  });
});
