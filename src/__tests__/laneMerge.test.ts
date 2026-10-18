// @vitest-environment node
/**
 * scripts/lane-merge.sh on a throw-away repository: the clean-worktree
 * prerequisite counts untracked files (an untracked module could satisfy a
 * lane's import during the checks without being in the pushed commits),
 * while ignored files do not block. `npx` is stubbed, so no tsc or vitest runs.
 */
import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(__dirname, "../../scripts/lane-merge.sh");

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "lumen-lane-merge-"));
  const work = join(dir, "repo");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "npx"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "npx"), 0o755);
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
  g("add", ".");
  g("commit", "-q", "-m", "base");
  g("branch", "target");
  g("checkout", "-q", "-b", "lane");
  writeFileSync(join(work, "src/feature.ts"), 'import { helper } from "./helper";\nexport const f = helper;\n');
  g("add", ".");
  g("commit", "-q", "-m", "lane work");
  g("checkout", "-q", "main");
  const run = () => spawnSync("bash", [script, "target", "lane"], { cwd: work, env, encoding: "utf8" });
  return { dir, work, g, run };
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
});
