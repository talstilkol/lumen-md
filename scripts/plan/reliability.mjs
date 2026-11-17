/**
 * Plan W4.24 — how far the plan's claims are checked, per area.
 *
 * Every task with a status carries `verified` (W4.24): built < node <
 * browser < real, or owner (waiting on Tal). The reliability score of an
 * area is 10 × the mean weight of the levels of its tasks that have a
 * status, so a ✅ that only compiled pulls the area down as much as an
 * honest ⏳ at the same level does:
 *
 *   real 1 · browser 0.75 · node 0.5 · built 0.25 · owner 0 · no level 0
 *
 * The gap is what stands between the area's claims and that score: tasks
 * marked ✅ below `browser` (plan:check refuses those, W10.G8), ✅ not yet
 * `real`, and tasks with a status but no level.
 *
 * Used by scripts/plan/areas.mjs (the area board). Kept apart from
 * build.mjs, which imports areas.mjs.
 */

/** Weakest first; the same list as build.mjs VERIFIED_LEVELS (planAreas.test.ts checks it). */
export const RELIABILITY_LEVELS = Object.freeze(["built", "node", "browser", "real", "owner"]);

export const LEVEL_WEIGHT = Object.freeze({ built: 0.25, node: 0.5, browser: 0.75, real: 1, owner: 0 });

const isDone = (status) => typeof status === "string" && status.startsWith("✅");

/**
 * The reliability of one area.
 * @param {Array<{ id: string, status?: string, verified?: string }>} tasks the area's plan tasks
 */
export function areaReliability(tasks) {
  const levels = Object.fromEntries([...RELIABILITY_LEVELS, "none"].map((k) => [k, 0]));
  let weight = 0;
  let rated = 0;
  const gap = { doneBelowBrowser: [], doneNotReal: 0, noLevel: 0 };
  for (const t of tasks) {
    if (!t?.status) continue;
    rated++;
    const level = RELIABILITY_LEVELS.includes(t.verified) ? t.verified : "none";
    levels[level]++;
    weight += LEVEL_WEIGHT[level] ?? 0;
    if (level === "none") gap.noLevel++;
    if (isDone(t.status)) {
      if (level !== "real") gap.doneNotReal++;
      if (level !== "browser" && level !== "real") gap.doneBelowBrowser.push(t.id);
    }
  }
  return { score: rated ? Math.round((100 * weight) / rated) / 10 : 0, rated, levels, gap };
}

/** Plan task id → task, for every task in the plan. */
export function planTaskIndex(plan) {
  const out = new Map();
  for (const p of plan?.phases ?? []) for (const t of p.tasks ?? []) out.set(t.id, t);
  return out;
}
