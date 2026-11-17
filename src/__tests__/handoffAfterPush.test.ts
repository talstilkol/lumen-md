// @vitest-environment node
/**
 * Plan 0.13 step 2: "written to docs/dev/HANDOFF.md ... at the end of every
 * PR" — automated. After a push origin confirmed, the lane's
 * reference-transaction hook (scripts/lane-state.mjs committed) regenerates
 * the pushing worktree's handoff with `handoff.mjs --refresh --no-github`,
 * which keeps the task and the next step the document already had. End to
 * end on a throw-away origin, with the real scripts and the real hooks, as
 * laneStateResume.test.ts does.
 */
import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readHandoff, refreshFields, renderHandoff } from "../../scripts/lib/handoff.mjs";
import { handoffRefreshArgs, renderBranches } from "../../scripts/lib/lane-state.mjs";
import { killWatchersUnder } from "./helpers/laneWatchers";

const ROOT = resolve(__dirname, "../..");

describe("the handoff is regenerated at the end of every PR (0.13 step 2)", () => {
  it("refreshFields keeps the task and next step of the document it replaces, unless new ones are given", () => {
    const prev = renderHandoff({ now: "2026-11-17T00:00:00Z", repo: "o/r", task: "0.13 demo", next: "npm test", where: { path: "/w", branch: "b" }, prs: [], worktrees: [], problems: [] });
    expect(refreshFields(prev, { task: null, next: null })).toEqual({ task: "0.13 demo", next: "npm test" });
    expect(refreshFields(prev, { task: "new task", next: "make" })).toEqual({ task: "new task", next: "make" });
    expect(refreshFields(null, { task: null, next: null })).toEqual({ task: null, next: null });
  });

  it("the hook asks for a refresh only after a confirmed push, and only where the script exists", () => {
    expect(handoffRefreshArgs(1, true)).toEqual(["scripts/handoff.mjs", "--refresh", "--no-github"]);
    expect(handoffRefreshArgs(0, true)).toBeNull();
    expect(handoffRefreshArgs(2, false)).toBeNull();
  });

  it("a push from a lane's worktree rewrites its HANDOFF.md, keeping the task and next step", () => {
    const dir = mkdtempSync(join(tmpdir(), "lumen-handoff-push-"));
    try {
      writeFileSync(join(dir, "gitconfig"), "");
      const env: Record<string, string | undefined> = { ...process.env, GIT_CONFIG_GLOBAL: join(dir, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com", LUMEN_LANE_WATCH: "0" };
      delete env.LUMEN_LANE_STATE;
      delete env.LUMEN_LANE_STATE_DIR;
      const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "rerere.enabled=false", ...a], { cwd, env, encoding: "utf8" }).trim();
      const origin = join(dir, "origin.git");
      const main = join(dir, "main");
      execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { env });
      execFileSync("git", ["clone", "-q", origin, main], { env });
      for (const f of ["scripts/lane-state.mjs", "scripts/lib/lane-state.mjs", "scripts/handoff.mjs", "scripts/lib/handoff.mjs"]) {
        mkdirSync(dirname(join(main, f)), { recursive: true });
        copyFileSync(join(ROOT, f), join(main, f));
      }
      writeFileSync(join(main, ".gitignore"), "docs/dev/HANDOFF.md\n");
      git(main, "add", "-A");
      git(main, "commit", "-q", "-m", "base");
      git(main, "push", "-q", "origin", "main");
      const lane = join(dir, "w-feat");
      git(main, "worktree", "add", "-q", "-b", "feat", lane, "main");
      const lanes = join(dir, "lanes");
      mkdirSync(join(lanes, "L"), { recursive: true });
      writeFileSync(join(lanes, "L", "STATE.md"), `# Lane L state\n\nUpdated: 2026-11-17T00:00Z\n\n## Branches\n\n${renderBranches([{ branch: "feat", worktree: lane, base: "main", pushed: null, pr: null }])}\n\n## Pushes\n\n## Next\n\npush\n`);
      const inst = spawnSync(process.execPath, ["scripts/lane-state.mjs", "install-hook", "--state-dir", lanes], { cwd: main, env, encoding: "utf8" });
      expect(inst.status, inst.stderr).toBe(0);

      // The agent wrote its handoff; then the document went stale (a later edit by hand, a moved branch).
      const w = spawnSync(process.execPath, ["scripts/handoff.mjs", "--no-github", "--task", "0.13 push demo", "--next", "npm test"], { cwd: lane, env, encoding: "utf8" });
      expect(w.status, w.stderr).toBe(0);
      const file = join(lane, "docs/dev/HANDOFF.md");
      appendFileSync(file, "\nSTALE LINE\n");

      writeFileSync(join(lane, "work.txt"), "done\n");
      git(lane, "add", "work.txt");
      git(lane, "commit", "-q", "-m", "feat: the work");
      git(lane, "push", "-q", "-u", "origin", "feat");

      const after = readFileSync(file, "utf8");
      expect(after).not.toContain("STALE LINE");
      expect(readHandoff(after)).toEqual({ task: "0.13 push demo", next: "npm test", where: { path: lane, branch: "feat" } });
    } finally {
      killWatchersUnder([dir]);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
