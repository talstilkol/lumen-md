/**
 * The receipt body of a Buildkite build (plan W7.21; sealed by scripts/nightly/receipt.mjs, written by
 * ./receipt.mjs), and the marker a gate leaves when the policy did not ask it to run (review Z6-L2). Split out of
 * ./lib.mjs, which re-exports all of it.
 */

/**
 * Review Z6-L2: a gate that exits 0 without running, because the policy did not ask for it (Percy off main and
 * without the label), says so in build meta-data under this key; the receipt then records the outcome
 * SKIPPED_BY_POLICY with the reason. Only the gates in POLICY_SKIPPABLE may: a marker on any other gate is ignored.
 */
export const POLICY_SKIP_KEY = (gate) => `lumen:skipped:${gate}`;
export const SKIPPED_BY_POLICY = "skipped-by-policy";
export const POLICY_SKIPPABLE = new Set(["percy"]);

/**
 * Every gate's outcome, as `buildkite-agent` (`agent(args)` → { status, stdout }) reports it. An unknown or
 * unreadable outcome is recorded as such and never counted as a pass. Z6-L2: a POLICY_SKIPPABLE gate that passed
 * and left its POLICY_SKIP_KEY marker is recorded as SKIPPED_BY_POLICY, with the marker's reason in `skips`.
 * @param {string[]} gates
 * @param {(args: string[]) => { status: number | null, stdout: string }} agent
 */
export function collectOutcomes(gates, agent) {
  const outcomes = {};
  const skips = {};
  for (const key of gates) {
    const r = agent(["step", "get", "outcome", "--step", key]);
    outcomes[key] = r.status === 0 ? r.stdout.trim() || "unknown" : "unknown";
    if (outcomes[key] !== "passed" || !POLICY_SKIPPABLE.has(key)) continue;
    const m = agent(["meta-data", "get", POLICY_SKIP_KEY(key), "--default", ""]);
    if (m.status === 0 && m.stdout.trim()) {
      outcomes[key] = SKIPPED_BY_POLICY;
      skips[key] = m.stdout.trim().slice(0, 200);
    }
  }
  return { outcomes, skips };
}

/** `buildkite-agent step get outcome` values that count as a pass. */
export const PASSED = new Set(["passed"]);

/**
 * The receipt body (sealed by scripts/nightly/receipt.mjs). kind "full" with
 * the factory's suite names (build, vitest, "e2e <browser>"), so W6.7's
 * plan:receipts (#511) credits a Buildkite run like a factory night; every
 * other gate is a suite of its own.
 */
export function receiptReport({ commit, build, outcomes, vitest = null, machine, startedAt, finishedAt, skips = {} }) {
  const suites = {};
  const g = (k) => outcomes[k] ?? "missing";
  const ok = (k) => PASSED.has(g(k));
  if ("build" in outcomes) suites.build = { ok: ok("build"), detail: `build + secrets + budget: ${g("build")}` };
  if ("vitest" in outcomes || "vitest-merge" in outcomes)
    suites.vitest = {
      ok: ok("vitest") && ok("vitest-merge") && (vitest ? vitest.ok : false),
      detail: vitest ? `${vitest.tests - vitest.failed}/${vitest.tests} tests in ${vitest.files} files; shard spread ${Math.round(vitest.spread * 100)}%${vitest.problems?.length ? `; ${vitest.problems.join("; ")}` : ""}` : `shards ${g("vitest")}, merge ${g("vitest-merge")}, no summary`,
    };
  for (const b of ["chromium", "firefox", "webkit"]) if (`e2e-${b}` in outcomes) suites[`e2e ${b}`] = { ok: ok(`e2e-${b}`), detail: g(`e2e-${b}`) };
  for (const [k, v] of Object.entries(outcomes)) {
    if (["build", "vitest", "vitest-merge"].includes(k) || /^e2e-(chromium|firefox|webkit)$/.test(k)) continue;
    // A policy skip does not fail the receipt, and is never shown as a pass: `skipped` says it did not run.
    if (v === SKIPPED_BY_POLICY && POLICY_SKIPPABLE.has(k)) suites[k] = { ok: true, skipped: true, detail: `skipped by policy: ${skips[k] ?? "not asked for"}` };
    else suites[k] = { ok: PASSED.has(v), detail: v };
  }
  return {
    version: 1,
    kind: "full",
    trigger: "buildkite",
    startedAt,
    finishedAt,
    minutes: startedAt && finishedAt ? Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 6000) / 10 : null,
    commit,
    build,
    machine,
    outcomes,
    suites,
    mustRun: vitest?.mustRun ?? [],
    shards: vitest ? { ms: vitest.shardMs, spread: vitest.spread } : null,
  };
}
