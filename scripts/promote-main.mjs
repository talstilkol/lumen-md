#!/usr/bin/env node
/**
 * npm run promote:main -- <rev> [--push] (plan W4.2, W10.E39): main moves
 * only to a commit whose whole e2e suite passed, on that same hash.
 *
 * It accepts the candidate only with reports/e2e-<sha>.json (the sealed
 * report of the `e2e-receipt` Buildkite step, scripts/e2e-gate.mjs merge)
 * that:
 *   - verifies with a trusted Ed25519 public key (--key <pem> or the
 *     *.pem files in --keys <dir>, default security/e2e-receipt-keys)
 *   - is for the candidate's sha, or a commit with the very same tree
 *   - says ok, with 0 failed, more than 0 passed, every shard present and
 *     each shard under 10 minutes (scripts/lib/e2eShards.mjs re-checks them)
 * and, with --push, only as a fast-forward of <remote>/main (never a force).
 *
 *   npm run promote:main -- origin/verify/train-6                  # check only
 *   npm run promote:main -- origin/verify/train-6 --report ci-out/reports/e2e-<sha>.json
 *   npm run promote:main -- origin/verify/train-6 --push           # check, then git push <remote> <sha>:refs/heads/main
 *
 *   --report <file>   the report (default reports/e2e-<sha>.json, then --reports <dir>/e2e-<sha>.json)
 *   --reports <dir>   a directory of reports; a report for a commit with the same tree also counts
 *   --remote <name>   default origin
 *   --json            print the verdict as JSON
 *
 * Exit 0: promoted (or may be, without --push). 1: refused. 2: could not check.
 * W6.6's promote:check (WebKit and Safari receipts) is a separate check; the
 * owner runs both (docs: contributing/checks).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { e2eVerdict, reportPath } from "./lib/e2eShards.mjs";
import { check, sha256 } from "./nightly/receipt.mjs";
import { createPublicKey } from "node:crypto";

export const KEYS_DIR = "security/e2e-receipt-keys";

/** The fingerprint receipt.mjs writes as receipt.key: sha256 of the SPKI PEM, first 16 hex. */
export const fingerprint = (pem) => sha256(createPublicKey(pem).export({ type: "spki", format: "pem" }).toString()).slice(0, 16);

/** fingerprint → PEM for --key files and the *.pem of a directory. */
export function trustedKeys({ files = [], dir = null } = {}) {
  const keys = new Map();
  const add = (f) => {
    const pem = readFileSync(f, "utf8");
    keys.set(fingerprint(pem), pem);
  };
  for (const f of files) add(f);
  if (dir && existsSync(dir)) for (const f of readdirSync(dir).filter((x) => x.endsWith(".pem"))) add(join(dir, f));
  return keys;
}

/** The report for `candidate`: an explicit file, reports/e2e-<sha>.json, or one in `dir` for a commit with the same tree. */
export function findReport({ candidate, file = null, dir = null, cwd = process.cwd(), treeOf = () => null }) {
  const read = (f) => {
    try {
      return { path: f, report: JSON.parse(readFileSync(f, "utf8")) };
    } catch {
      return { path: f, report: null, problem: `${f}: not JSON` };
    }
  };
  if (file) return existsSync(file) ? read(file) : { path: file, report: null, problem: `${file} does not exist` };
  const own = join(cwd, reportPath(candidate));
  if (existsSync(own)) return read(own);
  if (dir && existsSync(dir)) {
    const exact = join(dir, `e2e-${candidate}.json`);
    if (existsSync(exact)) return read(exact);
    const want = treeOf(candidate);
    if (want)
      for (const f of readdirSync(dir)) {
        const m = /^e2e-([0-9a-f]{40})\.json$/.exec(f);
        if (m && treeOf(m[1]) === want) return read(join(dir, f));
      }
  }
  return { path: null, report: null };
}

/** The whole check: → { ok, candidate, report, key, why[] }. */
export function promoteVerdict({ candidate, found, keys, sameTree }) {
  const report = found.report;
  let verified = { ok: false, problems: [found.problem ?? "no report"] };
  if (report) {
    const pem = keys.get(report?.receipt?.key);
    verified = pem ? check(report, pem) : { ok: false, problems: [`signed by key ${report?.receipt?.key ?? "?"}, which is not trusted`] };
  }
  const v = e2eVerdict(candidate, report, verified, sameTree);
  return { ok: v.ok, candidate, report: found.path, key: report?.receipt?.key ?? null, why: found.problem && !report ? [found.problem, ...v.why] : v.why };
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const valued = new Set(["--report", "--reports", "--key", "--keys", "--remote"]);
  const positional = argv.filter((a, i) => !a.startsWith("--") && !valued.has(argv[i - 1]));
  const git = (...a) => spawnSync("git", a, { encoding: "utf8" });
  const out = (s) => s.status === 0 ? s.stdout.trim() : null;
  const rev = positional[0];
  if (!rev) {
    console.error("✗ promote:main: name the commit to promote (e.g. origin/verify/train-6)");
    process.exit(2);
  }
  const candidate = out(git("rev-parse", "--verify", "-q", `${rev}^{commit}`));
  if (!candidate) {
    console.error(`✗ promote:main: ${rev} is not a commit here (fetch it first)`);
    process.exit(2);
  }
  const keyFiles = [opt("key"), ...(process.env.LUMEN_E2E_RECEIPT_KEY ? [process.env.LUMEN_E2E_RECEIPT_KEY] : [])].filter(Boolean);
  const keys = trustedKeys({ files: keyFiles, dir: resolve(opt("keys") ?? KEYS_DIR) });
  if (!keys.size) {
    console.error(`✗ promote:main: no trusted public key (--key <pem>, LUMEN_E2E_RECEIPT_KEY or ${opt("keys") ?? KEYS_DIR}/*.pem)`);
    process.exit(2);
  }
  const treeOf = (sha) => out(git("rev-parse", "--verify", "-q", `${sha}^{tree}`));
  const sameTree = (a, b) => {
    const ta = treeOf(a);
    return ta !== null && ta === treeOf(b);
  };
  const found = findReport({ candidate, file: opt("report") ? resolve(opt("report")) : null, dir: opt("reports") ? resolve(opt("reports")) : null, treeOf });
  const v = promoteVerdict({ candidate, found, keys, sameTree });
  const remote = opt("remote") ?? "origin";
  if (argv.includes("--json")) console.log(JSON.stringify(v, null, 2));
  else {
    console.log(`promote:main ${candidate.slice(0, 12)}${found.path ? ` (${found.path})` : ""}`);
    for (const w of v.why) console.log(`  ✗ ${w}`);
  }
  if (!v.ok) {
    console.log("✗ promote:main: refused — main does not move without a signed, green e2e report for this hash (plan W4.2)");
    process.exit(1);
  }
  console.log(`✓ promote:main: the e2e report for ${candidate.slice(0, 12)} holds (key ${v.key})`);
  if (!argv.includes("--push")) {
    console.log(`  to promote: npm run promote:main -- ${candidate} --push`);
    process.exit(0);
  }
  if (git("fetch", "-q", remote, "main").status !== 0) {
    console.error(`✗ promote:main: could not fetch ${remote} main`);
    process.exit(2);
  }
  const main = out(git("rev-parse", "--verify", "-q", "FETCH_HEAD^{commit}"));
  if (!main || git("merge-base", "--is-ancestor", main, candidate).status !== 0) {
    console.error(`✗ promote:main: ${candidate.slice(0, 12)} is not a fast-forward of ${remote}/main (${main?.slice(0, 12) ?? "?"}); refused (no force)`);
    process.exit(1);
  }
  const push = git("push", remote, `${candidate}:refs/heads/main`);
  if (push.status !== 0) {
    console.error(`✗ promote:main: push failed: ${(push.stderr || "").trim().slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`✓ promote:main: ${remote}/main ${main.slice(0, 12)} → ${candidate.slice(0, 12)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
