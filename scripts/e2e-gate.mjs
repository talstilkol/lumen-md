#!/usr/bin/env node
/**
 * The e2e gate (W1.1): Playwright on chromium against the production build
 * (`vite preview` of dist/), inside the Vercel preview build, after vitest.
 *
 * The Vercel build image is Amazon Linux 2023, as root, with dnf. Playwright's
 * Ubuntu headless shell needs only nss and nspr from it. Browsers go into
 * node_modules (PLAYWRIGHT_BROWSERS_PATH=0), so the build cache keeps them.
 * Firefox runs there too, with no system libraries added: the gate runs
 * LUMEN_E2E_FIREFOX_SPECS on it (default the smoke spec). WebKit cannot run
 * on this image: Playwright's WebKit build needs glibc 2.38 (Amazon Linux
 * 2023 has 2.34) and libraries AL2023 does not package (libwpe,
 * wpebackend-fdo). Safari coverage is owed to a Mac (plan W4.22).
 *
 * What runs: LUMEN_E2E_SPECS (space-separated). The default is the smoke
 * spec (9 tests in about 40 s) and, since W6.30, the Hebrew accessibility
 * pair: axe on the key Hebrew flows, light and dark (a11y-hebrew-gate), and
 * the Hebrew aria snapshots (aria-hebrew, W4.21). The whole chromium project does not fit: on the
 * build machine (2 CPUs, 2 workers) it took 29.7 min for 327 tests
 * (verify/e2e-probe run 4: 291 passed, 32 failed, 4 skipped), and vitest
 * already takes about 12 of the 45 minutes. A spec joins the default list
 * once it passes there.
 *
 * The run is time-boxed (LUMEN_E2E_MINUTES, default 8, and never past minute
 * 38 of the build). A box that runs out fails the gate: it means the specs
 * no longer fit, not that they passed.
 *
 * Specs that drive the app's modules from inside the page load them through
 * window.__lumenTest (e2e/_lumen.ts), which a build has only when made with
 * VITE_E2E=1; scripts/vercel-build.mjs sets it whenever the e2e gate runs.
 *
 *   VITE_E2E=1 npm run build && node scripts/e2e-gate.mjs
 *
 * The whole suite, sharded (plan W4.2, W6.8; W10.E39). The Buildkite step
 * `e2e-shards` runs E2E_SHARDS jobs in parallel, each one shard of the whole
 * chromium project inside a box under SHARD_MINUTES (scripts/lib/e2eShards.mjs):
 *
 *   VITE_E2E=1 npm run build && LUMEN_E2E_SHARD=2/4 node scripts/e2e-gate.mjs --full
 *     → ci-out/e2e-shard-2-of-4.json   (the shard: from BUILDKITE_PARALLEL_JOB when LUMEN_E2E_SHARD is unset)
 *   node scripts/e2e-gate.mjs merge --total 4 [--dir ci-out] [--sha <40 hex>]
 *     → reports/e2e-<sha>.json, sealed with LUMEN_E2E_KEY (else the host key, LUMEN_NIGHTLY_KEY);
 *       exit 0 only when every shard passed. scripts/promote-main.mjs reads it.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SHARD_MINUTES, isSha, mergeShards, reportPath, shardFile, shardFromEnv, shardResult } from "./lib/e2eShards.mjs";
import { keyPath, loadOrCreateKey, seal } from "./nightly/receipt.mjs";

const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;
export const E2E_MINUTES = Number(process.env.LUMEN_E2E_MINUTES ?? 8);
const list = (v, fallback) => (v ?? fallback).split(/\s+/).filter(Boolean);
export const DEFAULT_E2E_SPECS = "e2e/smoke.spec.ts e2e/a11y-hebrew-gate.spec.ts e2e/aria-hebrew.spec.ts";
export const E2E_SPECS = list(process.env.LUMEN_E2E_SPECS, DEFAULT_E2E_SPECS);
/** Firefox runs too (LUMEN_E2E_FIREFOX_SPECS, default the smoke spec; empty turns it off). */
export const FIREFOX_SPECS = list(process.env.LUMEN_E2E_FIREFOX_SPECS, "e2e/smoke.spec.ts");
/**
 * What the gate runs, in order: each project with its specs. `full`: the
 * whole chromium project (no spec list), as one shard when `shard` is given.
 */
export function e2eRuns(chromium = E2E_SPECS, firefox = FIREFOX_SPECS, { full = false, shard = null } = {}) {
  if (full) return [{ project: "chromium", install: ["--only-shell", "chromium"], specs: [], shard, full: true }];
  return [
    { project: "chromium", install: ["--only-shell", "chromium"], specs: chromium },
    { project: "firefox", install: ["firefox"], specs: firefox },
  ].filter((r) => r.specs.length > 0);
}
/**
 * Vercel stops a build at 45 minutes. scripts/vercel-build.mjs sets
 * LUMEN_BUILD_STARTED; the box ends by minute 38 of the build, so the gates
 * after this one still get their 7 minutes.
 */
export function boxMinutes(env = process.env, now = Date.now()) {
  const started = Number(env.LUMEN_BUILD_STARTED);
  const left = Number.isFinite(started) && started > 0 ? 38 - (now - started) / 60_000 : Infinity;
  return Math.max(0, Math.floor(Math.min(E2E_MINUTES, left)));
}

/**
 * The Playwright arguments of one run. A full shard's global timeout is the
 * ceiling less half a minute, so a shard that would reach the ceiling stops
 * as "timedout" and its result is not "passed".
 */
export function playwrightArgs(run, box) {
  const minutes = run.full ? SHARD_MINUTES - 0.5 : box;
  return [
    "playwright",
    "test",
    ...run.specs,
    `--project=${run.project}`,
    ...(run.shard ? [`--shard=${run.shard.current}/${run.shard.total}`] : []),
    "--workers=2",
    "--reporter=line,./scripts/e2e-report.mjs",
    `--global-timeout=${Math.round(minutes * 60_000)}`,
  ];
}

/** The commit the run is for: BUILDKITE_COMMIT, else HEAD; `dirty` when the tree has uncommitted changes. */
export function runCommit(env = process.env, cwd = process.cwd()) {
  const git = (...a) => spawnSync("git", a, { cwd, encoding: "utf8" });
  const sha = isSha(env.BUILDKITE_COMMIT) ? env.BUILDKITE_COMMIT : git("rev-parse", "HEAD").stdout?.trim();
  const status = git("status", "--porcelain", "--untracked-files=no");
  return { sha: isSha(sha) ? sha : null, dirty: status.status !== 0 || status.stdout.trim() !== "" };
}

/** `merge`: the shard files in `dir` → the sealed report at <root>/reports/e2e-<sha>.json. */
export function mergeCommand({ dir, total, sha, root = process.cwd(), env = process.env, log = console.log }) {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^e2e-shard-\d+-of-\d+\.json$/.test(f)) : [];
  const results = [];
  for (const f of files) {
    try {
      results.push(JSON.parse(readFileSync(join(dir, f), "utf8")));
    } catch {
      log(`[e2e] ${f}: not JSON, left out (its shard counts as missing)`);
    }
  }
  const report = mergeShards(results, {
    sha,
    total,
    build: env.BUILDKITE_BUILD_URL ? { system: "buildkite", number: Number(env.BUILDKITE_BUILD_NUMBER) || null, url: env.BUILDKITE_BUILD_URL } : null,
    machine: { platform: process.platform, arch: process.arch, node: process.version, cpus: availableParallelism(), host: env.LUMEN_FACTORY_HOST || null },
  });
  const { privateKeyPem } = loadOrCreateKey(env.LUMEN_E2E_KEY || keyPath(env));
  const sealed = seal(report, privateKeyPem);
  const out = join(root, reportPath(isSha(sha) ? sha : "unknown"));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(sealed, null, 2)}\n`);
  log(`[e2e] ${report.ok ? "✓" : "✗"} ${report.totals.passed} passed, ${report.totals.failed} failed, ${report.totals.skipped} skipped in ${report.shards.length}/${total} shards (longest ${report.longestShardMinutes ?? "?"} min); sealed ${out} (sha256 ${sealed.receipt.sha256}, key ${sealed.receipt.key})`);
  for (const p of report.problems) log(`[e2e]   ${p}`);
  return { out, sealed };
}

// Playwright's Docker image (the Buildkite host) has its browsers at PLAYWRIGHT_BROWSERS_PATH; elsewhere they go into node_modules.
const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || "0", PLAYWRIGHT_BASE_URL: BASE };
const log = (s) => console.log(`[e2e] ${s}`);
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (argv[0] === "merge") {
    const total = Number(opt("total"));
    const sha = opt("sha") ?? runCommit().sha;
    const { sealed } = mergeCommand({ dir: resolve(opt("dir") ?? "ci-out"), total, sha });
    process.exit(sealed.ok ? 0 : 1);
  }
  const full = argv.includes("--full");
  const shard = full ? shardFromEnv() : null;
  const commit = full ? runCommit() : null;
  if (full && !commit.sha) {
    console.error("[e2e] --full: no commit sha (BUILDKITE_COMMIT or git HEAD)");
    process.exit(2);
  }
  if (!existsSync("dist/index.html")) {
    console.error("[e2e] no dist/: run the build first");
    process.exit(1);
  }
  // nss / nspr for the headless shell, when the image lets us install them (root + dnf).
  if (process.getuid?.() === 0 && spawnSync("sh", ["-c", "command -v dnf"]).status === 0) {
    const r = spawnSync("dnf", ["-y", "-q", "install", "nss", "nspr"], { stdio: "inherit" });
    log(`dnf install nss nspr: exit ${r.status}`);
  }
  const runs = e2eRuns(E2E_SPECS, FIREFOX_SPECS, { full, shard });
  for (const run of runs) {
    if (spawnSync(npx, ["playwright", "install", ...run.install], { stdio: "inherit", env }).status !== 0) {
      console.error(`[e2e] could not install ${run.project}`);
      process.exit(1);
    }
  }
  const preview = spawn(npx, ["vite", "preview", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { env, stdio: ["ignore", "inherit", "inherit"] });
  const stop = () => preview.kill();
  const deadline = Date.now() + 60_000;
  const wait = () =>
    fetch(`${BASE}/`).then(
      (r) => r.ok,
      () => false,
    );
  (async () => {
    while (!(await wait())) {
      if (Date.now() > deadline) {
        stop();
        console.error("[e2e] vite preview did not answer within 60 s");
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    // One box for the whole gate, shared by the runs in order.
    const gateEnd = Date.now() + boxMinutes() * 60_000;
    let failed = 0;
    for (const run of runs) {
      const box = Math.floor((gateEnd - Date.now()) / 60_000);
      if (box < 3 && !run.full) {
        console.error(`[e2e] ${run.project}: only ${box} min left in the gate's box: the specs no longer fit`);
        failed++;
        continue;
      }
      const args = playwrightArgs(run, box);
      log(`${run.project}: ${run.full ? `the whole project${run.shard ? `, shard ${run.shard.current}/${run.shard.total}` : ""}` : run.specs.join(" ")} against ${BASE}, ${args.at(-1)}`);
      const report = env.LUMEN_E2E_REPORT_FILE?.replace(/(\.[a-z]+)?$/, `-${run.project}$1`);
      const json = run.full ? resolve("ci-out", run.shard ? shardFile(run.shard) : "e2e-shard-1-of-1.json") : null;
      const startedAt = new Date().toISOString();
      const r = spawnSync(npx, args, {
        stdio: "inherit",
        env: { ...env, ...(report ? { LUMEN_E2E_REPORT_FILE: report } : {}), ...(json ? { LUMEN_E2E_JSON_FILE: `${json}.run` } : {}) },
        timeout: ((run.full ? SHARD_MINUTES : box) + 3) * 60_000,
      });
      log(`${run.project}: exit ${r.status ?? r.signal}`);
      if (r.status !== 0) failed++;
      if (json) {
        let summary = null;
        try {
          summary = JSON.parse(readFileSync(`${json}.run`, "utf8"));
        } catch {
          /* the reporter never finished: the shard's status is "missing" */
        }
        const result = shardResult({ sha: commit.sha, dirty: commit.dirty, shard: run.shard ?? { current: 1, total: 1 }, summary, startedAt, finishedAt: new Date().toISOString(), exit: r.status });
        mkdirSync(dirname(json), { recursive: true });
        writeFileSync(json, `${JSON.stringify(result, null, 2)}\n`);
        log(`${run.project}: ${result.counts.passed} passed, ${result.counts.failed} failed in ${result.minutes} min → ${json}`);
        if (!(result.minutes < SHARD_MINUTES)) failed++;
      }
    }
    stop();
    process.exit(failed ? 1 : 0);
  })();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
