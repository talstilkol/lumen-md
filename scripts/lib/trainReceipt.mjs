/**
 * Plan W10.A14: the offline train's receipt. One command (`npm run
 * train:offline -- --all`) runs every offline gate on the checked-out commit;
 * when all of them are green and the tree is clean it writes
 * reports/train-offline-<sha>.json, and when any is red it writes no receipt.
 * Every run, green or red, also leaves a run record in .ci-local/runs/ (not
 * committed) that `ci-doctor --source local` reads (plan 0.9).
 *
 * Pure functions; scripts/train-offline.mjs does the I/O.
 */

/**
 * The command gates, in order. `failFast`: when it is red nothing after it runs
 * (a broken import makes every later gate meaningless, and it is red in
 * seconds). The test-file gates (attack suites, vizGate, TEST_GATES) run after
 * these, through vitest or the --runner.
 */
export const COMMAND_GATES = [
  { id: "imports", cmd: "node scripts/check-imports.mjs", failFast: true },
  { id: "typecheck", cmd: "npx tsc -b --noEmit" },
  { id: "code-hygiene", cmd: "node scripts/check-code-hygiene.mjs" },
  { id: "max-lines", cmd: "node scripts/check-max-lines.mjs" },
  { id: "audit-lock", cmd: "node scripts/audit-lock.mjs" },
  { id: "live-seams", cmd: "node scripts/check-live-seams.mjs" },
  { id: "no-workflows", cmd: "node scripts/check-no-workflows.mjs" },
  { id: "flags", cmd: "node scripts/check-flags.mjs" },
  { id: "i18n", cmd: "npm run -s i18n:check" },
  { id: "plan", cmd: "node scripts/plan/build.mjs --check" },
  { id: "dod-rule", cmd: "node scripts/dod.mjs --list" },
];

/** Test files the receipt covers besides security/attacks and the OFFLINE_GATES. */
export const TEST_GATES = ["src/__tests__/skipAudit.test.ts", "src/__tests__/codeHealth.test.ts", "src/__tests__/settingsSchema.test.ts"];

export const RECEIPT_DIR = "reports";
export const RUNS_DIR = ".ci-local/runs";
export const receiptPath = (sha) => `${RECEIPT_DIR}/train-offline-${sha}.json`;

/** A full 40-hex commit hash. */
export const isSha = (s) => /^[0-9a-f]{40}$/.test(String(s ?? ""));

/**
 * Runs the gates in order through `exec(gate) → { ok, ms, detail? }`.
 * A red fail-fast gate stops the run; the gates after it are "skip".
 * @param {{ id: string, failFast?: boolean }[]} gates
 * @param {(g: any) => { ok: boolean, ms?: number, detail?: string }} exec
 */
export function runGates(gates, exec) {
  const results = [];
  let stopped = null;
  for (const g of gates) {
    if (stopped) {
      results.push({ id: g.id, status: "skip", detail: `not run: ${stopped} failed first` });
      continue;
    }
    const r = exec(g);
    results.push({ id: g.id, status: r.ok ? "pass" : "fail", ms: r.ms ?? 0, ...(r.detail ? { detail: r.detail } : {}) });
    if (!r.ok && g.failFast) stopped = g.id;
  }
  return results;
}

/** Green: at least one gate ran, and every gate passed (a skipped gate is not a pass). */
export const allGreen = (results) => results.length > 0 && results.every((r) => r.status === "pass");

/**
 * Why no receipt may be written for this run, or null when one may.
 * @param {{ results: any[], sha: string, dirty: string[] }} run
 */
export function refusal({ results, sha, dirty }) {
  if (!isSha(sha)) return `no commit hash (${sha || "none"})`;
  if (dirty.length) return `the tree has ${dirty.length} uncommitted change(s) (${dirty.slice(0, 3).join(", ")}${dirty.length > 3 ? " …" : ""}): a receipt for ${sha.slice(0, 10)} would not describe this code`;
  const red = results.filter((r) => r.status !== "pass");
  if (!results.length) return "no gate ran";
  if (red.length) return `${red.length} gate(s) not green: ${red.map((r) => `${r.id} (${r.status})`).join(", ")}`;
  return null;
}

/**
 * The run record (always) and the receipt (only when green and clean): the same shape.
 * @param {{ sha: string, branch?: string, results: any[], runner?: string|null, at: string, dirty: string[] }} run
 */
export function record({ sha, branch = null, results, runner = null, at, dirty }) {
  return {
    kind: "train-offline",
    sha,
    branch,
    at,
    runner: runner ?? "vitest",
    green: allGreen(results) && !dirty.length,
    gates: results,
  };
}

/**
 * Checks a receipt read back from reports/: its hash is the commit it is named
 * after, it is green, and every gate in it passed.
 * @returns {string[]} problems (empty = valid)
 */
export function receiptProblems(receipt, fileSha) {
  const out = [];
  if (!receipt || receipt.kind !== "train-offline") return ["not a train-offline receipt"];
  if (receipt.sha !== fileSha) out.push(`names ${receipt.sha} but is filed as ${fileSha}`);
  if (!receipt.green) out.push("not green");
  const red = (receipt.gates ?? []).filter((g) => g.status !== "pass");
  if (!(receipt.gates ?? []).length) out.push("no gates");
  if (red.length) out.push(`${red.length} gate(s) not passed: ${red.map((g) => g.id).join(", ")}`);
  return out;
}
