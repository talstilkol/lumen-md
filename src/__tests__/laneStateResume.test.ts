// @vitest-environment node
/**
 * Plan W8.10 — a lane that stops anywhere resumes without redoing work and
 * without pushing twice. End to end, on a throw-away origin with the real
 * scripts and the real hooks, both written by one `lane-state.mjs install-hook`
 * (the reference-transaction hook, and the pre-push half that notes the push).
 *
 * The lane has three branches when it stops:
 *   done   pushed (the hooks wrote it into STATE.md) and with a PR → nothing
 *   cut    pushed, but the session died before STATE.md was written (the
 *          push ran without the hooks) → record, and push nothing
 *   ahead  pushed once, then one more commit that never reached origin → push once
 * The next session runs `resume`, follows exactly what it says, and runs
 * `resume` again: every branch is settled, origin's own log shows each sha
 * arrived once, and a third `resume` would push nothing.
 */
import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations (#1304)
import { HOOK_BODY } from "../../scripts/lib/ciLocal.mjs";
import { killWatchersUnder } from "./helpers/laneWatchers";
// @ts-expect-error — plain .mjs module without type declarations (#1304)
import { PREPUSH_MARK, parseBranches, prePushPlan, renderBranches } from "../../scripts/lib/lane-state.mjs";

const ROOT = resolve(__dirname, "../..");
/** A row of STATE.md's Branches table, as parseBranches (lane-state.mjs) reads it. */
type Branch = { branch: string; pushed: string | null };

function lab() {
  const dir = mkdtempSync(join(tmpdir(), "lumen-lane-resume-"));
  writeFileSync(join(dir, "gitconfig"), "");
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: join(dir, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
    LUMEN_LANE_STATE: "",
    LUMEN_LANE_STATE_DIR: "",
    // No background tick here: this test is the manual resume path, and a watcher's first tick (it runs
    // `tick` at start, with ls-remote) would race the "cut" branch into STATE.md before resume looks.
    // The watcher has its own test (gitHooksAuto.test.ts).
    LUMEN_LANE_WATCH: "0",
  };
  delete (env as Record<string, string | undefined>).LUMEN_LANE_STATE;
  delete (env as Record<string, string | undefined>).LUMEN_LANE_STATE_DIR;
  const origin = join(dir, "origin.git");
  const main = join(dir, "main");
  const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "rerere.enabled=false", ...a], { cwd, env, encoding: "utf8" }).trim();
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { env });
  // origin's own record of every ref update it accepted: "<branch> <sha>" per line.
  const log = join(dir, "received.log");
  writeFileSync(join(origin, "hooks/post-receive"), `#!/bin/sh\nwhile read old new ref; do echo "\${ref#refs/heads/} $new" >> "${log}"; done\n`);
  chmodSync(join(origin, "hooks/post-receive"), 0o755);
  execFileSync("git", ["clone", "-q", origin, main], { env });
  for (const f of ["scripts/lane-state.mjs", "scripts/lib/lane-state.mjs"]) {
    mkdirSync(dirname(join(main, f)), { recursive: true });
    copyFileSync(join(ROOT, f), join(main, f));
  }
  writeFileSync(join(main, "README"), "base\n");
  git(main, "add", "-A");
  git(main, "commit", "-q", "-m", "base");
  git(main, "push", "-q", "origin", "main");
  const wt = (b: string) => join(dir, `w-${b}`);
  for (const b of ["done", "cut", "ahead"]) git(main, "worktree", "add", "-q", "-b", b, wt(b), "main");
  const lanes = join(dir, "lanes");
  mkdirSync(join(lanes, "L"), { recursive: true });
  const state = join(lanes, "L", "STATE.md");
  writeFileSync(
    state,
    `# Lane L state\n\nUpdated: 2026-11-16T00:00Z\n\n## Branches\n\n${renderBranches([
      { branch: "done", worktree: wt("done"), base: "main", pushed: null, pr: 41 },
      { branch: "cut", worktree: wt("cut"), base: "main", pushed: null, pr: 42 },
      { branch: "ahead", worktree: wt("ahead"), base: "main", pushed: null, pr: 43 },
    ])}\n\n## Pushes\n\n## Next\n\nresume\n`,
  );
  // The hooks, as a clone installs them.
  const inst = spawnSync(process.execPath, ["scripts/lane-state.mjs", "install-hook", "--state-dir", lanes], { cwd: main, env, encoding: "utf8" });
  expect(inst.status, inst.stderr).toBe(0);
  // One command sets the clone up: both halves (W8.10). Its pre-push half says the same as ci:local's.
  const prePush = resolve(main, git(main, "rev-parse", "--git-path", "hooks"), "pre-push");
  expect(readFileSync(prePush, "utf8")).toContain(PREPUSH_MARK);
  expect(HOOK_BODY.join("\n")).toContain("lane-state.mjs pending");
  const commit = (b: string, text: string) => {
    writeFileSync(join(wt(b), `${b}.txt`), text);
    git(wt(b), "add", "-A");
    git(wt(b), "commit", "-q", "-m", `${b}: ${text}`);
    return git(wt(b), "rev-parse", "HEAD");
  };
  const push = (b: string, { hooks: on = true } = {}) => git(wt(b), ...(on ? [] : ["-c", "core.hooksPath=/dev/null"]), "push", "-q", "-u", "origin", b);
  const resume = () => spawnSync(process.execPath, [join(main, "scripts/lane-state.mjs"), "resume", state, "--no-github"], { cwd: main, env, encoding: "utf8" });
  const actions = (out: string) => Object.fromEntries(out.trim().split("\n").map((l) => { const m = /^(\S+)\s+([^:]+):/.exec(l)!; return [m[2], m[1]]; }));
  const received = () => readFileSync(log, "utf8").trim().split("\n").filter((l) => !l.startsWith("main "));
  return { dir, wt, git, commit, push, resume, actions, received, state, main, env, done: () => {
      killWatchersUnder([dir]);
      rmSync(dir, { recursive: true, force: true });
    } };
}

describe("lane state: stop anywhere, resume without redoing work (W8.10)", () => {
  it("install-hook writes the pre-push half only where no hook notes pushes, and never replaces someone else's", () => {
    expect(prePushPlan(null).action).toBe("write");
    expect(prePushPlan(prePushPlan(null).content).action).toBe("keep");
    expect(prePushPlan(`#!/bin/sh\n${HOOK_BODY.join("\n")}\n`).action).toBe("keep"); // ci:local's hook notes it already
    expect(prePushPlan("#!/bin/sh\necho mine\n").action).toBe("refuse");
    expect(prePushPlan(null).content).toMatch(/\|\| true\nexit 0\n$/);
  });

  it("the hooks record a push in STATE.md with no one writing it", () => {
    const L = lab();
    try {
      const sha = L.commit("done", "work");
      L.push("done");
      // LUMEN_LANE_WATCH=0: the hook records, and leaves no watcher behind.
      for (const at of [L.main, L.wt("done")]) expect(existsSync(resolve(at, L.git(at, "rev-parse", "--git-path", "lumen-lane-watch.json")))).toBe(false);
      const row = parseBranches(readFileSync(L.state, "utf8")).find((r: Branch) => r.branch === "done")!;
      expect(row.pushed).toBe(sha.slice(0, row.pushed!.length));
      expect(readFileSync(L.state, "utf8")).toMatch(new RegExp(`## Pushes[\\s\\S]*done[\\s\\S]*${sha.slice(0, 10)}`));
    } finally {
      L.done();
    }
  }, 60_000);

  it("after a stop: resume says nothing / record / push, following it settles every branch, and no sha reaches origin twice", () => {
    const L = lab();
    try {
      // Before the stop.
      const done = L.commit("done", "finished");
      L.push("done");
      const cut = L.commit("cut", "finished");
      L.push("cut", { hooks: false }); // the session died between the push and the STATE.md edit
      const ahead1 = L.commit("ahead", "first half");
      L.push("ahead");
      const ahead2 = L.commit("ahead", "second half"); // committed, never pushed: then the stop
      expect(L.received()).toEqual([`done ${done}`, `cut ${cut}`, `ahead ${ahead1}`]);

      // The next session.
      const first = L.resume();
      expect(L.actions(first.stdout)).toEqual({ done: "nothing", cut: "record", ahead: "push" });
      expect(first.status).toBe(1); // a record is owed before anything else
      expect(first.stdout).toMatch(/push\s+ahead: 1 local commit/);
      // Follow it, exactly.
      const rec = spawnSync(process.execPath, [join(L.main, "scripts/lane-state.mjs"), "record", L.state, "--branch", "cut", "--sha", cut], { cwd: L.main, env: L.env, encoding: "utf8" });
      expect(rec.status, rec.stderr).toBe(0);
      L.push("ahead");

      const second = L.resume();
      expect(L.actions(second.stdout)).toEqual({ done: "nothing", cut: "nothing", ahead: "nothing" });
      expect(second.status).toBe(0);
      // origin got each sha once: "done" and "cut" once, "ahead" twice with two different shas.
      const got = L.received();
      expect(got).toEqual([`done ${done}`, `cut ${cut}`, `ahead ${ahead1}`, `ahead ${ahead2}`]);
      expect(new Set(got).size).toBe(got.length);
      // STATE.md now holds what origin holds, written by the hook (ahead) and by record (cut).
      const rows: Record<string, string | null | undefined> = Object.fromEntries(parseBranches(readFileSync(L.state, "utf8")).map((r: Branch) => [r.branch, r.pushed]));
      for (const [b, sha] of Object.entries({ done, cut, ahead: ahead2 })) expect(sha.startsWith(rows[b]!)).toBe(true);
    } finally {
      L.done();
    }
  }, 90_000);
});
