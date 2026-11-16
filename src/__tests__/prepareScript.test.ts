/**
 * One `prepare` script (INT5): #1035 (git hooks) and #1054 (merge drivers)
 * each added a "prepare" key to package.json; JSON keeps only the last, so
 * one of the two silently never ran. scripts/prepare.mjs runs both, never
 * fails the install, does nothing in CI, and leaves no process running: the
 * lane-state watcher stays opt-in (it is started later by the
 * reference-transaction hook, and only with a lane state set). The ci:local
 * pre-push hook is opt-in too (review 11, M2; #1054's design).
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { killWatchersUnder, watchersUnder } from "./helpers/laneWatchers";
// @ts-expect-error — plain .mjs module without type declarations
import { inCI, STEPS } from "../../scripts/prepare.mjs";

const ROOT = resolve(__dirname, "../..");
const scratch: string[] = [];
afterAll(() => {
  killWatchersUnder(scratch);
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

const FILES = [
  "scripts/prepare.mjs",
  "scripts/install-git-hooks.mjs",
  "scripts/git-setup.mjs",
  "scripts/help-merge-driver.mjs",
  "scripts/lane-state.mjs",
  "scripts/lib/ciLocal.mjs",
  "scripts/lib/lane-state.mjs",
];

const git = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" });

function clone(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lumen-prepare-")));
  scratch.push(dir);
  git(dir, "init", "-q");
  mkdirSync(join(dir, "scripts/lib"), { recursive: true });
  for (const f of FILES) cpSync(join(ROOT, f), join(dir, f));
  return dir;
}

const env = (extra: Record<string, string> = {}) => {
  const e: Record<string, string | undefined> = { ...process.env, ...extra };
  for (const k of ["CI", "LUMEN_NO_HOOKS", "LUMEN_CI_LOCAL_HOOK", "LUMEN_NO_GIT_SETUP", "LUMEN_LANE_STATE", "LUMEN_LANE_STATE_DIR", "npm_config_global", "GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE"])
    if (!(k in extra)) delete e[k];
  return e as NodeJS.ProcessEnv;
};

const prepare = (dir: string, extra: Record<string, string> = {}) =>
  spawnSync(process.execPath, ["scripts/prepare.mjs"], { cwd: dir, env: env(extra), encoding: "utf8", timeout: 60_000 });
const hook = (dir: string, name: string) => join(dir, git(dir, "rev-parse", "--git-path", "hooks").stdout.trim(), name);
const cfg = (dir: string, key: string) => git(dir, "config", "--local", "--get", key).stdout.trim();

describe("package.json prepare: one script for hooks and merge drivers", () => {
  it("has exactly one prepare key, and it runs scripts/prepare.mjs without failing the install", () => {
    const raw = readFileSync(join(ROOT, "package.json"), "utf8");
    expect(raw.match(/"prepare"\s*:/g)).toHaveLength(1);
    expect(JSON.parse(raw).scripts.prepare).toBe("node scripts/prepare.mjs || exit 0");
    expect(STEPS).toEqual(["scripts/install-git-hooks.mjs", "scripts/git-setup.mjs"]);
  });

  it("CI detection matches the hook installer's (CI=false / CI=0 are not CI)", () => {
    expect(inCI({ CI: "true" })).toBe(true);
    expect(inCI({ CI: "1" })).toBe(true);
    expect(inCI({ CI: "false" })).toBe(false);
    expect(inCI({ CI: "0" })).toBe(false);
    expect(inCI({})).toBe(false);
  });

  it("a fresh clone gets the lane hook and both drivers from one run, and no pre-push hook", () => {
    const dir = clone();
    const r = prepare(dir);
    expect(r.status).toBe(0);
    expect(existsSync(hook(dir, "pre-push"))).toBe(false);
    expect(r.stdout).toContain("pre-push not installed (opt-in");
    expect(existsSync(hook(dir, "reference-transaction"))).toBe(true);
    expect(cfg(dir, "merge.lumen-help.driver")).toBe("node scripts/help-merge-driver.mjs %O %A %B %P");
  });

  it("the ci:local pre-push hook only in a clone that opted in", () => {
    const dir = clone();
    git(dir, "config", "lumen.ciLocalHook", "true");
    expect(prepare(dir).status).toBe(0);
    expect(readFileSync(hook(dir, "pre-push"), "utf8")).toContain("ci:local");
    const other = clone();
    expect(prepare(other, { LUMEN_CI_LOCAL_HOOK: "1" }).status).toBe(0);
    expect(existsSync(hook(other, "pre-push"))).toBe(true);
  });

  it("in CI it writes nothing and exits 0", () => {
    const dir = clone();
    const r = prepare(dir, { CI: "true" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("prepare: skipped (CI)");
    expect(existsSync(hook(dir, "pre-push"))).toBe(false);
    expect(existsSync(hook(dir, "reference-transaction"))).toBe(false);
    expect(cfg(dir, "merge.lumen-help.driver")).toBe("");
  });

  it("starts no watcher at install time, even in a clone with a lane state set", () => {
    const dir = clone();
    const state = join(dir, "STATE.md");
    writeFileSync(state, "# lane\n");
    git(dir, "config", "lumen.laneState", state);
    expect(prepare(dir).status).toBe(0);
    expect(existsSync(join(dir, git(dir, "rev-parse", "--git-common-dir").stdout.trim(), "lumen-lane-watch.json"))).toBe(false);
    expect(watchersUnder(dir)).toEqual([]);
  });

  it("a failing step does not fail the install, and the other step still runs", () => {
    const dir = clone();
    writeFileSync(join(dir, "scripts/install-git-hooks.mjs"), "process.exit(3);\n");
    const r = prepare(dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("scripts/install-git-hooks.mjs did not finish");
    expect(cfg(dir, "merge.lumen-help.driver")).toBe("node scripts/help-merge-driver.mjs %O %A %B %P");
  });
});
