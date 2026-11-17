/**
 * Pace and a conditional ETA for the plan board, from the git history of
 * plan/plan.json (R12.21).
 *
 * from talstilkol/tasker (owner's code): src/analytics/progress.js (TK-B4)
 * @ a696fd2 — `buildHistory` (last point per day) and `computeVelocity`
 * (7- and 30-day rate, trend, ETA only with enough points, a range from the
 * two rates, a confidence) are tasker's rules, ported to this plan's shape:
 * the points are counted here from each committed plan.json, not parsed
 * from Markdown, and comments are in English.
 *
 * No number without a source: every point is a commit (sha and time), `now`
 * is the newest point's time (never the clock, so the board is the same on
 * every machine with the same history), there is no Math.random, and with
 * too few points the board says "no pace" instead of guessing.
 *
 * Calibration is an approximation and is marked as one: the planned minutes
 * of the tasks that turned ✅ per day, against the planned minutes left.
 */
import { execFileSync } from "node:child_process";

const DAY = 86_400_000;

/** Done and total tasks of one plan.json, and their planned minutes. */
export function countPlan(plan) {
  const c = { done: 0, partial: 0, total: 0, countable: 0, doneMinutes: 0, totalMinutes: 0 };
  for (const p of plan?.phases ?? [])
    for (const t of p.tasks ?? []) {
      c.total++;
      c.countable++;
      const m = Number(t.minutes) || 0;
      c.totalMinutes += m;
      if (String(t.status ?? "").startsWith("✅")) {
        c.done++;
        c.doneMinutes += m;
      }
    }
  return c;
}

/**
 * Points from git: the last commit of each day that touched the plan, newest
 * `days` days. Returns [] outside a git repo or when git fails.
 */
export function historyFromGit(root, { path = "plan/plan.json", days = 60, git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }) } = {}) {
  let log;
  try {
    log = git(["log", "--format=%H %ct", "--", path]);
  } catch {
    return [];
  }
  const commits = log
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha, ct] = l.split(" ");
      return { sha, t: Number(ct) * 1000 };
    });
  if (!commits.length) return [];
  const newest = commits[0].t;
  const lastPerDay = new Map();
  for (const c of commits) {
    if (c.t < newest - days * DAY) continue;
    const day = new Date(c.t).toISOString().slice(0, 10);
    if (!lastPerDay.has(day)) lastPerDay.set(day, c); // log is newest first
  }
  const points = [];
  for (const c of lastPerDay.values()) {
    try {
      points.push({ sha: c.sha, t: c.t, ...countPlan(JSON.parse(git(["show", `${c.sha}:${path}`]))) });
    } catch {
      /* why: an old plan.json that does not parse is not a point */
    }
  }
  return points.sort((a, b) => a.t - b.t);
}

/** tasker's buildHistory: sorted, the last point of each day, no future points. */
export function buildHistory(points, now) {
  const byDay = new Map();
  for (const p of [...points].sort((a, b) => a.t - b.t)) byDay.set(new Date(p.t).toISOString().slice(0, 10), { ...p, invalid: !p.countable });
  return [...byDay.values()].filter((p) => p.t <= now + DAY);
}

function doneAt(points, t) {
  let v = null;
  for (const p of points) {
    if (p.t <= t) v = p;
    else break;
  }
  return v;
}

/** tasker's computeVelocity, with `key` choosing what is counted ("done" tasks or "doneMinutes"). */
export function computeVelocity(history, counters, now, key = "done") {
  const pts = history.filter((p) => !p.invalid);
  const res = { perDay7: null, perDay30: null, trend: "none", etaDays: null, etaDate: null, etaRange: null, lastProgressAt: null, confidence: "none", points: pts.length, spanDays: 0 };
  if (!pts.length) return res;
  res.spanDays = (pts[pts.length - 1].t - pts[0].t) / DAY;
  for (let i = 1; i < pts.length; i++) if (pts[i][key] > pts[i - 1][key]) res.lastProgressAt = pts[i].t;
  const last = pts[pts.length - 1];
  const rate = (days) => {
    const start = now - days * DAY;
    const inWindow = pts.filter((p) => p.t >= start);
    if (inWindow.length < 2) {
      const before = doneAt(pts, start);
      if (!before || inWindow.length < 1) return null;
      if (last.t - before.t < 2 * DAY) return null;
      return (last[key] - before[key]) / days;
    }
    if (inWindow[inWindow.length - 1].t - inWindow[0].t < 2 * DAY) return null;
    const before = doneAt(pts, start) || inWindow[0];
    return (last[key] - before[key]) / days;
  };
  res.perDay7 = rate(7);
  res.perDay30 = rate(30);
  if (res.perDay7 != null && res.perDay30 != null) res.trend = res.perDay7 > 1.25 * res.perDay30 ? "up" : res.perDay7 < 0.75 * res.perDay30 ? "down" : "flat";
  const in30 = pts.filter((p) => p.t >= now - 30 * DAY).length;
  const total = key === "done" ? counters?.countable : counters?.totalMinutes;
  const remaining = counters ? Math.max(0, total - counters[key]) : null;
  if (remaining != null && res.perDay30 != null && res.perDay30 > 0 && in30 >= 3) {
    const d30 = remaining / res.perDay30;
    const d7 = res.perDay7 != null && res.perDay7 > 0 ? remaining / res.perDay7 : null;
    res.etaDays = d30;
    res.etaDate = new Date(now + d30 * DAY).toISOString().slice(0, 10);
    res.etaRange = d7 != null ? [Math.min(d7, d30), Math.max(d7, d30)] : [d30, d30];
    res.confidence = in30 >= 6 && res.spanDays >= 14 ? "mid" : "low";
  }
  return res;
}

/** Pace for the board: by tasks, and by planned minutes (the approximate calibration). */
export function planVelocity(unsorted, current) {
  const points = [...unsorted].sort((a, b) => a.t - b.t);
  if (!points.length) return { points: 0, now: null, tasks: computeVelocity([], current, 0), minutes: computeVelocity([], current, 0, "doneMinutes"), current, newest: null };
  const now = points[points.length - 1].t;
  const history = buildHistory(points, now);
  return { points: history.length, now, newest: points[points.length - 1].sha, current, tasks: computeVelocity(history, current, now), minutes: computeVelocity(history, current, now, "doneMinutes") };
}

const f1 = (x) => (Math.round(x * 10) / 10).toLocaleString("en-US");
const ddmm = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const TREND = { up: "מאיץ ↑", down: "מאט ↓", flat: "יציב →", none: "" };

/** The one line the board shows (Hebrew, like the rest of the board). */
export function velocityLine(v) {
  const t = v.tasks;
  if (!v.points || t.perDay30 == null) return `אין קצב: ${v.points} נקודות היסטוריה של plan/plan.json, צריך לפחות 3 ימים עם התקדמות ב-30 הימים האחרונים.`;
  const parts = [`קצב: ${f1(t.perDay7 ?? 0)} משימות ליום (7 ימים) · ${f1(t.perDay30)} (30 ימים)${TREND[t.trend] ? ` · ${TREND[t.trend]}` : ""}`];
  if (t.etaDate) parts.push(`סיום משוער ${ddmm(t.etaDate)} (טווח ${Math.round(t.etaRange[0])}–${Math.round(t.etaRange[1])} ימים, ביטחון ${t.confidence === "mid" ? "בינוני" : "נמוך"})`);
  else parts.push("ETA: אין מספיק נקודות");
  if (v.minutes.perDay30 != null) parts.push(`כיול (קירוב): ${f1(v.minutes.perDay30 / 60)} שעות מתוכננות נסגרות ביום${v.minutes.etaDays != null ? `, ${Math.round(v.minutes.etaDays)} ימים לפי הדקות שנותרו` : ""}`);
  parts.push(`מקור: ${v.points} נקודות מ-git, האחרונה ${v.newest.slice(0, 10)}`);
  return parts.join(" · ");
}

export const VELOCITY_START = "<!-- velocity:start -->";
export const VELOCITY_END = "<!-- velocity:end -->";
/** The board without its velocity block: what `--check` compares, since the block follows git history, not plan.json. */
export const withoutVelocity = (html) => html.replace(/<!-- velocity:start -->[\s\S]*?<!-- velocity:end -->/, `${VELOCITY_START}${VELOCITY_END}`);
