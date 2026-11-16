#!/usr/bin/env node
/**
 * The train's offline gate (plan W6.4, W10.D6): every crypto attack test in
 * security/attacks must pass. Each test asserts the secure outcome, so a
 * failure means an attack worked.
 *
 *   node scripts/train-offline.mjs                 vitest run security/attacks
 *   node scripts/train-offline.mjs --runner <cmd>  <cmd> <worktree> <file> per file
 *                                                  (an offline runner such as the
 *                                                  shim; its last line must be
 *                                                  "… pass N fail 0")
 *   node scripts/train-offline.mjs --list          the files, one per line
 *
 * Plan W12.V7: the visualisation gate (every wave-12 view: an alternative
 * with the view's data, the keyboard, axe, no network) runs here too.
 *
 * Plan W10.A14: every offline gate, and a receipt for the commit.
 *   node scripts/train-offline.mjs --all [--runner <cmd>]
 *       the command gates (scripts/lib/trainReceipt.mjs COMMAND_GATES: imports
 *       first and fail-fast, typecheck, hygiene's checks, flags, i18n, plan,
 *       the dod rule, every ✅ task's dod (plan 0.7; through the --runner when
 *       one is given)), then the attack and gate test files and TEST_GATES.
 *       All green on a clean tree → reports/train-offline-<HEAD sha>.json;
 *       anything red (or a dirty tree) → no receipt, exit 1. Every run leaves
 *       a record in .ci-local/runs/ for `ci-doctor --source local` (plan 0.9).
 *   --only <id,…>   just these command gates (no test files, never a receipt)
 *   --root <dir>    run in another checkout
 *
 * Exit 1 when any attack or gate test fails, or when there is none to run.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMAND_GATES, RUNS_DIR, TEST_GATES, gateCommand, receiptPath, record, refusal, runGates } from "./lib/trainReceipt.mjs";

export const ATTACK_DIR = "security/attacks";

/** The attack test files, relative to `root`, sorted. */
export function attackFiles(root = process.cwd()) {
  if (!existsSync(join(root, ATTACK_DIR))) return [];
  return readdirSync(join(root, ATTACK_DIR))
    .filter((f) => f.endsWith(".test.ts"))
    .sort()
    .map((f) => `${ATTACK_DIR}/${f}`);
}

/** Gate test files outside security/attacks that the offline train runs as well (W12.V7). */
export const OFFLINE_GATES = ["src/__tests__/vizGate.test.tsx"];

/** Everything the offline train runs: the attack files, then the gates that exist in this checkout. */
export function gateFiles(root = process.cwd()) {
  return [...attackFiles(root), ...OFFLINE_GATES.filter((f) => existsSync(join(root, f)))];
}

/** Pass/fail counts from a runner's last "pass N fail M" line, or null. */
export function parseCounts(out) {
  const lines = String(out).trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /pass (\d+) fail (\d+)/.exec(lines[i]);
    if (m) return { pass: Number(m[1]), fail: Number(m[2]) };
  }
  return null;
}

/** Whether one file's run is green: at least one test passed and none failed. */
export function green(counts) {
  return !!counts && counts.pass > 0 && counts.fail === 0;
}

const opt = (argv, name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const git = (root, ...args) => {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
};

/** One test file through the runner (its last "pass N fail M" line), or all of them through vitest. */
function testGates(root, files, runner) {
  if (!runner) return [{ id: "vitest", files, run: () => spawnSync("npx", ["vitest", "run", ...files], { cwd: root, stdio: "inherit" }).status === 0 }];
  return files.map((f) => ({
    id: f,
    run: () => {
      const r = spawnSync(runner, [root, f], { encoding: "utf8" });
      const c = parseCounts(`${r.stdout}\n${r.stderr}`);
      return { ok: green(c), detail: c ? `pass ${c.pass} fail ${c.fail}` : "no result" };
    },
  }));
}

/** W10.A14: every offline gate; a receipt only when all are green on a clean tree. */
function all(root, argv) {
  const only = (opt(argv, "--only") ?? "").split(",").filter(Boolean);
  const runner = opt(argv, "--runner");
  const sha = git(root, "rev-parse", "HEAD");
  const dirty = git(root, "status", "--porcelain").split("\n").filter(Boolean).map((l) => l.slice(3)).filter((f) => !f.startsWith(".ci-local/"));
  const commands = only.length ? COMMAND_GATES.filter((g) => only.includes(g.id)) : COMMAND_GATES;
  const tests = only.length ? [] : testGates(root, [...gateFiles(root), ...TEST_GATES.filter((f) => existsSync(join(root, f)))], runner);
  const results = runGates([...commands, ...tests], (g) => {
    const t0 = Date.now();
    const cmd = g.cmd ? gateCommand(g, runner) : null;
    console.log(`\n▶ ${g.id}${cmd ? `: ${cmd}` : ""}`);
    const r = cmd ? { ok: spawnSync(cmd, { cwd: root, shell: true, stdio: "inherit" }).status === 0 } : g.run();
    const out = typeof r === "boolean" ? { ok: r } : r;
    return { ...out, ms: Date.now() - t0 };
  });
  const rec = record({ sha, branch: git(root, "rev-parse", "--abbrev-ref", "HEAD") || null, results, runner, at: new Date().toISOString(), dirty });
  mkdirSync(join(root, RUNS_DIR), { recursive: true });
  writeFileSync(join(root, RUNS_DIR, `${sha || "nosha"}-${Date.now()}.json`), `${JSON.stringify(rec, null, 2)}\n`);
  console.log("");
  for (const r of results) console.log(`${r.status === "pass" ? "✓" : r.status === "skip" ? "–" : "✗"} ${r.id}${r.detail ? `: ${r.detail}` : ""}${r.ms ? ` (${(r.ms / 1000).toFixed(1)} s)` : ""}`);
  if (only.length) {
    const ok = results.length > 0 && results.every((r) => r.status === "pass");
    console.log(`train-offline --only: ${ok ? "green" : "red"}; a subset never writes a receipt`);
    return ok ? 0 : 1;
  }
  const why = refusal({ results, sha, dirty });
  if (why) {
    console.error(`✗ train-offline: no receipt — ${why}`);
    return 1;
  }
  mkdirSync(join(root, "reports"), { recursive: true });
  writeFileSync(join(root, receiptPath(sha)), `${JSON.stringify(rec, null, 2)}\n`);
  console.log(`✓ train-offline: ${results.length} gates green; receipt ${receiptPath(sha)}`);
  return 0;
}

function main(argv) {
  const root = resolve(opt(argv, "--root") ?? process.cwd());
  if (argv.includes("--all") || argv.includes("--only")) return all(root, argv);
  const files = gateFiles(root);
  if (argv.includes("--list")) {
    console.log(files.join("\n"));
    return 0;
  }
  if (files.length === 0) {
    console.error(`✗ train-offline: no attack tests in ${ATTACK_DIR}`);
    return 1;
  }
  const i = argv.indexOf("--runner");
  if (i < 0) {
    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    const r = spawnSync(npx, ["vitest", "run", ATTACK_DIR, ...files.filter((f) => !f.startsWith(`${ATTACK_DIR}/`))], { stdio: "inherit" });
    return r.status ?? 1;
  }
  const runner = argv[i + 1];
  let bad = 0;
  for (const f of files) {
    const r = spawnSync(runner, [root, f], { encoding: "utf8" });
    const c = parseCounts(`${r.stdout}\n${r.stderr}`);
    const ok = green(c);
    if (!ok) bad++;
    console.log(`${ok ? "✓" : "✗"} ${f}: ${c ? `pass ${c.pass} fail ${c.fail}` : "no result"}`);
  }
  console.log(`train-offline: ${files.length - bad}/${files.length} attack and gate files green`);
  return bad ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
