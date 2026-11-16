/**
 * Plan 0.9 on the CI that runs now: GitHub Actions are retired, and the gates
 * run on this machine (`npm run ci:local`, `npm run train:offline -- --all`).
 * `ci-doctor --source local` reads their run records (.ci-local/runs/*.json)
 * and receipts (reports/train-offline-<sha>.json, written only when green) and
 * says, for each red gate of a run, whether it is real or a flake:
 *
 *   real    a command gate (imports, typecheck, hygiene, plan…) depends only
 *           on the code; or a test file failed in every run at similar commits
 *   flaky   the same commit passed it in another run, or it both passes and
 *           fails at similar commits
 *   flake?  passed at similar commits, fails only in this run
 *   unknown no other run of it at a similar commit
 *
 * Pure functions; scripts/ci-doctor.mjs reads the files and asks git for distances.
 */
import { classify } from "./ci-doctor.mjs";
import { COMMAND_GATES } from "./trainReceipt.mjs";

const COMMAND = new Map(COMMAND_GATES.map((g) => [g.id, g.cmd]));

/**
 * Normalises run records and receipts (train-offline's shape, and ci:local's
 * `{ kind: "ci-local", sha, at, steps: [{ id, status }] }`) to
 * `{ sha, at, kind, file, gates: [{ id, status }] }`; anything else is dropped.
 * @param {{ file: string, json: any }[]} docs
 */
export function localRuns(docs) {
  const out = [];
  for (const { file, json } of docs) {
    if (!json || typeof json.sha !== "string" || !json.sha) continue;
    const gates = Array.isArray(json.gates) ? json.gates : Array.isArray(json.steps) ? json.steps : null;
    if (!gates) continue;
    out.push({
      sha: json.sha,
      at: String(json.at ?? ""),
      kind: json.kind ?? "run",
      file,
      gates: gates.filter((g) => g && g.id).map((g) => ({ id: String(g.id), status: g.status === "pass" ? "pass" : g.status === "fail" ? "fail" : "skip" })),
    });
  }
  // A receipt and the run record it was written from are one run.
  const seen = new Set();
  return out
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .filter((r) => {
      const key = `${r.sha}@${r.at}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** The run to diagnose: the newest one at `sha` (any prefix), else the newest of all. */
export function pickRun(runs, sha = null) {
  const at = sha ? runs.filter((r) => r.sha.startsWith(sha)) : runs;
  return at[0] ?? null;
}

const isTestGate = (id) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(id) || id === "vitest";

/**
 * Diagnoses every red gate of `run` against the other runs.
 * @param {any} run
 * @param {any[]} runs
 * @param {{ distance?: (a: string, b: string) => number|null, maxDistance?: number, runner?: string }} [opts]
 */
export function diagnoseLocal(run, runs, opts = {}) {
  const { distance = () => null, maxDistance = 30 } = opts;
  const others = runs.filter((r) => r !== run && !(r.sha === run.sha && r.at === run.at));
  return run.gates
    .filter((g) => g.status === "fail")
    .map((g) => {
      const observations = others
        .map((o) => {
          const peer = o.gates.find((x) => x.id === g.id);
          if (!peer || peer.status === "skip") return null;
          const sameSha = o.sha === run.sha;
          return { outcome: peer.status === "pass" ? "passed" : "failed", sameSha, distance: sameSha ? 0 : distance(run.sha, o.sha), branch: `${o.sha.slice(0, 10)} ${o.at}` };
        })
        .filter(Boolean);
      const test = isTestGate(g.id);
      const c = test ? classify({ kind: "test", path: g.id }, observations, { maxDistance }) : commandVerdict(observations, maxDistance);
      return { gate: g.id, kind: test ? "test" : "command", ...c, next: nextLocal(g.id, c.verdict, opts.runner) };
    });
}

/** A command gate reads only the checkout: its red is the code's, compared or not. */
function commandVerdict(observations, maxDistance) {
  const near = observations.filter((o) => o.sameSha || (o.distance != null && o.distance <= maxDistance));
  const passed = near.filter((o) => o.outcome === "passed");
  const failed = near.filter((o) => o.outcome === "failed");
  const res = (why) => ({ verdict: "real", why, passed: passed.length, failed: failed.length, flaky: 0 });
  if (passed.some((o) => o.sameSha)) return { verdict: "flaky", why: "a code-only gate passed on this same commit in another run: the environment differs (an install, a missing tool)", passed: passed.length, failed: failed.length, flaky: 0 };
  if (!near.length) return res("code-only gate — it fails on this commit's code (no run at a similar commit to compare with)");
  if (passed.length && !failed.length) return res(`code-only gate — passes at ${passed.map((o) => o.branch).slice(0, 3).join(", ")}: this change broke it`);
  if (failed.length && !passed.length) return res(`code-only gate — fails at ${failed.length} similar commit(s) too: broken in a shared base`);
  return res(`code-only gate — fails at ${failed.length}, passes at ${passed.length} similar commits: compare those diffs`);
}

/** What to run next, here. */
export function nextLocal(gate, verdict, runner) {
  const repro = isTestGate(gate)
    ? gate === "vitest"
      ? "npm run train:offline -- --all --runner <shim> (one result per file)"
      : runner
        ? `${runner} . ${gate}`
        : `npx vitest run ${gate}`
    : (COMMAND.get(gate) ?? `the ${gate} step of npm run ci:local`);
  if (verdict === "flaky") return `timing- or environment-dependent: run it again (${repro}); then fix the wait or the missing tool, never by a retry`;
  if (verdict === "flake?") return `run it once more: ${repro}; if it fails again it is real`;
  if (verdict === "real") return `reproduce and fix: ${repro}`;
  return `no comparison: reproduce with ${repro}`;
}

/** The text report. */
export function formatLocal(run, items) {
  const lines = [`ci-doctor (local): ${run.kind} at ${run.sha.slice(0, 10)} (${run.at || "no time"}), ${run.file}`];
  if (!items.length) {
    lines.push(run.gates.length ? `  no red gate (${run.gates.length} gates)` : "  the run has no gates");
    return lines.join("\n");
  }
  for (const it of items) {
    lines.push(`  ${it.verdict.toUpperCase().padEnd(7)} ${it.gate} — ${it.why}`);
    lines.push(`          → ${it.next}`);
  }
  return lines.join("\n");
}
