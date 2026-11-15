#!/usr/bin/env node
/**
 * W11.Q12: compare the Vercel CI trial with Buildkite on the same commit,
 * for the two steps the trial runs (lint, unit tests), and say whether to
 * keep Vercel CI as a fallback by the rule in
 * docs/dev/decisions/vercel-ci-trial.md.
 *
 *   node scripts/ci/ci-compare.mjs --buildkite build.json --vercel lint=95,test=412 [--vercel-cost 0] [--needs-restructure no]
 *
 * build.json is Buildkite's REST answer for the build
 * (GET /v2/organizations/<org>/pipelines/<pipeline>/builds/<n>): the lint
 * job's and the vitest jobs' started_at / finished_at. The vitest step runs
 * in shards; its time is from the first shard's start to the merge job's end.
 * The Vercel times are seconds from `vc ci logs` / the run's page.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const secs = (a, b) => (Date.parse(b) - Date.parse(a)) / 1000;

/** Wall-clock seconds of the lint step and of the unit tests (plan + shards + merge) in a Buildkite build. */
export function buildkiteTimes(build) {
  const jobs = (build.jobs ?? []).filter((j) => j.type === "script" && j.started_at && j.finished_at);
  const by = (pred) => jobs.filter((j) => pred(j.step_key ?? "", j.name ?? ""));
  const lint = by((k) => k === "lint");
  const unit = by((k, n) => k === "vitest-plan" || k === "vitest" || k === "vitest-merge" || /vitest/i.test(n));
  const span = (js) => (js.length ? secs(js.map((j) => j.started_at).sort()[0], js.map((j) => j.finished_at).sort().at(-1)) : null);
  const busy = (js) => js.reduce((n, j) => n + secs(j.started_at, j.finished_at), 0);
  return { lint: span(lint), test: span(unit), agentSeconds: busy([...lint, ...unit]), commit: build.commit ?? null, passed: [...lint, ...unit].every((j) => j.state === "passed") };
}

/**
 * The rule: keep Vercel CI as a fallback only if it ran both steps without
 * restructuring the repo into a Turborepo, cost nothing on the current plan,
 * and was not slower than Buildkite by more than half on either step.
 */
export function decide(bk, vercel, { cost = 0, restructure = false } = {}) {
  const reasons = [];
  if (restructure) reasons.push("needs the repo restructured for Turborepo");
  if (cost > 0) reasons.push(`costs $${cost}/month`);
  for (const step of ["lint", "test"]) {
    if (vercel[step] == null) reasons.push(`no Vercel time for ${step}`);
    else if (bk[step] != null && vercel[step] > bk[step] * 1.5) reasons.push(`${step}: ${vercel[step]} s on Vercel vs ${Math.round(bk[step])} s on Buildkite`);
  }
  return { decision: reasons.length ? "drop" : "keep as fallback", reasons };
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (k) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const bk = buildkiteTimes(JSON.parse(readFileSync(opt("buildkite"), "utf8")));
  const vercel = Object.fromEntries((opt("vercel") ?? "").split(",").filter(Boolean).map((kv) => kv.split("=")).map(([k, v]) => [k, Number(v)]));
  const d = decide(bk, vercel, { cost: Number(opt("vercel-cost") ?? 0), restructure: opt("needs-restructure") === "yes" });
  console.log(`| step | Buildkite s | Vercel CI s |\n|---|---|---|\n| lint | ${bk.lint ?? "—"} | ${vercel.lint ?? "—"} |\n| unit tests | ${bk.test ?? "—"} | ${vercel.test ?? "—"} |`);
  console.log(`\nBuildkite agent time ${Math.round(bk.agentSeconds)} s on commit ${bk.commit}; decision: ${d.decision}${d.reasons.length ? ` (${d.reasons.join("; ")})` : ""}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
