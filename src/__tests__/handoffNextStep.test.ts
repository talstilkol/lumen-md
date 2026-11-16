/**
 * Plan 0.13's acceptance, tested: "a new agent does the next step correctly
 * from the document alone". The agent here gets only the text of
 * docs/dev/HANDOFF.md (as `npm run handoff` writes it in a real checkout):
 * it reads the task, the worktree and branch, and the next step, runs the
 * step there, and the step lands on the right branch.
 */
import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs helper without types
import { nextStepProblems, readHandoff, renderHandoff } from "../../scripts/lib/handoff.mjs";

const base = { now: "2026-11-16T00:00:00Z", repo: "o/r", prs: [], worktrees: [], problems: [] };

describe("the handoff's Now section", () => {
  it("round-trips the task, where and the next step, | included", () => {
    const md = renderHandoff({ ...base, task: "0.13 handoff", next: "npm run x -- --a | tee log", where: { path: "/w/lane a", branch: "fix/a|b" } });
    expect(md).toContain("- **Where:** `/w/lane a` on `fix/a\\|b`");
    expect(readHandoff(md)).toEqual({ task: "0.13 handoff", next: "npm run x -- --a | tee log", where: { path: "/w/lane a", branch: "fix/a|b" } });
  });

  it("an empty task and step read back as null", () => {
    expect(readHandoff(renderHandoff({ ...base, task: null, next: null }))).toEqual({ task: null, next: null, where: null });
  });

  it("a task without a next step, or a step with no worktree, is a problem", () => {
    expect(nextStepProblems({ task: "t", next: null, where: { path: "/w" } })).toEqual([expect.stringMatching(/no next step/)]);
    expect(nextStepProblems({ task: "t", next: "make", where: null })).toEqual([expect.stringMatching(/no worktree/)]);
    expect(nextStepProblems({ task: "t", next: "make", where: { path: "/w", branch: "b" } })).toEqual([]);
  });
});

describe("a new agent continues from HANDOFF.md alone", () => {
  it("runs the next step in the worktree the document names, and it lands on the task's branch", () => {
    const dir = mkdtempSync(join(tmpdir(), "lumen-handoff-next-"));
    try {
      writeFileSync(join(dir, "gitconfig"), "");
      const env = { ...process.env, GIT_CONFIG_GLOBAL: join(dir, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
      const main = join(dir, "main");
      execFileSync("git", ["init", "-q", "-b", "main", main], { env });
      const g = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, env, encoding: "utf8" }).trim();
      g(main, "remote", "add", "origin", "https://github.com/o/r.git");
      const repo = resolve(__dirname, "../..");
      mkdirSync(join(main, "scripts/lib"), { recursive: true });
      cpSync(join(repo, "scripts/handoff.mjs"), join(main, "scripts/handoff.mjs"));
      cpSync(join(repo, "scripts/lib/handoff.mjs"), join(main, "scripts/lib/handoff.mjs"));
      g(main, "add", ".");
      g(main, "commit", "-q", "-m", "base");
      // The lane: its own worktree on its branch, where the handoff is written from.
      const lane = join(dir, "lane w");
      g(main, "worktree", "add", "-q", "-b", "fix/next-step", lane);
      const step = "printf 'done\\n' > STEP.txt && git add STEP.txt && git commit -q -m 'the next step'";
      const r = spawnSync(process.execPath, [join(lane, "scripts/handoff.mjs"), "--no-github", "--task", "0.13 demo", "--next", step], { cwd: dir, env, encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      const doc = readFileSync(join(lane, "docs/dev/HANDOFF.md"), "utf8");

      // The new agent: nothing but the document's text.
      const h = readHandoff(doc);
      expect(h.task).toBe("0.13 demo");
      expect(h.where).toEqual({ path: lane, branch: "fix/next-step" });
      expect(existsSync(h.where!.path)).toBe(true);
      expect(g(h.where!.path, "branch", "--show-current")).toBe(h.where!.branch);
      execFileSync("bash", ["-c", h.next!], { cwd: h.where!.path, env });

      expect(g(main, "log", "-1", "--format=%s", "fix/next-step")).toBe("the next step");
      expect(g(main, "log", "-1", "--format=%s", "main")).toBe("base");
      expect(readFileSync(join(lane, "STEP.txt"), "utf8")).toBe("done\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses (exit 1, the problem in the document) a handoff with a task and no next step", () => {
    const dir = mkdtempSync(join(tmpdir(), "lumen-handoff-none-"));
    try {
      writeFileSync(join(dir, "gitconfig"), "");
      const env = { ...process.env, GIT_CONFIG_GLOBAL: join(dir, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
      const main = join(dir, "main");
      execFileSync("git", ["init", "-q", "-b", "main", main], { env });
      execFileSync("git", ["remote", "add", "origin", "https://github.com/o/r.git"], { cwd: main, env });
      const repo = resolve(__dirname, "../..");
      mkdirSync(join(main, "scripts/lib"), { recursive: true });
      cpSync(join(repo, "scripts/handoff.mjs"), join(main, "scripts/handoff.mjs"));
      cpSync(join(repo, "scripts/lib/handoff.mjs"), join(main, "scripts/lib/handoff.mjs"));
      execFileSync("git", ["add", "."], { cwd: main, env });
      execFileSync("git", ["commit", "-q", "-m", "base"], { cwd: main, env });
      const r = spawnSync(process.execPath, [join(main, "scripts/handoff.mjs"), "--no-github", "--stdout", "--task", "0.13 demo"], { cwd: dir, env, encoding: "utf8" });
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/⚠️ no next step: a new agent cannot continue/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
