/**
 * Plan W10.G6 (W6.39) — the work-in-progress limit is strict by default:
 * plan:check fails when a wave is over its limit while the next wave has
 * started. The only way past it is a written decision, recorded in
 * plan.schedule.wipDecisions, one per wave pair:
 *
 *   { "wave": 10, "next": 11, "open": 241, "started": 92,
 *     "at": "2026-11-16", "decision": "why the next wave may run before this one is verified" }
 *
 * A decision is a ratchet, never an allowance to grow: `open` (the wave's ⏳
 * tasks verified below browser) and `started` (the next wave's started tasks)
 * are frozen at the numbers the warning has now. More open or more started
 * fails; fewer fails too, until the frozen numbers come down to match, so a
 * decision can never stay looser than the plan. A decision whose wave is no
 * longer over its limit is stale and must be removed.
 *
 * There is no flag that turns this off. `--wip-strict` is still accepted (it
 * is the default now); `--wip-limit N` may only lower the limit.
 */

/** "wave→next", the key of a warning and of its decision. */
const key = (o) => `${o.wave}→${o.next}`;

/**
 * Problems ([] = plan:check passes) for `warnings` (wipWarnings(plan)) against
 * plan.schedule.wipDecisions.
 */
export function wipDecisionProblems(plan, warnings) {
  const problems = [];
  const raw = plan.schedule?.wipDecisions ?? [];
  if (!Array.isArray(raw)) return ["plan.schedule.wipDecisions must be a list"];
  const byKey = new Map();
  for (const d of raw) {
    const ok = d && Number.isInteger(d.wave) && Number.isInteger(d.next) && Number.isInteger(d.open) && Number.isInteger(d.started);
    if (!ok) {
      problems.push(`wipDecisions: ${JSON.stringify(d)} needs whole numbers wave, next, open and started`);
      continue;
    }
    if (typeof d.decision !== "string" || !d.decision.trim()) problems.push(`wipDecisions ${key(d)}: the decision is not written down ("decision")`);
    if (typeof d.at !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.at)) problems.push(`wipDecisions ${key(d)}: "at" is the date of the decision (YYYY-MM-DD)`);
    if (byKey.has(key(d))) problems.push(`wipDecisions ${key(d)}: listed twice`);
    byKey.set(key(d), d);
  }
  const seen = new Set();
  for (const w of warnings) {
    const d = byKey.get(key(w));
    seen.add(key(w));
    if (!d) {
      problems.push(`wave ${w.wave} is over its WIP limit while wave ${w.next} has started — verify wave ${w.wave} first, or record a written decision in plan.schedule.wipDecisions (W10.G6)`);
      continue;
    }
    if (w.open.length > d.open) problems.push(`wipDecisions ${key(d)}: wave ${w.wave} now has ${w.open.length} open tasks below browser, more than the ${d.open} the decision froze — verify, don't grow`);
    else if (w.open.length < d.open) problems.push(`wipDecisions ${key(d)}: wave ${w.wave} is down to ${w.open.length} open tasks below browser — lower "open" from ${d.open} to ${w.open.length} (the ratchet only goes down)`);
    if (w.started.length > d.started) problems.push(`wipDecisions ${key(d)}: wave ${w.next} now has ${w.started.length} started tasks, more than the ${d.started} the decision froze — no new work in wave ${w.next} until wave ${w.wave} is verified`);
    else if (w.started.length < d.started) problems.push(`wipDecisions ${key(d)}: wave ${w.next} is down to ${w.started.length} started tasks — lower "started" from ${d.started} to ${w.started.length} (the ratchet only goes down)`);
  }
  for (const [k, d] of byKey) if (!seen.has(k)) problems.push(`wipDecisions ${k}: wave ${d.wave} is no longer over its WIP limit — remove the decision`);
  return problems;
}

/**
 * The wave pairs ("wave→next") whose warning a decision holds exactly: a decision for the pair, at the
 * warning's open and started counts, with no problem naming the pair. Only these are not printed as warnings.
 */
export function decidedPairs(plan, warnings, problems = wipDecisionProblems(plan ?? {}, warnings)) {
  const out = new Set();
  const raw = Array.isArray(plan?.schedule?.wipDecisions) ? plan.schedule.wipDecisions : [];
  for (const w of warnings) {
    const k = key(w);
    const d = raw.find((x) => x && key(x) === k);
    if (!d || d.open !== w.open.length || d.started !== w.started.length) continue;
    if (problems.some((p) => p.includes(`wipDecisions ${k}`))) continue;
    out.add(k);
  }
  return out;
}

/** The limit `--wip-limit` asks for, refused when it is not a whole number or would raise the plan's own limit. */
export function lowerOnlyLimit(asked, planLimit) {
  if (asked === undefined) return undefined;
  if (!(Number.isInteger(asked) && asked >= 0)) throw new Error(`plan: --wip-limit takes a whole number, not ${JSON.stringify(asked)}`);
  if (asked > planLimit) throw new Error(`plan: --wip-limit ${asked} would raise the limit of ${planLimit}; it can only lower it (W10.G6)`);
  return asked;
}
