/**
 * W10.E56 (W8.9) and W10.E57 (W8.10): the hooks need no one to install them,
 * and the lane's STATE.md is ticked every hour without anyone starting it.
 *
 * - `npm install` / `npm ci` run `prepare` → scripts/install-git-hooks.mjs,
 *   which writes the pre-push hook (lockfile drift, then ci:local) and the
 *   reference-transaction hook (lane state) into the clone — never over a
 *   hook that is someone else's, never in CI.
 * - The reference-transaction hook starts `lane-state.mjs watch` in the
 *   background when a lane state is set and no watcher runs for it; the
 *   watcher rewrites STATE.md every interval. Here the interval is shortened
 *   to a fraction of a second ($LUMEN_LANE_TICK_MIN) and the ticks counted
 *   in a scratch git repository.
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations
import { installPlan, skipReason } from "../../scripts/install-git-hooks.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { hookPlan, HOOK_MARK } from "../../scripts/lib/ciLocal.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { txnHookPlan, TXN_HOOK_MARK, watchPlan } from "../../scripts/lib/lane-state.mjs";

const ROOT = resolve(__dirname, "../..");
const scratch: string[] = [];
const pids: number[] = [];
afterAll(() => {
  for (const pid of pids) {
    try {
      process.kill(pid);
    } catch {
      // why: the watcher may have stopped on its own when its STATE.md went away
    }
  }
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

/** A process that runs (a zombie, exited but not yet reaped by whoever adopted it, does not). */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return true; // no /proc (macOS): kill(0) is the answer
  }
}

const git = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" });

/** A scratch clone with the three scripts the hooks run, at the repo's paths. */
function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "lumen-hooks-"));
  scratch.push(dir);
  git(dir, "init", "-q");
  mkdirSync(join(dir, "scripts/lib"), { recursive: true });
  for (const f of ["scripts/install-git-hooks.mjs", "scripts/lane-state.mjs", "scripts/lib/ciLocal.mjs", "scripts/lib/lane-state.mjs"]) cpSync(join(ROOT, f), join(dir, f));
  return dir;
}

const env = (extra: Record<string, string> = {}) => {
  const e: Record<string, string | undefined> = { ...process.env, ...extra };
  for (const k of ["CI", "LUMEN_NO_HOOKS", "LUMEN_LANE_STATE", "LUMEN_LANE_STATE_DIR", "npm_config_global", "GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE"]) if (!(k in extra)) delete e[k];
  return e as NodeJS.ProcessEnv;
};

describe("the hooks install themselves (W10.E56)", () => {
  it("package.json runs the installer on every npm install / npm ci, and never fails the install on it", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.prepare).toBe("node scripts/install-git-hooks.mjs || exit 0");
  });

  it("plan: a fresh clone gets both hooks; ours are refreshed; someone else's are kept", () => {
    const fresh = installPlan({});
    expect(fresh.map((s: { name: string; action: string }) => [s.name, s.action])).toEqual([
      ["pre-push", "write"],
      ["reference-transaction", "write"],
    ]);
    expect(fresh[0].content).toContain(HOOK_MARK);
    expect(fresh[0].content).toContain("node scripts/lockfile-drift.mjs");
    expect(fresh[1].content).toContain(TXN_HOOK_MARK);
    const current = installPlan({ "pre-push": hookPlan(null).content, "reference-transaction": txnHookPlan(null).content });
    expect(current.map((s: { action: string }) => s.action)).toEqual(["same", "same"]);
    const older = installPlan({ "pre-push": `#!/bin/sh\n# ${HOOK_MARK}\nold body\n`, "reference-transaction": null });
    expect(older.map((s: { action: string }) => s.action)).toEqual(["write", "write"]);
    const theirs = installPlan({ "pre-push": "#!/bin/sh\nnpx lint-staged\n", "reference-transaction": "#!/bin/sh\necho mine\n" });
    expect(theirs.map((s: { action: string }) => s.action)).toEqual(["keep", "keep"]);
  });

  it("nothing is written in CI, without a checkout, on a global install or when asked not to", () => {
    expect(skipReason({}, "/x/.git/hooks")).toBeNull();
    expect(skipReason({ CI: "false" }, "/x/.git/hooks")).toBeNull();
    expect(skipReason({ CI: "true" }, "/x/.git/hooks")).toBe("CI");
    expect(skipReason({ CI: "1" }, "/x/.git/hooks")).toBe("CI");
    expect(skipReason({}, null)).toBe("not a git checkout");
    expect(skipReason({ LUMEN_NO_HOOKS: "1" }, "/x/.git/hooks")).toBe("LUMEN_NO_HOOKS=1");
    expect(skipReason({ npm_config_global: "true" }, "/x/.git/hooks")).toBe("a global install");
  });

  it("in a real clone: writes both hooks executable, is idempotent, and keeps a foreign hook", () => {
    const dir = scratchRepo();
    const run = (e = env()) => spawnSync(process.execPath, ["scripts/install-git-hooks.mjs"], { cwd: dir, encoding: "utf8", env: e });
    const first = run();
    expect(first.status).toBe(0);
    const hooks = join(dir, ".git/hooks");
    for (const h of ["pre-push", "reference-transaction"]) {
      expect(readFileSync(join(hooks, h), "utf8")).toContain("installed by");
      expect(statSync(join(hooks, h)).mode & 0o111).not.toBe(0);
    }
    expect(run().stdout).toMatch(/pre-push up to date[\s\S]*reference-transaction up to date/);
    writeFileSync(join(hooks, "pre-push"), "#!/bin/sh\necho mine\n");
    const third = run();
    expect(third.status).toBe(0);
    expect(third.stdout).toContain("is not ours; kept");
    expect(readFileSync(join(hooks, "pre-push"), "utf8")).toBe("#!/bin/sh\necho mine\n");
    // In CI nothing is touched.
    rmSync(join(hooks, "reference-transaction"));
    expect(run(env({ CI: "true" })).stdout).toContain("not installed (CI)");
    expect(existsSync(join(hooks, "reference-transaction"))).toBe(false);
  });
});

describe("the lane's STATE.md is ticked every hour without anyone starting it (W10.E57)", () => {
  const STATE = "# Lane T state\n\nUpdated: never\n\n## Branches\n\n| branch | worktree | base | pushed | pr |\n| --- | --- | --- | --- | --- |\n| fix/x | /nowhere | main | — | — |\n";

  it("watchPlan: nothing without a lane state; the lane that lists the branch; one watcher per STATE.md", () => {
    const read = (f: string) => (f === "/l/a/STATE.md" ? "# none\n" : STATE);
    const files = ["/l/a/STATE.md", "/l/t/STATE.md"];
    expect(watchPlan(null, [], "fix/x", read, null, () => false).action).toBe("none");
    expect(watchPlan({ dir: "/l" }, files, "fix/x", read, null, () => false)).toEqual({ action: "start", file: "/l/t/STATE.md" });
    expect(watchPlan({ dir: "/l" }, files, "other", read, null, () => false).action).toBe("none");
    expect(watchPlan({ file: "/s.md" }, [], null, read, { pid: 7, file: "/s.md" }, () => true).action).toBe("none");
    expect(watchPlan({ file: "/s.md" }, [], null, read, { pid: 7, file: "/s.md" }, () => false)).toEqual({ action: "start", file: "/s.md" });
    expect(watchPlan({ file: "/s.md" }, [], null, read, { pid: 7, file: "/old.md" }, () => true)).toEqual({ action: "start", file: "/s.md" });
  });

  it("any git ref change starts the watcher once, and it rewrites STATE.md every interval", async () => {
    const dir = scratchRepo();
    expect(spawnSync(process.execPath, ["scripts/install-git-hooks.mjs"], { cwd: dir, env: env() }).status).toBe(0);
    const state = join(dir, "STATE.md");
    writeFileSync(state, STATE);
    git(dir, "config", "lumen.laneState", state);
    // 0.005 min = 0.3 s: the hourly timer, sped up.
    const e = env({ LUMEN_LANE_TICK_MIN: "0.005" });
    const commit = (m: string) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", m], { cwd: dir, env: e });
    expect(commit("one").status).toBe(0); // a commit moves a ref: the hook runs
    const watch = join(dir, ".git/lumen-lane-watch.json");
    const deadline = Date.now() + 10_000;
    while (!existsSync(watch) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    const first = JSON.parse(readFileSync(watch, "utf8")) as { pid: number; file: string };
    pids.push(first.pid);
    expect(first.file).toBe(state);

    // Ticks: each one writes the file anew (a new inode), and the Updated line is the tick's time.
    const inodes = new Set<number>();
    const until = Date.now() + 4000;
    while (inodes.size < 4 && Date.now() < until) {
      inodes.add(statSync(state).ino);
      await new Promise((r) => setTimeout(r, 40));
    }
    expect(inodes.size).toBeGreaterThanOrEqual(4);
    expect(readFileSync(state, "utf8")).toMatch(/^Updated: \d{4}-\d\d-\d\dT\d\d:\d\dZ$/m);

    // A second ref change does not start a second watcher.
    expect(commit("two").status).toBe(0);
    await new Promise((r) => setTimeout(r, 300));
    expect((JSON.parse(readFileSync(watch, "utf8")) as { pid: number }).pid).toBe(first.pid);

    // The lane is over (its STATE.md is gone): the watcher stops by itself.
    // (Removed again on every poll: a tick already in flight may write it back once.)
    const gone = Date.now() + 8000;
    let alive = true;
    while (alive && Date.now() < gone) {
      rmSync(state, { force: true });
      await new Promise((r) => setTimeout(r, 100));
      alive = running(first.pid);
    }
    expect(alive).toBe(false);
  }, 30_000);

  it("without a lane state the hook starts nothing", () => {
    const dir = scratchRepo();
    spawnSync(process.execPath, ["scripts/install-git-hooks.mjs"], { cwd: dir, env: env() });
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x"], { cwd: dir, env: env() });
    expect(existsSync(join(dir, ".git/lumen-lane-watch.json"))).toBe(false);
  });
});
