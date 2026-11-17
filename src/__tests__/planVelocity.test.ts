/**
 * R12.21: pace and a conditional ETA on the plan board, from the git
 * history of plan/plan.json (tasker's progress.js rules). Synthetic
 * histories, and a synthetic git repo whose commits carry set dates.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeVelocity, countPlan, historyFromGit, planVelocity, velocityLine, withoutVelocity } from "../../scripts/plan/velocity.mjs";

const DAY = 86_400_000;
const T0 = Date.parse("2026-10-01T12:00:00Z");
const plan = (done: number, total: number, minutes = 60) => ({ phases: [{ tasks: Array.from({ length: total }, (_, i) => ({ id: `t${i}`, minutes, status: i < done ? "✅ #1" : "⏳" })) }] });
const point = (day: number, done: number, total = 100) => ({ sha: `${"a".repeat(39)}${day % 10}`, t: T0 + day * DAY, ...countPlan(plan(done, total)) });

describe("countPlan", () => {
  it("counts ✅ tasks and their planned minutes", () => {
    expect(countPlan(plan(3, 10, 30))).toEqual({ done: 3, partial: 0, total: 10, countable: 10, doneMinutes: 90, totalMinutes: 300 });
    expect(countPlan({})).toMatchObject({ done: 0, total: 0 });
  });
});

describe("computeVelocity (tasker's rules)", () => {
  it("a steady history: 2 tasks a day, an ETA with a range and a confidence", () => {
    const pts = Array.from({ length: 21 }, (_, d) => point(d, 10 + 2 * d));
    const v = planVelocity(pts, countPlan(plan(50, 100)));
    expect(v.tasks.perDay7).toBe(2);
    expect(v.tasks.perDay30).toBeCloseTo(40 / 30, 6);
    expect(v.tasks.etaDate).not.toBeNull();
    expect(v.tasks.confidence).toBe("mid");
    expect(v.now).toBe(pts[20].t);
    expect(velocityLine(v)).toMatch(/^קצב: 2 משימות ליום \(7 ימים\) · 1\.3 \(30 ימים\) · מאיץ ↑ · סיום משוער .* ביטחון בינוני\) · כיול \(קירוב\): /);
  });

  it("too few points: no ETA, and the board says there is no pace", () => {
    const v = planVelocity([point(0, 10), point(1, 12)], countPlan(plan(12, 100)));
    expect(v.tasks.etaDays).toBeNull();
    expect(velocityLine(v)).toMatch(/^אין קצב: 2 נקודות/);
    expect(velocityLine(planVelocity([], countPlan(plan(0, 1))))).toMatch(/^אין קצב: 0 נקודות/);
  });

  it("is a function of the history only: the same input gives the same line, and nothing uses the clock or Math.random", () => {
    const pts = Array.from({ length: 10 }, (_, d) => point(d * 2, 5 + d));
    expect(velocityLine(planVelocity(pts, countPlan(plan(14, 100))))).toBe(velocityLine(planVelocity([...pts].reverse(), countPlan(plan(14, 100)))));
    const src = readFileSync("scripts/plan/velocity.mjs", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/Math\.random|Date\.now\(/);
    expect(computeVelocity([], null, 0).trend).toBe("none");
  });
});

describe("historyFromGit on a synthetic repo", () => {
  it("one point per day from plan.json commits, counted from each version", () => {
    const repo = mkdtempSync(join(tmpdir(), "plan-hist-"));
    const g = (args: string[], date?: string) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, encoding: "utf8", env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) } });
    g(["init", "-q"]);
    mkdirSync(join(repo, "plan"));
    const days: Array<[string, number]> = [
      ["2026-11-01T09:00:00Z", 1],
      ["2026-11-01T18:00:00Z", 2],
      ["2026-11-04T09:00:00Z", 4],
      ["2026-11-09T09:00:00Z", 7],
    ];
    for (const [date, done] of days) {
      writeFileSync(join(repo, "plan/plan.json"), JSON.stringify(plan(done, 10)));
      g(["add", "."]);
      g(["commit", "-q", "-m", `plan ${done}`], date);
    }
    const pts = historyFromGit(repo);
    expect(pts.map((p: { done: number }) => p.done)).toEqual([2, 4, 7]);
    expect(pts[2].t).toBe(Date.parse("2026-11-09T09:00:00Z"));
    expect(historyFromGit(mkdtempSync(join(tmpdir(), "not-a-repo-")))).toEqual([]);
  });
});

describe("the board", () => {
  it("--check compares the board without its velocity block", () => {
    const a = "<p>x</p><!-- velocity:start -->קצב: 1<!-- velocity:end --><p>y</p>";
    const b = "<p>x</p><!-- velocity:start -->אין קצב<!-- velocity:end --><p>y</p>";
    expect(withoutVelocity(a)).toBe(withoutVelocity(b));
    expect(withoutVelocity(a)).not.toBe(withoutVelocity(b.replace("<p>y</p>", "<p>z</p>")));
    expect(readFileSync("plan/board.html", "utf8")).toMatch(/<!-- velocity:start -->(?:קצב|אין קצב)[^<]*<!-- velocity:end -->/);
  });
});
