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
 *   Without --runner the test files go through vitest's JSON reporter, one
 *   gate per file, each needing a passed test (review 9, M5). No attack file →
 *   a red "attacks" gate (L2). The receipt records HEAD^{tree}, the dirty
 *   list, the runner and its sha256; a --runner receipt is "cloud" class (M1).
 *   Before it is written the receipt is checked (receiptProblems) against the
 *   exact gate list of this checkout.
 *
 *   node scripts/train-offline.mjs --verify [<sha>] [--require-full] [--root <dir>]
 *       checks reports/train-offline-<sha>.json (default HEAD) against this
 *       checkout: the exact gates, the tree, the runner's hash; --require-full
 *       refuses a cloud-class receipt (it never stands in for the Mac one).
 *
 * A receipt is self-asserted: it records what the machine that ran the train
 * says it ran, and nothing signs it until the owner's signing key exists
 * (owed). The runner's hash covers the runner and the helper scripts it runs
 * from its own folder (review 10, L9), not the node_modules it loads.
 *
 * Exit 1 when any attack or gate test fails, or when there is none to run.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMAND_GATES, RUNS_DIR, TEST_GATES, expectedGates, gateCommand, porcelainFiles, receiptPath, receiptProblems, record, refusal, runGates } from "./lib/trainReceipt.mjs";
import { jsonCounts, vitestJsonArgs } from "./lib/dodRunner.mjs";

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

/** Every test file the receipt covers in this checkout: attack files, OFFLINE_GATES, TEST_GATES (in that order). */
export function receiptTestFiles(root) {
  return [...gateFiles(root), ...TEST_GATES.filter((f) => existsSync(join(root, f)))];
}

/**
 * The test-file gates, one per file: through the runner (its last "pass N fail
 * M" line), or through one vitest run with the JSON reporter (each file needs
 * a passed test and no failure: a file whose every test skipped is not green).
 * With no attack file at all, a red "attacks" gate comes first (review 9, L2).
 * @param {string} root
 * @param {string[]} files
 * @param {string|null} runner
 * @param {typeof spawnSync} [spawn]
 */
export function testGates(root, files, runner, spawn = spawnSync) {
  const guard = attackFiles(root).length ? [] : [{ id: "attacks", run: () => ({ ok: false, detail: `no attack test in ${ATTACK_DIR}: a receipt needs at least one` }) }];
  if (!runner) {
    let byFile = null;
    const vitest = () => {
      if (byFile) return byFile;
      const dir = mkdtempSync(join(tmpdir(), "train-offline-"));
      try {
        const out = join(dir, "vitest.json");
        spawn(process.platform === "win32" ? "npx.cmd" : "npx", vitestJsonArgs(files, out), { cwd: root, stdio: "inherit" });
        let json = null;
        try {
          json = JSON.parse(readFileSync(out, "utf8"));
        } catch {}
        byFile = jsonCounts(json, root);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      return byFile;
    };
    return [
      ...guard,
      ...files.map((f) => ({
        id: f,
        run: () => {
          const c = vitest().get(f) ?? null;
          return { ok: green(c), detail: c ? `pass ${c.pass} fail ${c.fail}` : "no result in vitest's JSON report" };
        },
      })),
    ];
  }
  return [
    ...guard,
    ...files.map((f) => ({
      id: f,
      run: () => {
        const r = spawn(runner, [root, f], { encoding: "utf8" });
        const c = parseCounts(`${r.stdout}\n${r.stderr}`);
        return { ok: green(c), detail: c ? `pass ${c.pass} fail ${c.fail}` : "no result" };
      },
    })),
  ];
}

/** The program a --runner names (a path, or a name on PATH), or null. */
export function runnerFile(runner, root = process.cwd()) {
  if (!runner) return null;
  const isFile = (p) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  };
  if (runner.includes("/") || runner.includes("\\")) return isFile(resolve(root, runner)) ? resolve(root, runner) : null;
  for (const d of (process.env.PATH ?? "").split(delimiter)) if (d && isFile(join(d, runner))) return join(d, runner);
  return null;
}

/** Files a runner reaches that are hashed with it: at most this many. */
const MAX_RUNNER_FILES = 500;

/**
 * Review 10, L9: the files a --runner runs besides itself, inside its own
 * folder: what a shell runner names under `$here/…` or `$(dirname "$0")/…`,
 * and what those scripts import or load by a relative path (`./x.mjs`,
 * `../lib/y.js`), followed transitively. Sorted, relative to the runner's
 * folder; the runner itself is not in the list.
 * @param {string} file  the runner's resolved path
 */
export function runnerHelpers(file) {
  const base = dirname(file);
  const seen = new Set([file]);
  const todo = [file];
  const inside = (p) => p.startsWith(base + sep);
  while (todo.length && seen.size <= MAX_RUNNER_FILES) {
    const f = todo.pop();
    let text;
    try {
      // A program, not a script (node itself on PATH): nothing to follow.
      if (statSync(f).size > 2 * 1024 * 1024) continue;
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const refs = [];
    for (const m of text.matchAll(/(?:\$\{?here\}?|\$\(dirname "?\$0"?\))\/([\w./-]+)/g)) refs.push(resolve(base, m[1]));
    if (/\.[cm]?[jt]s$/.test(f)) for (const m of text.matchAll(/["'`](\.\.?\/[^"'`\s$]+)["'`]/g)) refs.push(resolve(dirname(f), m[1]));
    for (const r of refs) {
      if (seen.has(r) || !inside(r)) continue;
      try {
        if (!statSync(r).isFile()) continue;
      } catch {
        continue;
      }
      seen.add(r);
      todo.push(r);
    }
  }
  seen.delete(file);
  return [...seen].map((p) => relative(base, p).split(sep).join("/")).sort();
}

/**
 * The sha256 of the --runner program, or null when it can't be read. A runner
 * that runs helper scripts of its own (runnerHelpers) is hashed with them: the
 * sha256 of "runner-files-v1", then one "<path>\t<sha256>" line per file, the
 * runner first (review 10, L9: hashing v4.sh alone left the shim's own code
 * free to change under the same receipt). A runner with no helpers keeps the
 * plain sha256 of its bytes.
 *
 * Like the whole receipt, this is self-asserted: whoever runs the train writes
 * it, and nothing signs it yet (owed: the owner's signing key).
 */
export function runnerSha256(runner, root = process.cwd()) {
  const f = runnerFile(runner, root);
  if (!f) return null;
  const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
  try {
    const helpers = runnerHelpers(f);
    if (!helpers.length) return sha(f);
    const lines = [`${basename(f)}\t${sha(f)}`, ...helpers.map((h) => `${h}\t${sha(join(dirname(f), h))}`)];
    return createHash("sha256").update(`runner-files-v1\n${lines.join("\n")}\n`).digest("hex");
  } catch {
    return null;
  }
}

/** What a receipt for `sha` in `root` must match: receiptProblems' `want`. */
function wantFor(root, sha, receipt, requireFull = false) {
  const tree = git(root, "rev-parse", `${sha}^{tree}`) || null;
  return { expected: expectedGates(receiptTestFiles(root)), tree, ...(receipt?.runner && receipt.runner !== "vitest" ? { runnerSha256: runnerSha256(receipt.runner, root) } : {}), requireFull };
}

/** --verify: a receipt read back from reports/ against this checkout (review 9, M1). */
function verify(root, argv) {
  const head = git(root, "rev-parse", "HEAD");
  const sha = argv.find((a, i) => /^[0-9a-f]{40}$/.test(a) && argv[i - 1] !== "--root") ?? head;
  if (sha !== head) {
    console.error(`✗ train-offline --verify: check out ${sha} first (HEAD is ${head || "none"}): the gate list is read from the checkout`);
    return 1;
  }
  const file = join(root, receiptPath(sha));
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    console.error(`✗ train-offline --verify: no readable receipt ${receiptPath(sha)}`);
    return 1;
  }
  const problems = receiptProblems(receipt, sha, wantFor(root, sha, receipt, argv.includes("--require-full")));
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.log(problems.length ? `✗ train-offline --verify: ${receiptPath(sha)} — ${problems.length} problem(s)` : `✓ train-offline --verify: ${receiptPath(sha)} (${receipt.class} class, ${receipt.gates.length} gates)`);
  return problems.length ? 1 : 0;
}

/** W10.A14: every offline gate; a receipt only when all are green on a clean tree. */
function all(root, argv) {
  const only = (opt(argv, "--only") ?? "").split(",").filter(Boolean);
  const runner = opt(argv, "--runner");
  const sha = git(root, "rev-parse", "HEAD");
  const st = spawnSync("git", ["status", "--porcelain", "-z"], { cwd: root, encoding: "utf8" });
  // review 9: not trimmed (a trimmed first line lost a character of its path); a failed status is dirty.
  const dirty = st.status === 0 ? porcelainFiles(st.stdout) : ["(git status failed)"];
  const commands = only.length ? COMMAND_GATES.filter((g) => only.includes(g.id)) : COMMAND_GATES;
  const tests = only.length ? [] : testGates(root, receiptTestFiles(root), runner);
  const results = runGates([...commands, ...tests], (g) => {
    const t0 = Date.now();
    const cmd = g.cmd ? gateCommand(g, runner) : null;
    console.log(`\n▶ ${g.id}${cmd ? `: ${cmd}` : ""}`);
    const r = cmd ? { ok: spawnSync(cmd, { cwd: root, shell: true, stdio: "inherit" }).status === 0 } : g.run();
    const out = typeof r === "boolean" ? { ok: r } : r;
    return { ...out, ms: Date.now() - t0 };
  });
  const rec = record({ sha, tree: git(root, "rev-parse", "HEAD^{tree}") || null, branch: git(root, "rev-parse", "--abbrev-ref", "HEAD") || null, results, runner, runnerSha256: runnerSha256(runner, root), at: new Date().toISOString(), dirty });
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
  // The receipt is checked as a reader will check it, before it is written (review 9, M1).
  const problems = receiptProblems(rec, sha, wantFor(root, sha, rec));
  if (problems.length) {
    console.error(`✗ train-offline: no receipt — it would not verify: ${problems.join("; ")}`);
    return 1;
  }
  mkdirSync(join(root, "reports"), { recursive: true });
  writeFileSync(join(root, receiptPath(sha)), `${JSON.stringify(rec, null, 2)}\n`);
  console.log(`✓ train-offline: ${results.length} gates green; receipt ${receiptPath(sha)} (${rec.class} class${rec.class === "cloud" ? ": never a stand-in for the Mac receipt" : ""})`);
  return 0;
}

function main(argv) {
  const root = resolve(opt(argv, "--root") ?? process.cwd());
  if (argv.includes("--verify")) return verify(root, argv);
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
  // Each file is its own result, through the runner or vitest's JSON reporter: a
  // file whose every test skipped is not green (review 9, M5).
  let bad = 0;
  for (const g of testGates(root, files, opt(argv, "--runner"))) {
    const r = g.run();
    if (!r.ok) bad++;
    console.log(`${r.ok ? "✓" : "✗"} ${g.id}: ${r.detail}`);
  }
  console.log(`train-offline: ${files.length - bad}/${files.length} attack and gate files green`);
  return bad ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
