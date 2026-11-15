/**
 * W8.9 + W8.10 — the hooks, run by real git in a throwaway clone with a
 * real (bare) origin:
 *   - pre-push (`npm run ci:local -- --install-hook`) fails on lockfile drift
 *     before anything is sent (W10.E56);
 *   - a push that origin accepted is written into the lane's STATE.md by the
 *     reference-transaction hook, with no step by anyone; a fetch that moves
 *     the same ref is not logged as a push; `tick` is the hourly half (W10.E57).
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs helper without types
import { hookPlan } from "../../scripts/lib/ciLocal.mjs";
// @ts-expect-error — plain .mjs helper without types
import { txnHookPlan } from "../../scripts/lib/lane-state.mjs";

const ROOT = resolve(__dirname, "..", "..");
const SCRIPTS = ["lane-state.mjs", "lib/lane-state.mjs", "lockfile-drift.mjs", "lib/lockfile-drift.mjs"];
const LOCK = { name: "t", version: "1.0.0", lockfileVersion: 3, packages: { "": { name: "t", version: "1.0.0", dependencies: { a: "^1.0.0" } }, "node_modules/a": { version: "1.0.0" } } };

function setup() {
  const root = mkdtempSync(join(tmpdir(), "lumen-hooks-"));
  const origin = join(root, "origin.git");
  const dir = join(root, "work");
  const env = { ...process.env, LUMEN_LANE_STATE: "", LUMEN_LANE_STATE_DIR: "", GIT_CONFIG_NOSYSTEM: "1", HOME: root };
  const run = (cwd: string, args: string[], extra: Record<string, string> = {}) => spawnSync("git", args, { cwd, encoding: "utf8", env: { ...env, ...extra } });
  const git = (...a: string[]) => {
    const r = run(dir, a);
    if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { env });
  execFileSync("git", ["clone", "-q", origin, dir], { env, stdio: "ignore" });
  git("config", "user.email", "t@example.org");
  git("config", "user.name", "T");
  for (const f of SCRIPTS) {
    mkdirSync(join(dir, "scripts", "lib"), { recursive: true });
    copyFileSync(join(ROOT, "scripts", f), join(dir, "scripts", f));
  }
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "t", version: "1.0.0", scripts: { "ci:local": "true" }, dependencies: { a: "^1.0.0" } }));
  writeFileSync(join(dir, "package-lock.json"), JSON.stringify(LOCK));
  git("add", "-A");
  git("commit", "-q", "-m", "init [skip ci]");
  const hooks = join(dir, ".git", "hooks");
  writeFileSync(join(hooks, "pre-push"), hookPlan(null).content);
  chmodSync(join(hooks, "pre-push"), 0o755);
  writeFileSync(join(hooks, "reference-transaction"), txnHookPlan(null).content);
  chmodSync(join(hooks, "reference-transaction"), 0o755);
  const push = (branch: string, extra: Record<string, string> = {}) => run(dir, ["push", "-q", "-u", "origin", branch], extra);
  const remoteHead = (branch: string) => (run(dir, ["ls-remote", "origin", `refs/heads/${branch}`]).stdout.split(/\s+/)[0] || null);
  return { root, dir, git, push, remoteHead, run, done: () => rmSync(root, { recursive: true, force: true }) };
}

const STATE = (branch: string) => `# Lane T state

Updated: 2026-11-15T08:00Z · session s

## Branches

| branch | worktree | base | pushed | pr |
| --- | --- | --- | --- | --- |
| ${branch} | /x | verify/train-5 | — | — |

## Tasks

| plan id | branch | status | what ran | owed |
| --- | --- | --- | --- | --- |

## Pushes

## Next

push it
`;

describe("pre-push: lockfile drift (W8.9, W10.E56)", () => {
  it("the installed pre-push hook runs the drift check first", () => {
    const body = hookPlan(null).content as string;
    expect(body.indexOf("scripts/lockfile-drift.mjs")).toBeGreaterThan(0);
    expect(body.indexOf("scripts/lockfile-drift.mjs")).toBeLessThan(body.indexOf("ci:local -- --changed"));
  });

  it("a drifted package.json fails the push and origin gets nothing; without drift it goes through", () => {
    const r = setup();
    try {
      r.git("switch", "-q", "-c", "feat/drift");
      writeFileSync(join(r.dir, "package.json"), JSON.stringify({ name: "t", version: "1.0.0", scripts: { "ci:local": "true" }, dependencies: { a: "^2.0.0" } }));
      r.git("commit", "-qam", "bump a without the lock [skip ci]");
      const bad = r.push("feat/drift");
      expect(bad.status).not.toBe(0);
      expect(bad.stderr + bad.stdout).toMatch(/a/);
      expect(r.remoteHead("feat/drift")).toBeNull();
      // Fix the lock: the same push goes through.
      writeFileSync(join(r.dir, "package-lock.json"), JSON.stringify({ ...LOCK, packages: { ...LOCK.packages, "": { ...LOCK.packages[""], dependencies: { a: "^2.0.0" } } } }));
      r.git("commit", "-qam", "lock [skip ci]");
      const ok = r.push("feat/drift");
      expect(ok.status, ok.stderr).toBe(0);
      expect(r.remoteHead("feat/drift")).toBe(r.git("rev-parse", "HEAD"));
    } finally {
      r.done();
    }
  });
});

describe("STATE.md written after a push and every hour (W8.10, W10.E57)", () => {
  it("a push origin accepted is recorded in the lane's STATE.md, found by --state-dir; a rejected push is not", () => {
    const r = setup();
    try {
      const lanes = join(r.root, "lanes");
      mkdirSync(join(lanes, "T"), { recursive: true });
      mkdirSync(join(lanes, "U"), { recursive: true });
      writeFileSync(join(lanes, "T", "STATE.md"), STATE("w10/t-work"));
      writeFileSync(join(lanes, "U", "STATE.md"), STATE("w10/u-other"));
      r.git("config", "lumen.laneStateDir", lanes);
      r.git("switch", "-q", "-c", "w10/t-work");
      writeFileSync(join(r.dir, "x.txt"), "1\n");
      r.git("add", "-A");
      r.git("commit", "-q", "-m", "x [skip ci]");
      const sha = r.git("rev-parse", "HEAD");
      const p = r.push("w10/t-work");
      expect(p.status, p.stderr).toBe(0);
      const md = readFileSync(join(lanes, "T", "STATE.md"), "utf8");
      expect(md).toContain(`| w10/t-work | /x | verify/train-5 | ${sha.slice(0, 10)} | — |`);
      expect(md).toMatch(new RegExp(`## Pushes\\n\\n\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\dZ w10/t-work ${sha.slice(0, 10)} \\(recorded by the reference-transaction hook\\)\\n`));
      expect(md).toMatch(/^Updated: \d{4}-\d\d-\d\dT\d\d:\d\dZ · session s$/m);
      expect(md).not.toContain("2026-11-15T08:00Z");
      // The other lane's file is untouched, and nothing is left pending.
      expect(readFileSync(join(lanes, "U", "STATE.md"), "utf8")).toBe(STATE("w10/u-other"));
      expect(existsSync(join(r.dir, ".git", "lumen-lane-pending.json"))).toBe(false);

      // A rejected push (origin moved on: non-fast-forward) leaves STATE.md alone.
      const other = join(r.root, "other");
      execFileSync("git", ["clone", "-q", "-b", "w10/t-work", join(r.root, "origin.git"), other], { stdio: "ignore", env: { ...process.env, HOME: r.root } });
      execFileSync("git", ["-c", "user.email=o@example.org", "-c", "user.name=O", "commit", "-q", "--allow-empty", "-m", "theirs [skip ci]"], { cwd: other });
      execFileSync("git", ["push", "-q", "--no-verify", "origin", "w10/t-work"], { cwd: other });
      r.git("commit", "-q", "--allow-empty", "-m", "mine [skip ci]");
      const rejected = r.push("w10/t-work");
      expect(rejected.status).not.toBe(0);
      expect(readFileSync(join(lanes, "T", "STATE.md"), "utf8")).toBe(md);
      // A fetch moves origin/w10/t-work to their head: not our push, so no Pushes line.
      r.git("fetch", "-q", "origin");
      const after = readFileSync(join(lanes, "T", "STATE.md"), "utf8");
      expect(after.match(/reference-transaction hook/g)).toHaveLength(1);
    } finally {
      r.done();
    }
  });

  it("with no lane state configured the hooks do nothing and the push still works", () => {
    const r = setup();
    try {
      r.git("switch", "-q", "-c", "w10/plain");
      const p = r.push("w10/plain");
      expect(p.status, p.stderr).toBe(0);
      expect(existsSync(join(r.dir, ".git", "lumen-lane-pending.json"))).toBe(false);
    } finally {
      r.done();
    }
  });

  it("tick (the hourly half): new Updated time, and a head another session pushed is recorded", () => {
    const r = setup();
    try {
      const state = join(r.root, "STATE.md");
      writeFileSync(state, STATE("w10/t-work"));
      r.git("switch", "-q", "-c", "w10/t-work");
      expect(r.push("w10/t-work", { LUMEN_LANE_STATE: "" }).status).toBe(0);
      const head = r.git("rev-parse", "HEAD");
      const t = spawnSync(process.execPath, [join(r.dir, "scripts", "lane-state.mjs"), "tick", state], { cwd: r.dir, encoding: "utf8" });
      expect(t.status, t.stderr).toBe(0);
      const md = readFileSync(state, "utf8");
      expect(md).toContain(`| w10/t-work | /x | verify/train-5 | ${head.slice(0, 10)} | — |`);
      expect(md).toContain(`w10/t-work ${head.slice(0, 10)} (origin's head, seen by the hourly tick)`);
      expect(md).not.toContain("Updated: 2026-11-15T08:00Z");
      // A second tick with nothing new adds no Pushes line.
      spawnSync(process.execPath, [join(r.dir, "scripts", "lane-state.mjs"), "tick", state], { cwd: r.dir });
      expect(readFileSync(state, "utf8").match(/hourly tick/g)).toHaveLength(1);
    } finally {
      r.done();
    }
  });
});
