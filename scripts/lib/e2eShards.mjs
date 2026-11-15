/**
 * The sharded e2e run and its signed report (plan W4.2, W6.8; W10.E39).
 * Pure functions; scripts/e2e-gate.mjs runs the shards and seals the report,
 * scripts/promote-main.mjs refuses to move main without it.
 *
 * - Each Buildkite job of the `e2e-shards` step runs one Playwright shard
 *   (`--shard=k/n`) of the whole chromium project against the production
 *   build, inside a 10-minute box, and writes ci-out/e2e-shard-<k>-of-<n>.json.
 * - `e2e-receipt` merges the n shard files into reports/e2e-<sha>.json:
 *   every shard present, every one for the same commit, 0 failed, nothing
 *   interrupted, each inside the box. It is sealed with the host's Ed25519
 *   key (scripts/nightly/receipt.mjs), so a changed number breaks it.
 * - promote-main accepts a candidate only with such a report, signed by a
 *   trusted key, for the candidate's own hash (or a commit with the very same
 *   tree), and with ok: true.
 */

/** The ceiling for one shard, in minutes (W10.E39 acceptance: "a shard < 10 min"). */
export const SHARD_MINUTES = 10;

/**
 * The last full chromium run measured on 2 CPUs and 2 workers
 * (verify/e2e-probe run 4, scripts/e2e-gate.mjs): 327 tests in 29.7 min.
 */
export const MEASURED_FULL_RUN = { tests: 327, minutes: 29.7, workers: 2, source: "verify/e2e-probe run 4" };

/**
 * How many shards keep each one under the ceiling, with `headroom` of the
 * box left for setup and an uneven split (Playwright splits by test count,
 * not by time).
 */
export function shardsFor(minutes, ceiling = SHARD_MINUTES, headroom = 0.75) {
  if (!(minutes > 0) || !(ceiling > 0) || !(headroom > 0 && headroom <= 1)) throw new Error("shardsFor: minutes, ceiling and headroom must be positive (headroom ≤ 1)");
  return Math.max(1, Math.ceil(minutes / (ceiling * headroom)));
}

/** The number of shards the pipeline runs: 29.7 min / (10 × 0.75) → 4, about 7.4 min each. */
export const E2E_SHARDS = shardsFor(MEASURED_FULL_RUN.minutes);

/** "2/4" → { current: 2, total: 4 } (1-based, as Playwright's --shard); anything else throws. */
export function parseShard(spec) {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(spec ?? ""));
  if (!m) throw new Error(`not a shard: "${spec}" (want k/n, e.g. 2/4)`);
  const current = Number(m[1]);
  const total = Number(m[2]);
  if (total < 1 || current < 1 || current > total) throw new Error(`not a shard: "${spec}" (1 ≤ k ≤ n)`);
  return { current, total };
}

/**
 * The shard this job runs: LUMEN_E2E_SHARD ("k/n") when set, else Buildkite's
 * parallel job (BUILDKITE_PARALLEL_JOB is 0-based), else null (the whole run).
 */
export function shardFromEnv(env = process.env) {
  if (env.LUMEN_E2E_SHARD) return parseShard(env.LUMEN_E2E_SHARD);
  const job = env.BUILDKITE_PARALLEL_JOB;
  const count = env.BUILDKITE_PARALLEL_JOB_COUNT;
  if (job !== undefined && job !== "" && count !== undefined && count !== "") return parseShard(`${Number(job) + 1}/${count}`);
  return null;
}

export const shardFile = (s) => `e2e-shard-${s.current}-of-${s.total}.json`;
export const reportPath = (sha) => `reports/e2e-${sha}.json`;
export const isSha = (s) => /^[0-9a-f]{40}$/.test(String(s ?? ""));

/**
 * One shard's result, from the reporter's summary (scripts/e2e-report.mjs).
 *   summary: { status, counts: { passed, failed, skipped, flaky }, tests: [{ id, status, ms }], failures: [{ where, title }] }
 */
export function shardResult({ sha, dirty = false, shard, project = "chromium", scope = "full", summary, startedAt, finishedAt, exit }) {
  const minutes = startedAt && finishedAt ? Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 600) / 100 : null;
  return {
    version: 1,
    kind: "e2e-shard",
    commit: { sha, dirty },
    project,
    scope,
    shard,
    status: summary?.status ?? "missing",
    exit: exit ?? null,
    counts: { passed: 0, failed: 0, skipped: 0, flaky: 0, ...(summary?.counts ?? {}) },
    tests: summary?.tests ?? [],
    failures: (summary?.failures ?? []).map((f) => ({ where: f.where, title: f.title, status: f.status })),
    startedAt: startedAt ?? null,
    finishedAt: finishedAt ?? null,
    minutes,
  };
}

/**
 * The n shard results → the e2e report (unsealed). `ok` is true only when
 * every shard 1..n is there exactly once, all for `sha`, all of the full
 * chromium project, each "passed" with exit 0 and 0 failed, each under the
 * ceiling, more than 0 tests passed, and no test ran in two shards.
 */
export function mergeShards(results, { sha, total, ceiling = SHARD_MINUTES, build = null, machine = null } = {}) {
  const problems = [];
  if (!isSha(sha)) problems.push(`not a commit sha: ${sha || "unset"}`);
  if (!(total >= 1)) problems.push("the number of shards is unknown");
  const byIndex = new Map();
  for (const r of results) {
    const k = r?.shard?.current;
    if (byIndex.has(k)) problems.push(`shard ${k} reported twice`);
    byIndex.set(k, r);
  }
  for (let k = 1; k <= total; k++) if (!byIndex.has(k)) problems.push(`shard ${k}/${total} is missing`);
  const seen = new Map();
  for (const [k, r] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) {
    const at = `shard ${k}/${total}`;
    if (r.shard?.total !== total) problems.push(`${at}: ran as ${r.shard?.current}/${r.shard?.total}`);
    if (r.commit?.sha !== sha) problems.push(`${at}: for ${String(r.commit?.sha).slice(0, 12)}, not ${String(sha).slice(0, 12)}`);
    if (r.commit?.dirty) problems.push(`${at}: ran on a working tree with uncommitted changes`);
    if (r.project !== "chromium") problems.push(`${at}: project ${r.project}, not chromium`);
    if (r.scope !== "full") problems.push(`${at}: ran ${r.scope}, not the full suite`);
    if (r.status !== "passed") problems.push(`${at}: status ${r.status}`);
    if (r.exit !== 0) problems.push(`${at}: exit ${r.exit}`);
    if (r.counts?.failed) problems.push(`${at}: ${r.counts.failed} failed (${r.failures.map((f) => f.where).slice(0, 5).join(", ")})`);
    if (typeof r.minutes !== "number") problems.push(`${at}: no duration`);
    else if (r.minutes >= ceiling) problems.push(`${at}: took ${r.minutes} min, the ceiling is ${ceiling}`);
    for (const t of r.tests ?? []) {
      if (seen.has(t.id)) problems.push(`${t.id} ran in shards ${seen.get(t.id)} and ${k}`);
      else seen.set(t.id, k);
    }
  }
  const sum = (f) => results.reduce((n, r) => n + (Number(r?.counts?.[f]) || 0), 0);
  const totals = { passed: sum("passed"), failed: sum("failed"), skipped: sum("skipped"), flaky: sum("flaky"), tests: seen.size };
  if (!problems.length && totals.passed === 0) problems.push("0 tests passed");
  const minutes = results.map((r) => r?.minutes).filter((m) => typeof m === "number");
  return {
    version: 1,
    kind: "e2e",
    commit: { sha },
    project: "chromium",
    scope: "full",
    ceilingMinutes: ceiling,
    build,
    machine,
    shards: [...byIndex.values()]
      .sort((a, b) => (a.shard?.current ?? 0) - (b.shard?.current ?? 0))
      .map((r) => ({ shard: r.shard, status: r.status, exit: r.exit, counts: r.counts, minutes: r.minutes, failures: r.failures })),
    totals,
    longestShardMinutes: minutes.length ? Math.max(...minutes) : null,
    ok: problems.length === 0,
    problems,
  };
}

/**
 * promote-main's verdict for one candidate.
 *   report:   the e2e report (parsed JSON) or null
 *   verified: { ok, problems } from scripts/nightly/receipt.mjs check() with a trusted key
 *   sameTree(a, b): true when commits a and b have the same tree
 * → { ok, why: [] }
 */
export function e2eVerdict(candidate, report, verified, sameTree = (a, b) => a === b) {
  const why = [];
  if (!report) return { ok: false, why: [`no e2e report for ${candidate.slice(0, 12)} (${reportPath(candidate)})`] };
  if (report.kind !== "e2e") why.push(`not an e2e report (kind ${report.kind})`);
  if (!verified?.ok) why.push(`the signature does not hold: ${(verified?.problems ?? ["not verified"]).join("; ")}`);
  const sha = report.commit?.sha;
  if (!isSha(sha)) why.push("the report names no commit");
  else if (sha !== candidate && !sameTree(sha, candidate)) why.push(`the report is for ${sha.slice(0, 12)}, not ${candidate.slice(0, 12)} (and not the same tree)`);
  if (report.ok !== true) why.push(`the run did not pass: ${(report.problems ?? []).slice(0, 5).join("; ") || "ok is not true"}`);
  // Re-check the numbers the verdict rests on, not only the flag the signer wrote.
  if (report.totals?.failed) why.push(`${report.totals.failed} failed`);
  if (!(report.totals?.passed > 0)) why.push("0 tests passed");
  if (report.scope !== "full") why.push(`scope ${report.scope}, not the full suite`);
  const n = report.shards?.length ?? 0;
  const total = report.shards?.[0]?.shard?.total;
  if (!n || n !== total) why.push(`${n} of ${total ?? "?"} shards`);
  const ceiling = report.ceilingMinutes ?? SHARD_MINUTES;
  if (ceiling > SHARD_MINUTES) why.push(`a ceiling of ${ceiling} min is above ${SHARD_MINUTES}`);
  for (const s of report.shards ?? []) if (!(typeof s.minutes === "number" && s.minutes < SHARD_MINUTES)) why.push(`shard ${s.shard?.current}: ${s.minutes} min (the ceiling is ${SHARD_MINUTES})`);
  return { ok: why.length === 0, why };
}
