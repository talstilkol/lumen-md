// @vitest-environment node
/**
 * Review 11, M2: one lane watcher per STATE.md for the whole clone, and none
 * that outlives its repository.
 *
 * - The watch record lives in `git rev-parse --git-common-dir` (shared by
 *   linked worktrees), keyed by the STATE.md path; before, it was under
 *   `--git-path`, so every linked worktree started its own hourly watcher.
 * - It is written under a lock: hooks that fire at once start one watcher.
 * - A watcher with an hourly interval stops within seconds once its STATE.md
 *   or its repository is gone (a test's scratch clone, a removed lane).
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { killWatchersUnder, watchersUnder } from "./helpers/laneWatchers";

const ROOT = resolve(__dirname, "../..");
const scratch: string[] = [];
afterAll(() => {
  killWatchersUnder(scratch);
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

const STATE = "# Lane T state\n\nUpdated: never\n\n## Branches\n\n| branch | worktree | base | pushed | pr |\n| --- | --- | --- | --- | --- |\n| fix/x | /nowhere | main | — | — |\n";

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const e: Record<string, string | undefined> = { ...process.env, LUMEN_LANE_TICK_MIN: "60", ...extra };
  for (const k of ["CI", "LUMEN_NO_HOOKS", "LUMEN_CI_LOCAL_HOOK", "LUMEN_LANE_STATE", "LUMEN_LANE_STATE_DIR", "LUMEN_LANE_WATCH", "GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE"]) if (!(k in extra)) delete e[k];
  return e as NodeJS.ProcessEnv;
}
const git = (cwd: string, ...a: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, encoding: "utf8", env: env() });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await sleep(50);
  return ok();
}

/** A scratch clone with the hook scripts committed (a linked worktree checks them out too) and a lane state set. */
function lab(): { dir: string; state: string } {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "lumen-watch-")));
  scratch.push(top);
  const dir = join(top, "main");
  mkdirSync(join(dir, "scripts/lib"), { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  for (const f of ["scripts/install-git-hooks.mjs", "scripts/lane-state.mjs", "scripts/lib/ciLocal.mjs", "scripts/lib/lane-state.mjs"]) cpSync(join(ROOT, f), join(dir, f));
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "scripts");
  expect(spawnSync(process.execPath, ["scripts/install-git-hooks.mjs"], { cwd: dir, env: env() }).status).toBe(0);
  const state = join(top, "STATE.md");
  writeFileSync(state, STATE);
  git(dir, "config", "lumen.laneState", state);
  return { dir, state };
}

describe("one lane watcher per STATE.md for the clone (review 11, M2)", () => {
  it("two linked worktrees of one clone start one watcher, recorded in the common git dir", async () => {
    const { dir, state } = lab();
    expect(git(dir, "commit", "-q", "--allow-empty", "-m", "one").status).toBe(0);
    expect(await until(() => watchersUnder(state).length === 1, 10_000)).toBe(true);
    const w2 = join(dir, "..", "w2");
    expect(git(dir, "worktree", "add", "-q", "-b", "two", w2).status).toBe(0);
    expect(git(w2, "commit", "-q", "--allow-empty", "-m", "two").status).toBe(0);
    await sleep(1500);
    expect(watchersUnder(state)).toHaveLength(1);
    const record = JSON.parse(readFileSync(join(dir, ".git/lumen-lane-watch.json"), "utf8")) as Record<string, { pid: number }>;
    expect(Object.keys(record)).toEqual([state]);
    expect(watchersUnder(state)).toEqual([record[state].pid]);
    expect(existsSync(join(dir, ".git/worktrees/w2/lumen-lane-watch.json"))).toBe(false);
  }, 30_000);

  it("hooks that fire at once start one watcher (the record is written under a lock)", async () => {
    const { dir, state } = lab();
    const runs = Array.from({ length: 6 }, () => new Promise<number>((r) => spawn(process.execPath, ["scripts/lane-state.mjs", "ensure-watch"], { cwd: dir, env: env(), stdio: "ignore" }).on("exit", (c) => r(c ?? 1))));
    expect(await Promise.all(runs)).toEqual([0, 0, 0, 0, 0, 0]);
    await sleep(1000);
    expect(watchersUnder(state)).toHaveLength(1);
    expect(existsSync(join(dir, ".git/lumen-lane-watch.lock"))).toBe(false);
  }, 30_000);
});

describe("a watcher does not outlive its repository or its STATE.md (review 11, M2)", () => {
  const start = (dir: string, state: string) => {
    const c = spawn(process.execPath, ["scripts/lane-state.mjs", "watch", state, "--every-min", "60", "--no-remote", "--repo", join(dir, ".git")], { cwd: dir, env: env(), detached: true, stdio: "ignore" });
    c.unref();
    return c.pid as number;
  };

  it("an hourly watcher stops within seconds once the clone is removed", async () => {
    const { dir, state } = lab();
    const pid = start(dir, state);
    expect(await until(() => watchersUnder(state).includes(pid), 5000)).toBe(true);
    await sleep(2500);
    expect(watchersUnder(state)).toContain(pid); // it runs while its clone is there
    rmSync(dir, { recursive: true, force: true });
    expect(await until(() => !watchersUnder(state).includes(pid), 8000)).toBe(true);
  }, 30_000);

  it("an hourly watcher stops within seconds once its STATE.md is removed", async () => {
    const { dir, state } = lab();
    const pid = start(dir, state);
    expect(await until(() => watchersUnder(state).includes(pid), 5000)).toBe(true);
    await sleep(2500);
    expect(watchersUnder(state)).toContain(pid);
    rmSync(state, { force: true });
    expect(await until(() => !watchersUnder(state).includes(pid), 8000)).toBe(true);
  }, 30_000);
});
