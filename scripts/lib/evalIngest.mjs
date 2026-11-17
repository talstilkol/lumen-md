/**
 * Plan 7.9 / W10.E12: taking real eval runs into the app.
 *
 * `npm run eval:agents -- --model <m>` on a machine with Ollama writes
 * eval/results/agents-<date>-<model>.json. This module checks that a run
 * is acceptable (a real model, a complete record), scores each model per
 * agent, writes the scores into models/registry.json (`measured`), picks
 * each agent's default model (the best one at or above the threshold, open
 * licence only), and lists the agents no model passes, with the failing
 * cases, as work for the next wave. Plain JavaScript, shared by
 * scripts/eval/ingest.mjs and its tests.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set(["ok", "failed", "skipped"]);

/** A case passes when the run succeeded and every check holds (src/agents/eval/score.ts `passed`). */
export const casePassed = (r) => r.status === "ok" && Array.isArray(r.checks) && r.checks.every((c) => c && c.ok === true);

/**
 * Is `run` (a parsed results file) acceptable? → { ok, reasons }.
 * `knownModels`: ids of models/registry.json; a run of a model the registry
 * does not list (no licence on record) is not taken.
 */
export function acceptRun(run, knownModels) {
  const reasons = [];
  if (!run || typeof run !== "object") return { ok: false, reasons: ["not a JSON object"] };
  if (run.kind !== "model") reasons.push(`kind is ${JSON.stringify(run.kind ?? null)}, not "model" (a wiring run against the fake server says nothing about quality)`);
  if (typeof run.model !== "string" || !run.model.trim()) reasons.push("no model");
  else if (/fake/i.test(run.model)) reasons.push(`model ${run.model} is the fake server`);
  else if (!knownModels.has(baseName(run.model))) reasons.push(`model ${run.model} is not in models/registry.json (no licence on record)`);
  if (typeof run.date !== "string" || !ISO_DATE.test(run.date)) reasons.push("no ISO date");
  if (typeof run.url !== "string" || !run.url) reasons.push("no Ollama URL");
  if (!Array.isArray(run.results) || !run.results.length) reasons.push("no results");
  else {
    const ids = new Set();
    for (const [i, r] of run.results.entries()) {
      if (!r || typeof r.id !== "string" || typeof r.agent !== "string") {
        reasons.push(`result ${i}: no id or agent`);
        continue;
      }
      if (ids.has(r.id)) reasons.push(`case ${r.id} twice`);
      ids.add(r.id);
      if (!STATUSES.has(r.status)) reasons.push(`case ${r.id}: status ${JSON.stringify(r.status)}`);
      if (!Array.isArray(r.checks)) reasons.push(`case ${r.id}: no checks`);
      else if (r.status === "ok" && !r.checks.length) reasons.push(`case ${r.id}: ok with no checks`);
      if (r.status !== "skipped" && typeof r.model === "string" && r.model && baseName(r.model) !== baseName(run.model)) reasons.push(`case ${r.id} ran on ${r.model}, not ${run.model}`);
    }
    if (run.results.every((r) => r?.status === "skipped")) reasons.push("every case skipped");
  }
  return { ok: reasons.length === 0, reasons };
}

/** `qwen3:8b:latest` → `qwen3:8b`; `x:latest` → `x`. */
export function baseName(model) {
  return String(model).replace(/:latest$/, "");
}

/** Pass rates per agent for one run: { agent: { passed, run, score, failing: [{ id, why }] } }, skipped cases left out. */
export function scoreRun(run) {
  const out = {};
  for (const r of run.results) {
    if (r.status === "skipped") continue;
    const a = (out[r.agent] ??= { passed: 0, run: 0, score: 0, failing: [] });
    a.run++;
    if (casePassed(r)) a.passed++;
    else a.failing.push({ id: r.id, why: r.error || r.checks.filter((c) => !c.ok).map((c) => c.detail || "check failed").join("; ") || r.status });
  }
  for (const a of Object.values(out)) a.score = round(a.passed / a.run);
  return out;
}

const round = (x) => Math.round(x * 1000) / 1000;

/**
 * From every parsed results file ([{ path, run }]): the accepted runs (the
 * newest per model), the rejected ones with their reasons.
 */
export function selectRuns(files, knownModels) {
  const rejected = [];
  const byModel = new Map();
  for (const { path, run } of files) {
    const v = acceptRun(run, knownModels);
    if (!v.ok) {
      rejected.push({ path, reasons: v.reasons });
      continue;
    }
    const m = baseName(run.model);
    const prev = byModel.get(m);
    if (!prev || run.date > prev.run.date || (run.date === prev.run.date && path > prev.path)) byModel.set(m, { path, run });
  }
  return { accepted: [...byModel.values()].sort((a, b) => baseName(a.run.model).localeCompare(baseName(b.run.model))), rejected };
}

/** The `measured` record a model gets in models/registry.json. */
export function measuredRecord({ path, run }) {
  const agents = scoreRun(run);
  const passed = Object.values(agents).reduce((n, a) => n + a.passed, 0);
  const total = Object.values(agents).reduce((n, a) => n + a.run, 0);
  return {
    eval: "agents",
    date: run.date,
    source: path,
    overall: { passed, run: total, score: round(passed / total) },
    agents: Object.fromEntries(Object.entries(agents).sort(([a], [b]) => a.localeCompare(b)).map(([k, a]) => [k, { passed: a.passed, run: a.run, score: a.score }])),
  };
}

/**
 * Each agent's default: the model with the best pass rate at or above the
 * threshold over at least `minCases` cases, open licence only; ties go to
 * the better overall score, then the name. → { defaults, failed }:
 * `failed` lists agents no model passes, with each model's failing cases.
 */
export function pickDefaults(accepted, registry, acceptance) {
  const licence = new Map(registry.models.map((m) => [m.id, m.class]));
  const per = new Map(); // agent → [{ model, score, run, overall, failing }]
  for (const a of accepted) {
    const rec = measuredRecord(a);
    const scores = scoreRun(a.run);
    for (const [agent, s] of Object.entries(scores)) {
      if (!per.has(agent)) per.set(agent, []);
      per.get(agent).push({ model: baseName(a.run.model), score: s.score, run: s.run, overall: rec.overall.score, failing: s.failing, date: a.run.date, source: a.path });
    }
  }
  const defaults = {};
  const failed = [];
  for (const agent of [...per.keys()].sort()) {
    const rule = { threshold: acceptance.threshold, minCases: acceptance.minCases, ...(acceptance.agents?.[agent] ?? {}) };
    const ok = per
      .get(agent)
      .filter((c) => c.score >= rule.threshold && c.run >= rule.minCases && licence.get(c.model) === "allowed")
      .sort((x, y) => y.score - x.score || y.overall - x.overall || x.model.localeCompare(y.model));
    if (ok.length) defaults[agent] = { model: ok[0].model, score: ok[0].score, cases: ok[0].run, date: ok[0].date, source: ok[0].source };
    else failed.push({ agent, threshold: rule.threshold, minCases: rule.minCases, tried: per.get(agent).map((c) => ({ model: c.model, score: c.score, run: c.run, allowed: licence.get(c.model) === "allowed", failing: c.failing })) });
  }
  return { defaults, failed };
}

/** models/registry.json with each accepted model's `measured` (other models untouched). */
export function withMeasured(registry, accepted) {
  const rec = new Map(accepted.map((a) => [baseName(a.run.model), measuredRecord(a)]));
  return { ...registry, models: registry.models.map((m) => (rec.has(m.id) ? { ...m, measured: rec.get(m.id) } : m)) };
}

/** src/ai/defaults.ts: generated, deterministic. */
export function defaultsModule(defaults, accepted) {
  const scores = Object.fromEntries(accepted.map((a) => [baseName(a.run.model), measuredRecord(a).overall.score]).sort(([a], [b]) => a.localeCompare(b)));
  return `/**
 * GENERATED by scripts/eval/ingest.mjs (plan 7.9, W10.E12) from the real
 * eval runs in eval/results/ — do not edit by hand: run
 * \`npm run eval:ingest\` after \`npm run eval:agents -- --model <m>\`.
 *
 * MEASURED_DEFAULTS: each agent's default Ollama model, the best one whose
 * pass rate on that agent's cases met the threshold (eval/acceptance.json).
 * MEASURED_SCORES: each measured model's overall pass rate (0–1), which
 * src/ai/modelCatalog.ts ranks recommendations by. Empty until a real run
 * is committed: no number here comes from anywhere else.
 */

export interface MeasuredDefault {
  model: string;
  /** Pass rate (0–1) on the agent's cases. */
  score: number;
  cases: number;
  date: string;
  source: string;
}

export const MEASURED_DEFAULTS: Readonly<Record<string, MeasuredDefault>> = ${JSON.stringify(defaults, null, 2)};

export const MEASURED_SCORES: Readonly<Record<string, number>> = ${JSON.stringify(scores, null, 2)};

/**
 * The measured default for \`agent\` when it is installed and the user has
 * not picked a model (\`lumen.ollama.model\`, which always wins), or null.
 */
export function measuredModelFor(agent: string, installed: readonly string[], configured: string | null): string | null {
  if (configured) return null;
  const d = MEASURED_DEFAULTS[agent];
  if (!d) return null;
  return installed.find((m) => m === d.model || m === \`\${d.model}:latest\`) ?? null;
}
`;
}

/** The line failures.md carries while no real run is accepted (scripts/known-issues.mjs reads it). */
export const NOTHING_MEASURED = "No real eval run has been taken yet (eval/results/ holds none that is acceptable): nothing is measured.";

/** The agents no model passes, as Markdown tasks for the next wave. */
export function failuresReport(failed, rejected, accepted = []) {
  const lines = ["# Agents no measured model passes (plan 7.9 → wave 11)", "", "Generated by `npm run eval:ingest`. Each agent below is a task: fix its prompt or checks, or pick a model that passes.", ""];
  if (!accepted.length) lines.push(NOTHING_MEASURED, "");
  else if (!failed.length) lines.push(`Every agent measured in ${accepted.length} run(s) has a default.`, "");
  for (const f of failed) {
    lines.push(`## ${f.agent}`, "", `Threshold ${f.threshold} over at least ${f.minCases} cases.`, "");
    for (const t of f.tried) {
      lines.push(`- **${t.model}**: ${t.score} over ${t.run} cases${t.allowed ? "" : " (custom licence: never a default)"}`);
      for (const c of t.failing) lines.push(`  - \`${c.id}\`: ${c.why || "failed"}`);
    }
    lines.push("");
  }
  if (rejected.length) {
    lines.push("## Runs not taken", "");
    for (const r of rejected) lines.push(`- \`${r.path}\`: ${r.reasons.join("; ")}`);
    lines.push("");
  }
  return lines.join("\n");
}
