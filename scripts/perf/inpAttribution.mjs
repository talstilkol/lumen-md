/**
 * INP in three engines with LoAF attribution (plan W13.V1).
 *
 * Since Safari 26.2 (December 2025) INP and LCP are Baseline: the Event
 * Timing API reports interactions in Chromium, Firefox and WebKit, so the
 * same budget is gated in all three — p75 ≤ 200 ms over the same 20
 * interactions (e2e/inp-engines.spec.ts writes reports/perf/inp-<engine>.json).
 *
 * In Chromium, the Long Animation Frames API (W3C WD, April 2026) says which
 * script ran in a slow frame: `scripts[]` with the file, the function and
 * what invoked it. Every interaction over the budget is matched with the
 * long frames it overlaps, and the report names the file and function that
 * took the time. An engine without LoAF says so ("no LoAF in this engine"),
 * it does not pass silently.
 */

export const INP_BUDGET_MS = 200;
export const ENGINES = ["chromium", "firefox", "webkit"];

export function p75(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.75 * s.length) - 1)];
}

/**
 * The long frames an interaction overlaps, and their scripts, longest first.
 * @param {{ name: string, start: number, ms: number }} it   the interaction (its start, its duration)
 * @param {Array<{ startTime: number, duration: number, blockingDuration?: number, scripts?: Array<{ sourceURL?: string, sourceFunctionName?: string, invoker?: string, invokerType?: string, duration: number, startTime?: number }> }>} loafs
 */
export function attributeInteraction(it, loafs) {
  const end = it.start + it.ms;
  const frames = loafs.filter((f) => f.startTime < end && f.startTime + f.duration > it.start);
  const scripts = frames
    .flatMap((f) => f.scripts ?? [])
    .map((s) => ({
      file: (s.sourceURL || "").replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "") || "(inline or unknown)",
      fn: s.sourceFunctionName || "(anonymous)",
      invoker: s.invoker || s.invokerType || "",
      ms: Math.round(s.duration * 10) / 10,
    }))
    .sort((a, b) => b.ms - a.ms);
  return { frames: frames.length, scripts, top: scripts[0] ?? null };
}

/**
 * One engine's report: p75, and for every interaction over the budget its
 * attribution (or why there is none).
 * @param {{ engine: string, loafSupported: boolean, interactions: Array<{ name: string, start: number, ms: number }>, loafs: any[] }} run
 */
export function engineReport(run, budget = INP_BUDGET_MS) {
  const value = p75(run.interactions.map((i) => i.ms));
  const slow = run.interactions
    .filter((i) => i.ms > budget)
    .map((i) => ({ name: i.name, ms: i.ms, ...(run.loafSupported ? attributeInteraction(i, run.loafs) : { frames: 0, scripts: [], top: null, note: "no LoAF in this engine" }) }));
  return { engine: run.engine, interactions: run.interactions.length, p75: value, budget, ok: value <= budget, slow };
}

/**
 * The gate over the engines' reports (each `engineReport` input or null when
 * missing). Fails on a missing engine, fewer than 20 interactions, p75 over
 * the budget, or a slow interaction in an engine with LoAF that no script
 * could be named for.
 */
export function engineGate(runs, { engines = ENGINES, budget = INP_BUDGET_MS, minInteractions = 20 } = {}) {
  const problems = [];
  const reports = [];
  for (const engine of engines) {
    const run = runs[engine];
    if (!run) {
      problems.push(`${engine}: no report (reports/perf/inp-${engine}.json) — run the inp-${engine} project`);
      continue;
    }
    const r = engineReport(run, budget);
    reports.push(r);
    if (r.interactions < minInteractions) problems.push(`${engine}: ${r.interactions} interactions, ${minInteractions} needed`);
    if (!r.ok) problems.push(`${engine}: INP p75 ${r.p75} ms > ${budget} ms`);
    for (const s of r.slow) if (run.loafSupported && !s.top) problems.push(`${engine}: "${s.name}" took ${s.ms} ms and no long-animation-frame script explains it`);
  }
  return { ok: problems.length === 0, problems, reports };
}

/** The report as Markdown: a row per engine, then the slow interactions with file and function. */
export function renderEngines(gate) {
  const lines = ["| engine | interactions | INP p75 ms | budget | result |", "|---|---|---|---|---|"];
  for (const r of gate.reports) lines.push(`| ${r.engine} | ${r.interactions} | ${r.p75} | ${r.budget} | ${r.ok ? "✓" : "✗"} |`);
  for (const r of gate.reports)
    for (const s of r.slow) lines.push("", `- ${r.engine} · ${s.name}: ${s.ms} ms — ${s.top ? `${s.top.file} › ${s.top.fn} (${s.top.ms} ms${s.top.invoker ? `, ${s.top.invoker}` : ""})` : s.note ?? "no script named"}`);
  if (gate.problems.length) lines.push("", ...gate.problems.map((p) => `✗ ${p}`));
  return lines.join("\n");
}
