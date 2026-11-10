// @vitest-environment node
/**
 * scripts/lane-merge.sh on a throw-away repository: the clean-worktree
 * prerequisite counts untracked files (an untracked module could satisfy a
 * lane's import during the checks without being in the pushed commits),
 * while ignored files do not block. `npx` is stubbed, so no tsc or vitest runs.
 */
import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(__dirname, "../../scripts/lane-merge.sh");

function setup({ laneAddsDep = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "lumen-lane-merge-"));
  const work = join(dir, "repo");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  // npx and npm are stubs that log their arguments.
  const calls = join(dir, "calls.log");
  writeFileSync(calls, "");
  for (const tool of ["npx", "npm"]) {
    writeFileSync(join(bin, tool), `#!/bin/sh\necho "${tool} $*" >> "${calls}"\nexit 0\n`);
    chmodSync(join(bin, tool), 0o755);
  }
  writeFileSync(join(dir, "gitconfig"), "");
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GIT_CONFIG_GLOBAL: join(dir, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
    LANE_SKIP_TESTS: "1",
  };
  execFileSync("git", ["init", "-q", "-b", "main", work], { env });
  const g = (...a: string[]) => execFileSync("git", a, { cwd: work, env, encoding: "utf8" }).trim();
  mkdirSync(join(work, "scripts"));
  mkdirSync(join(work, "src"));
  // The i18n check the script runs: always up to date here.
  writeFileSync(join(work, "scripts/extract-i18n-keys.mjs"), "process.exit(0);\n");
  writeFileSync(join(work, ".gitignore"), "ignored/\n");
  writeFileSync(join(work, "src/app.ts"), "export const a = 1;\n");
  writeFileSync(join(work, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }) + "\n");
  writeFileSync(join(work, "package-lock.json"), JSON.stringify({ name: "t", lockfileVersion: 3, packages: {} }) + "\n");
  g("add", ".");
  g("commit", "-q", "-m", "base");
  g("branch", "target");
  g("checkout", "-q", "-b", "lane");
  writeFileSync(join(work, "src/feature.ts"), 'import { helper } from "./helper";\nexport const f = helper;\n');
  // A lane that needs a package adds it to package.json / the lockfile only (lanes.md rule 4).
  if (laneAddsDep) writeFileSync(join(work, "package.json"), JSON.stringify({ name: "t", version: "1.0.0", dependencies: { "left-pad": "1.3.0" } }) + "\n");
  g("add", ".");
  g("commit", "-q", "-m", "lane work");
  g("checkout", "-q", "main");
  const run = (extra: Record<string, string> = {}) => spawnSync("bash", [script, "target", "lane"], { cwd: work, env: { ...env, ...extra }, encoding: "utf8" });
  const log = () => readFileSync(calls, "utf8");
  return { dir, work, g, run, log };
}

describe("scripts/lane-merge.sh", () => {
  it("refuses to run with an untracked file, before checking out or merging anything", () => {
    const { dir, work, g, run } = setup();
    try {
      const target = g("rev-parse", "target");
      writeFileSync(join(work, "src/helper.ts"), "export const helper = 1;\n"); // would satisfy the lane's import
      const r = run();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("lane-merge: working tree has uncommitted changes or untracked files");
      expect(r.stderr).toContain("?? src/helper.ts");
      expect(g("rev-parse", "target")).toBe(target);
      expect(g("symbolic-ref", "--short", "HEAD")).toBe("main");
      expect(existsSync(join(work, ".git/MERGE_HEAD"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignored files do not block the merge", () => {
    const { dir, work, g, run } = setup();
    try {
      mkdirSync(join(work, "ignored"));
      writeFileSync(join(work, "ignored/cache.bin"), "x");
      const r = run();
      expect(r.stdout).toContain("result:  ready");
      expect(r.status).toBe(0);
      expect(g("log", "--format=%s", "-1", "target")).toBe("Merge branch 'lane' into target");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a merge that changes dependencies settles the lockfile, then stops before the checks until they are installed", () => {
    const { dir, g, run, log } = setup({ laneAddsDep: true });
    try {
      const r = run();
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("lane-merge: STOP before the checks — the merged lanes change dependencies");
      expect(r.stdout).toMatch(/lane\s+\w+\s+clean/); // the merge itself is committed
      expect(g("log", "--format=%s", "-1", "target")).toBe("Merge branch 'lane' into target");
      expect(log()).toContain("npm install --package-lock-only --no-audit --no-fund");
      expect(log()).not.toContain("npx tsc");
      // After `npm install`, the same command skips the merged branch and runs the checks.
      const again = run();
      expect(again.status).toBe(0);
      expect(again.stdout).toMatch(/lane\s+-\s+already merged/);
      expect(again.stdout).toContain("result:  ready");
      expect(log()).toContain("npx tsc --noEmit -p .");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("LANE_INSTALL=1 installs the merged dependencies before the checks", () => {
    const { dir, run, log } = setup({ laneAddsDep: true });
    try {
      const r = run({ LANE_INSTALL: "1" });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("result:  ready");
      const calls = log();
      expect(calls.indexOf("npm install --no-audit --no-fund")).toBeGreaterThan(-1);
      expect(calls.indexOf("npm install --no-audit --no-fund")).toBeLessThan(calls.indexOf("npx tsc"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a lane that does not touch dependencies runs no npm at all", () => {
    const { dir, run, log } = setup();
    try {
      expect(run().status).toBe(0);
      expect(log()).not.toContain("npm ");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
