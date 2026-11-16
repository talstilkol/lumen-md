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
  // Plan 0.7: every ✅ / ✅* task's dod is run, so a ✅ whose dod went red blocks the receipt.
  // `withRunner`: with --runner the dod's vitest files go through that runner (gateCommand).
  { id: "dod-done", cmd: "node scripts/dod.mjs --done", withRunner: true },
];

/** A shell-quoted argument. */
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/**
 * The shell command of a command gate: its `cmd`, plus `--runner <runner>` when
 * the gate takes the offline runner (`withRunner`) and one was given.
 * @param {{ cmd: string, withRunner?: boolean }} g
 * @param {string|null} [runner]
 */
export function gateCommand(g, runner = null) {
  return g.withRunner && runner ? `${g.cmd} --runner ${shq(runner)}` : g.cmd;
}

/** Test files the receipt covers besides security/attacks and the OFFLINE_GATES. */
export const TEST_GATES = ["src/__tests__/skipAudit.test.ts", "src/__tests__/codeHealth.test.ts", "src/__tests__/settingsSchema.test.ts"];

export const RECEIPT_DIR = "reports";
export const RUNS_DIR = ".ci-local/runs";
export const receiptPath = (sha) => `${RECEIPT_DIR}/train-offline-${sha}.json`;

/**
 * The uncommitted files from `git status --porcelain -z` (not trimmed: the
 * first entry's leading space is part of its status), leaving out .ci-local/.
 * A rename or copy names its new path (the old one follows it and is skipped).
 * @param {string} out
 */
export function porcelainFiles(out) {
  const parts = String(out ?? "").split("\0");
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    files.push(e.slice(3));
    if (/^[RC]/.test(e)) i++;
  }
  return files.filter((f) => !f.startsWith(".ci-local/"));
}

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

/** The receipt classes: `full` is vitest itself (the Mac receipt); any --runner makes a `cloud` one. */
export const receiptClass = (runner) => (runner ? "cloud" : "full");

/**
 * The run record (always) and the receipt (only when green and clean): the same shape.
 * `dirty` is the list of uncommitted files (empty on a clean tree), so
 * `ci-doctor --source local` can leave a dirty run out of its comparisons;
 * `tree` is `HEAD^{tree}` and `runnerSha256` the hash of the --runner program,
 * so a receipt names the code and the runner it was made with (review 9, M1/M2).
 * @param {{ sha: string, tree?: string|null, branch?: string, results: any[], runner?: string|null, runnerSha256?: string|null, at: string, dirty: string[] }} run
 */
export function record({ sha, tree = null, branch = null, results, runner = null, runnerSha256 = null, at, dirty }) {
  return {
    kind: "train-offline",
    sha,
    tree,
    branch,
    at,
    runner: runner ?? "vitest",
    runnerSha256: runner ? runnerSha256 : null,
    class: receiptClass(runner),
    dirty: dirty.slice(0, 50),
    green: allGreen(results) && !dirty.length,
    gates: results,
  };
}

/**
 * The exact gate ids a receipt for this checkout must hold: every command gate,
 * then the test files (the attack files, the OFFLINE_GATES and TEST_GATES that
 * exist), in order.
 * @param {string[]} testFiles
 */
export const expectedGates = (testFiles) => [...COMMAND_GATES.map((g) => g.id), ...testFiles];

const isHex = (s, n) => new RegExp(`^[0-9a-f]{${n}}$`).test(String(s ?? ""));

/**
 * Checks a receipt read back from reports/ (review 9, M1): it names the commit
 * it is filed under, it is green, it holds exactly the expected gates (at least
 * one attack file among them), all passed, and it records the tree and the
 * runner it was made with. A receipt made through a --runner is `cloud` class:
 * it can never stand in for the Mac (vitest) receipt (`requireFull`).
 * @param {any} receipt
 * @param {string} fileSha
 * @param {{ expected?: string[], tree?: string|null, runnerSha256?: string|null, requireFull?: boolean }} [want]
 *   `expected`: expectedGates() of the checkout; `tree`: `git rev-parse <sha>^{tree}`;
 *   `runnerSha256`: the hash of the receipt's runner as it is now (null when it can't be read)
 * @returns {string[]} problems (empty = valid)
 */
export function receiptProblems(receipt, fileSha, want = {}) {
  const out = [];
  if (!receipt || receipt.kind !== "train-offline") return ["not a train-offline receipt"];
  if (receipt.sha !== fileSha) out.push(`names ${receipt.sha} but is filed as ${fileSha}`);
  if (!receipt.green) out.push("not green");
  if (!Array.isArray(receipt.dirty) || receipt.dirty.length) out.push("made on a dirty tree (or the tree state is not recorded)");
  const gates = Array.isArray(receipt.gates) ? receipt.gates : [];
  const red = gates.filter((g) => g.status !== "pass");
  if (!gates.length) out.push("no gates");
  if (red.length) out.push(`${red.length} gate(s) not passed: ${red.map((g) => g.id).join(", ")}`);
  const ids = gates.map((g) => g.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) out.push(`gate(s) listed twice: ${[...new Set(dup)].join(", ")}`);
  if (!ids.some((id) => String(id).startsWith("security/attacks/"))) out.push("no attack gate (security/attacks/*.test.ts): a receipt needs at least one");
  if (want.expected) {
    const missing = want.expected.filter((id) => !ids.includes(id));
    const extra = ids.filter((id) => !want.expected.includes(id));
    if (missing.length) out.push(`missing gate(s): ${missing.join(", ")}`);
    if (extra.length) out.push(`unexpected gate(s): ${extra.join(", ")}`);
  }
  if (!isHex(receipt.tree, 40)) out.push("no tree hash (HEAD^{tree})");
  else if (want.tree !== undefined && receipt.tree !== want.tree) out.push(`tree ${receipt.tree} is not the commit's tree ${want.tree ?? "(unknown)"}`);
  const full = receipt.runner === "vitest";
  if (receipt.class !== receiptClass(full ? null : receipt.runner)) out.push(`class "${receipt.class}" does not match runner ${receipt.runner}: a --runner receipt is cloud class`);
  if (!full) {
    if (!isHex(receipt.runnerSha256, 64)) out.push(`no sha256 of the runner ${receipt.runner}`);
    else if (want.runnerSha256 !== undefined && receipt.runnerSha256 !== want.runnerSha256) out.push(`runner ${receipt.runner} hashes to ${want.runnerSha256 ?? "(not readable here)"}, not the receipt's ${receipt.runnerSha256}`);
  }
  if (want.requireFull && (!full || receipt.class !== "full")) out.push(`a cloud-class receipt (runner ${receipt.runner}) can never stand in for the Mac (vitest) receipt`);
  return out;
}
