// @vitest-environment node
/**
 * Plan 0.9 (W10.E32): ci-doctor reads Buildkite builds and Vercel
 * deployments, where the gates run since GitHub Actions stopped on 9.11.
 *
 * The responses below are SYNTHETIC samples in the shape of Buildkite's REST
 * v2 (builds, jobs, job logs) and Vercel's REST (v6 deployments, v3 events),
 * with logs written as scripts/buildkite/run.sh, scripts/vercel-build.mjs,
 * Playwright's list reporter and Vitest print them. They are not recorded
 * from a real build.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
// @ts-expect-error — plain .mjs module without type declarations
import { annotationsFromLog, bkConclusion, bkJobs, bkRun, cleanLog, stepsFromLog, vercelJobs, vercelLog, vercelRun } from "../../scripts/lib/ci-doctor-sources.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { classify, failureItems, observe, parseAnnotations } from "../../scripts/lib/ci-doctor.mjs";

const S1 = "1".repeat(40);
const S2 = "2".repeat(40);
const pipeline = { slug: "lumen-md", name: "lumen-md" };
const bkJob = (id: string, key: string, state: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "script",
  name: `:x: ${key}`,
  step_key: key,
  state,
  exit_status: state === "passed" ? 0 : 1,
  web_url: `https://buildkite.example/o/lumen-md/builds/1#${id}`,
  log_url: `https://api.buildkite.example/log/${id}`,
  ...extra,
});
const build = (number: number, state: string, commit: string, branch: string, created_at: string, jobs: unknown[]) => ({
  id: `b-${number}`,
  number,
  state,
  commit,
  branch,
  created_at,
  web_url: `https://buildkite.example/o/lumen-md/builds/${number}`,
  pipeline,
  jobs,
});

// run.sh's output for the static job: Typecheck fails, the rest keep going (LUMEN_CI_KEEP_GOING).
const STATIC_LOG = [
  "\x1b_bk;t=1731650000000\x07--- :npm: install",
  "added 1400 packages in 40s",
  "--- Typecheck",
  "src/a.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'.",
  "^^^ +++",
  "✗ Typecheck: exit 2",
  "--- Code hygiene (no `as any` / console.log in production src)",
  "\x1b[32m✓\x1b[0m hygiene",
  "--- a/src/diff-in-output.ts",
  "+++ ✗ 1 failed",
  "  ✗ Typecheck",
].join("\r\n");

// run.sh around Playwright's list reporter: one failure (retried, printed twice), one flaky, a summary.
const E2E_LOG = [
  "--- :npm: install",
  "--- :playwright: browsers: chromium",
  "--- Run E2E (chromium)",
  "Running 120 tests using 2 workers",
  "  1) [chromium] › e2e/old.spec.ts:10:3 › an old test fails ──────────────────",
  "",
  "    Error: expect(received).toBe(expected) // Object.is equality",
  "",
  "    Expected: 2",
  "    Received: 3",
  "",
  "    Retry #1 ───────────────────────────────────────────────────────────────",
  "  1) [chromium] › e2e/old.spec.ts:10:3 › an old test fails ──────────────────",
  "    Error: expect(received).toBe(expected) // Object.is equality",
  "",
  "  1 failed",
  "    [chromium] › e2e/old.spec.ts:10:3 › an old test fails ───────────────────",
  "  1 flaky",
  "    [chromium] › e2e/wobbly.spec.ts:4:1 › sometimes slow ────────────────────",
  "  118 passed (2.1m)",
  "^^^ +++",
  "✗ Run E2E (chromium): exit 1",
  "+++ ✗ 1 failed",
].join("\n");

const VITEST_LOG = [
  "--- vitest shard 2/4",
  " FAIL  src/__tests__/zip.test.ts > zip export > keeps the folder order 12ms",
  "AssertionError: expected [ 'b', 'a' ] to deeply equal [ 'a', 'b' ]",
  " ✓ src/__tests__/ok.test.ts (3 tests) 4ms",
  "^^^ +++",
  "✗ vitest shard 2/4: exit 1",
].join("\n");

describe("Buildkite builds and jobs → runs and jobs", () => {
  it("maps build and job states to conclusions", () => {
    expect(["passed", "failed", "failing", "canceled", "timed_out", "running", "scheduled", "blocked", "broken"].map(bkConclusion)).toEqual([
      "success",
      "failure",
      "failure",
      "cancelled",
      "timed_out",
      null,
      null,
      "action_required",
      "skipped",
    ]);
    const r = bkRun(build(50, "failed", S1, "feat/x", "2026-11-14T10:00:00Z", []));
    expect(r).toEqual({ id: 50, name: "lumen-md", workflow_id: "lumen-md", status: "completed", conclusion: "failure", head_sha: S1, head_branch: "feat/x", created_at: "2026-11-14T10:00:00Z", html_url: "https://buildkite.example/o/lumen-md/builds/50" });
    expect(bkRun(build(51, "running", S1, "feat/x", "2026-11-14T10:00:00Z", [])).status).toBe("in_progress");
  });

  it("names jobs by step key (shards numbered), skips waiters, keeps only the latest try of a retried job", () => {
    const jobs = bkJobs(
      build(50, "failed", S1, "feat/x", "x", [
        bkJob("j1", "static", "failed"),
        { id: "w", type: "waiter", state: "passed" },
        bkJob("j2", "vitest", "passed", { parallel_group_index: 0 }),
        bkJob("j3", "vitest", "failed", { parallel_group_index: 1 }),
        bkJob("j4", "e2e-chromium", "failed", { retried: true, retried_in_job_id: "j5" }),
        bkJob("j5", "e2e-chromium", "passed"),
      ]),
    );
    expect(jobs.map((j: { name: string; conclusion: string }) => `${j.name}:${j.conclusion}`)).toEqual(["static:failure", "vitest #1:success", "vitest #2:failure", "e2e-chromium:success"]);
    expect(jobs.find((j: { name: string }) => j.name === "e2e-chromium").retriedAfterFailure).toBe(true);
  });
});

describe("logs → steps and failing tests", () => {
  it("reads run.sh's gates: the failed one, the passed ones; a diff's --- line is no step", () => {
    expect(cleanLog("\x1b_bk;t=1\x07a\x1b[31mb\x1b[0m\r\n")).toBe("ab\n");
    const steps = stepsFromLog(STATIC_LOG, "failure");
    expect(steps.map((s: { name: string; conclusion: string }) => `${s.name}:${s.conclusion}`)).toEqual([":npm: install:success", "Typecheck:failure", "Code hygiene (no `as any` / console.log in production src):success"]);
  });

  it("a step not run after a failure is skipped; a timed-out job fails its last open step", () => {
    const log = ["--- Build", "^^^ +++", "✗ Build: exit 1", "--- :fast_forward: Bundle-size budget (not run: an earlier step failed)"].join("\n");
    expect(stepsFromLog(log, "failure").map((s: { conclusion: string }) => s.conclusion)).toEqual(["failure", "skipped"]);
    expect(stepsFromLog("--- :npm: install\n--- Run E2E (webkit)\nRunning 12 tests", "timed_out").map((s: { conclusion: string }) => s.conclusion)).toEqual(["success", "timed_out"]);
    expect(stepsFromLog("--- :npm: install\n^^^ +++\n✗ install failed", "failure")[0]).toMatchObject({ name: ":npm: install", conclusion: "failure" });
  });

  it("reads vercel-build's gates", () => {
    const log = vercelLog([{ type: "stdout", payload: { text: "vercel-build (vercel): build → vitest → e2e" } }, { payload: { text: "\n▶ build" } }, { payload: { text: "\n▶ vitest" } }, { payload: { text: "\n✗ vercel-build: the vitest gate failed (80.1 s, exit 1)." } }, { payload: { text: "\n▶ e2e" } }]);
    expect(stepsFromLog(log, "failure").map((s: { name: string; conclusion: string }) => `${s.name}:${s.conclusion}`)).toEqual(["build:success", "vitest:failure", "e2e:success"]);
  });

  it("Playwright failures (once per test, not per retry), its flaky list, and Vitest FAIL lines become annotations parseAnnotations reads", () => {
    const pw = parseAnnotations(annotationsFromLog(E2E_LOG));
    expect(pw.tests.map((t: { title: string; path: string; line: number }) => [t.title, t.path, t.line])).toEqual([["[chromium] › e2e/old.spec.ts:10:3 › an old test fails", "e2e/old.spec.ts", 10]]);
    expect(pw.tests[0].message).toContain("expect(received).toBe(expected)");
    expect(pw.flaky).toEqual(["[chromium] › e2e/wobbly.spec.ts › sometimes slow"]);
    expect(pw.summary).toBe(true);
    const vt = parseAnnotations(annotationsFromLog(VITEST_LOG));
    expect(vt.tests.map((t: { title: string; path: string }) => [t.title, t.path])).toEqual([["src/__tests__/zip.test.ts > zip export > keeps the folder order", "src/__tests__/zip.test.ts"]]);
    expect(vt.tests[0].message).toContain("AssertionError");
  });

  it("classifies a Buildkite failure: a test that passed elsewhere at a similar commit is a flake suspect, a Typecheck that passes elsewhere is real", () => {
    const job = { name: "e2e-chromium", conclusion: "failure", status: "completed", steps: stepsFromLog(E2E_LOG, "failure") };
    const [item] = failureItems(job, parseAnnotations(annotationsFromLog(E2E_LOG)));
    expect(item).toMatchObject({ kind: "test", step: "Run E2E (chromium)", path: "e2e/old.spec.ts" });
    const peer = { name: "e2e-chromium", conclusion: "success", status: "completed", steps: stepsFromLog("--- Run E2E (chromium)\n  120 passed", "success") };
    const c = classify(item, [{ outcome: observe(item, peer, null), distance: 3, branch: "feat/y" }]);
    expect(c.verdict).toBe("flake?");
    const st = { name: "static", conclusion: "failure", status: "completed", steps: stepsFromLog(STATIC_LOG, "failure") };
    const [tc] = failureItems(st, parseAnnotations(annotationsFromLog(STATIC_LOG)));
    expect(tc).toMatchObject({ kind: "step", step: "Typecheck" });
    const green = { name: "static", conclusion: "success", status: "completed", steps: stepsFromLog("--- Typecheck\n--- Lint", "success") };
    expect(classify(tc, [{ outcome: observe(tc, green, null), distance: 2, branch: "feat/y" }]).verdict).toBe("real");
  });
});

describe("Vercel deployments → runs", () => {
  it("maps a deployment to a run with one vercel-build job", () => {
    const r = vercelRun({ uid: "dpl_abc", name: "lumen-md", state: "ERROR", createdAt: Date.parse("2026-11-14T10:00:00Z"), inspectorUrl: "https://vercel.example/i/abc", meta: { githubCommitSha: S1, githubCommitRef: "feat/x" } });
    expect(r).toMatchObject({ id: "dpl_abc", status: "completed", conclusion: "failure", head_sha: S1, head_branch: "feat/x", created_at: "2026-11-14T10:00:00.000Z" });
    expect(vercelRun({ uid: "dpl_b", state: "BUILDING", createdAt: 0, meta: {} }).status).toBe("in_progress");
    expect(vercelJobs(r)).toEqual([{ id: "dpl_abc", name: "vercel-build", status: "completed", conclusion: "failure", html_url: "https://vercel.example/i/abc", steps: [] }]);
  });
});

// ── end to end: the CLI against a local Buildkite API and a fake gh ───────

const FAKE_GH = `#!/usr/bin/env node
const fs = require("fs");
const routes = JSON.parse(fs.readFileSync(process.env.FAKE_GH_ROUTES, "utf8"));
const route = process.argv[3];
for (const [re, body] of routes) if (new RegExp(re).test(route)) { process.stdout.write(JSON.stringify(body)); process.exit(0); }
process.stderr.write("gh: Not Found (HTTP 404) " + route + "\\n");
process.exit(1);
`;

describe("scripts/ci-doctor.mjs --source buildkite (local API)", () => {
  let dir = "";
  let server: Server;
  let base = "";
  const builds = [
    build(50, "failed", S1, "feat/x", "2026-11-14T10:00:00Z", [bkJob("j1", "static", "failed"), bkJob("j2", "e2e-chromium", "failed")]),
    build(49, "passed", S2, "feat/y", "2026-11-14T09:00:00Z", [bkJob("k1", "static", "passed"), bkJob("k2", "e2e-chromium", "passed")]),
  ];
  const logs: Record<string, string> = { j1: STATIC_LOG, j2: E2E_LOG, k1: "--- Typecheck\n--- Lint\n+++ ✓ every step passed", k2: "--- Run E2E (chromium)\n  120 passed (2m)\n+++ ✓ every step passed" };
  const seen: string[] = [];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "cidoctor-bk-"));
    writeFileSync(join(dir, "gh"), FAKE_GH);
    chmodSync(join(dir, "gh"), 0o755);
    writeFileSync(join(dir, "token"), "bk-test-token\n");
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    writeFileSync(
      join(dir, "routes.json"),
      JSON.stringify([
        [`^${esc(`repos/o/r/compare/${S2}...${S1}`)}`, { a: 2, b: 1, n: 1, files: ["src/other.ts"] }],
        [`^${esc(`repos/o/r/compare/${S1}...${S2}`)}`, { a: 1, b: 2, n: 1, files: ["src/else.ts"] }],
      ]),
    );
    server = createServer((req, res) => {
      seen.push(`${req.headers.authorization} ${req.url}`);
      const u = new URL(req.url ?? "/", "http://x");
      const p = u.pathname.replace("/v2/organizations/o/pipelines/lumen-md", "");
      let body: unknown = null;
      if (p === "/builds") body = builds.filter((b) => !u.searchParams.get("branch") || b.branch === u.searchParams.get("branch"));
      else if (/^\/builds\/\d+$/.test(p)) body = builds.find((b) => String(b.number) === p.split("/")[2]);
      else if (/^\/builds\/\d+\/jobs\/\w+\/log$/.test(p)) body = { content: logs[p.split("/")[4]] };
      res.writeHead(body ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(body ?? { message: "Not Found" }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const doctor = (...args: string[]) =>
    new Promise<{ code: number | null; out: string; err: string }>((done) => {
      const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, GH_REPO: "o/r", FAKE_GH_ROUTES: join(dir, "routes.json"), LUMEN_BUILDKITE_API: base, LUMEN_BUILDKITE_ORG: "o", LUMEN_BUILDKITE_TOKEN_FILE: join(dir, "token") };
      const p = spawn(process.execPath, [resolve(__dirname, "../../scripts/ci-doctor.mjs"), ...args], { env });
      let out = "";
      let err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("close", (code) => done({ code, out, err }));
    });

  it("diagnoses the branch's latest build: Typecheck REAL, the e2e test FLAKE? (passed on feat/y two commits away); Buildkite is the default source", async () => {
    const r = await doctor("feat/x", "--json");
    expect(r.err).toBe("");
    const out = JSON.parse(r.out);
    expect(out.run).toMatchObject({ id: 50, conclusion: "failure", sha: S1 });
    const by = Object.fromEntries(out.failures.map((f: { kind: string; step: string; title?: string; verdict: string }) => [f.kind === "test" ? f.title : f.step, f.verdict]));
    expect(by).toEqual({ Typecheck: "real", "[chromium] › e2e/old.spec.ts:10:3 › an old test fails": "flake?" });
    expect(out.retried).toEqual([{ job: "e2e-chromium", test: "[chromium] › e2e/wobbly.spec.ts › sometimes slow" }]);
    expect(r.code).toBe(1); // --json: a real failure
    // Every request carried the token from the file.
    expect(seen.every((s) => s.startsWith("Bearer bk-test-token "))).toBe(true);
  });

  it("--run <build number> diagnoses that build; without an org it says what to set", async () => {
    const r = await doctor("--run", "50");
    expect(r.out).toContain("run 50 · lumen-md · failure");
    expect(r.out).toMatch(/REAL\s+step: Typecheck/);
    const p = spawn(process.execPath, [resolve(__dirname, "../../scripts/ci-doctor.mjs"), "feat/x"], { env: { ...process.env, LUMEN_BUILDKITE_ORG: "", GH_REPO: "o/r" } });
    const code = await new Promise((d) => p.on("close", d));
    expect(code).toBe(2);
  });
});
