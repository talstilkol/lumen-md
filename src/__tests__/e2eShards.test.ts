// @vitest-environment node
/**
 * Plan W4.2 / W6.8 (W10.E39): the whole e2e suite in shards, a signed
 * reports/e2e-<sha>.json, and main that does not move without it.
 * Real git, real Ed25519 keys, the real CLIs; nothing here is mocked.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import {
  E2E_SHARDS,
  MEASURED_FULL_RUN,
  SHARD_MINUTES,
  e2eVerdict,
  mergeShards,
  parseShard,
  shardFromEnv,
  shardResult,
  shardsFor,
  // @ts-expect-error — plain .mjs module without type declarations
} from "../../scripts/lib/e2eShards.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { e2eRuns, mergeCommand, playwrightArgs } from "../../scripts/e2e-gate.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import CompactFailures from "../../scripts/e2e-report.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { check } from "../../scripts/nightly/receipt.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { buildPipeline, pipelineRules } from "../../scripts/buildkite/lib.mjs";

type Shard = { current: number; total: number };
type Result = ReturnType<typeof shardResult>;
type Step = { key: string; parallelism?: number; depends_on?: { step: string }[]; command: string; if?: string };

const REPO = resolve(".");
const SHA = "a".repeat(40);
const t0 = Date.parse("2026-11-15T10:00:00Z");
const at = (min: number) => new Date(t0 + min * 60_000).toISOString();

/** A shard that passed: `n` tests named by shard, in `minutes`. */
function green(shard: Shard, { sha = SHA, minutes = 7, n = 80 } = {}): Result {
  const tests = Array.from({ length: n }, (_, i) => ({ id: `e2e/s${shard.current}.spec.ts:${i + 1} › t${i}`, status: "passed", ms: 100 }));
  return shardResult({ sha, shard, summary: { status: "passed", counts: { passed: n, failed: 0, skipped: 1, flaky: 0 }, tests, failures: [] }, startedAt: at(0), finishedAt: at(minutes), exit: 0 });
}
const all = (total = 4, o = {}) => Array.from({ length: total }, (_, i) => green({ current: i + 1, total }, o));

describe("how many shards (a shard < 10 min)", () => {
  it("splits the measured full run so each shard is well under the ceiling", () => {
    expect(SHARD_MINUTES).toBe(10);
    expect(E2E_SHARDS).toBe(4);
    expect(MEASURED_FULL_RUN.minutes / E2E_SHARDS).toBeLessThan(SHARD_MINUTES * 0.75);
    expect(shardsFor(29.7)).toBe(4);
    expect(shardsFor(7)).toBe(1);
    expect(shardsFor(60)).toBe(8);
    expect(() => shardsFor(0)).toThrow();
  });

  it("reads k/n, and Buildkite's 0-based parallel job", () => {
    expect(parseShard("2/4")).toEqual({ current: 2, total: 4 });
    for (const bad of ["0/4", "5/4", "4", "a/b", ""]) expect(() => parseShard(bad)).toThrow();
    expect(shardFromEnv({ LUMEN_E2E_SHARD: "3/4" })).toEqual({ current: 3, total: 4 });
    expect(shardFromEnv({ BUILDKITE_PARALLEL_JOB: "0", BUILDKITE_PARALLEL_JOB_COUNT: "4" })).toEqual({ current: 1, total: 4 });
    expect(shardFromEnv({ BUILDKITE_PARALLEL_JOB: "3", BUILDKITE_PARALLEL_JOB_COUNT: "4" })).toEqual({ current: 4, total: 4 });
    expect(shardFromEnv({})).toBeNull();
  });

  it("a full shard runs the whole chromium project with --shard and a box under the ceiling; the Vercel gate is unchanged", () => {
    const [run] = e2eRuns(undefined, undefined, { full: true, shard: { current: 2, total: 4 } });
    const args = playwrightArgs(run, 8);
    expect(args).toContain("--project=chromium");
    expect(args).toContain("--shard=2/4");
    expect(args.filter((a: string) => a.endsWith(".spec.ts"))).toEqual([]);
    expect(args).toContain(`--global-timeout=${(SHARD_MINUTES - 0.5) * 60_000}`);
    const vercel = e2eRuns(["e2e/smoke.spec.ts"], ["e2e/smoke.spec.ts"]);
    expect(vercel.map((r: { project: string }) => r.project)).toEqual(["chromium", "firefox"]);
    expect(playwrightArgs(vercel[0], 8)).toEqual(["playwright", "test", "e2e/smoke.spec.ts", "--project=chromium", "--workers=2", "--reporter=line,./scripts/e2e-report.mjs", "--global-timeout=480000"]);
  });
});

describe("the reporter's JSON (one shard's raw result)", () => {
  it("records every test with its outcome, and the failures", () => {
    const dir = mkdtempSync(join(tmpdir(), "e2e-rep-"));
    const file = join(dir, "run.json");
    const prev = process.env.LUMEN_E2E_JSON_FILE;
    process.env.LUMEN_E2E_JSON_FILE = file;
    try {
      const r = new CompactFailures();
      const test = (line: number, title: string) => ({ location: { file: join(process.cwd(), "e2e/a.spec.ts"), line }, titlePath: () => ["", "chromium", "a.spec.ts", title] });
      const log = console.log;
      console.log = () => {};
      try {
        r.onTestEnd(test(3, "opens"), { status: "passed", duration: 120, attachments: [], errors: [] });
        r.onTestEnd(test(9, "saves"), { status: "failed", duration: 300, attachments: [], errors: [{ message: "boom" }] });
        r.onTestEnd(test(12, "later"), { status: "skipped", duration: 0, attachments: [], errors: [] });
        r.onEnd({ status: "failed" });
      } finally {
        console.log = log;
      }
      const out = JSON.parse(readFileSync(file, "utf8"));
      expect(out.status).toBe("failed");
      expect(out.counts).toMatchObject({ passed: 1, failed: 1, skipped: 1 });
      expect(out.tests.map((t: { id: string }) => t.id)).toEqual(["e2e/a.spec.ts:3 › a.spec.ts › opens", "e2e/a.spec.ts:9 › a.spec.ts › saves", "e2e/a.spec.ts:12 › a.spec.ts › later"]);
      expect(out.failures).toEqual([{ where: "e2e/a.spec.ts:9", title: "a.spec.ts › saves", status: "failed" }]);
    } finally {
      if (prev === undefined) delete process.env.LUMEN_E2E_JSON_FILE;
      else process.env.LUMEN_E2E_JSON_FILE = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("merging the shards", () => {
  it("4 green shards for one hash → ok, with the totals", () => {
    const r = mergeShards(all(), { sha: SHA, total: 4 });
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.totals).toMatchObject({ passed: 320, failed: 0, skipped: 4, tests: 320 });
    expect(r.longestShardMinutes).toBe(7);
  });

  it("refuses a missing shard, another hash, a failure, a timed-out run, a shard over 10 min, a test run twice, a dirty tree", () => {
    const cases: [string, (rs: Result[]) => Result[]][] = [
      ["shard 3/4 is missing", (rs) => rs.filter((x) => x.shard.current !== 3)],
      ["not " + SHA.slice(0, 12), (rs) => [green({ current: 1, total: 4 }, { sha: "b".repeat(40) }), ...rs.slice(1)]],
      ["2 failed", (rs) => [{ ...rs[0], status: "failed", exit: 1, counts: { ...rs[0].counts, failed: 2 }, failures: [{ where: "e2e/x.spec.ts:1", title: "x", status: "failed" }] }, ...rs.slice(1)]],
      ["status timedout", (rs) => [{ ...rs[0], status: "timedout", exit: 1 }, ...rs.slice(1)]],
      ["took 10.5 min", (rs) => [green({ current: 1, total: 4 }, { minutes: 10.5 }), ...rs.slice(1)]],
      ["ran in shards 1 and 2", (rs) => [rs[0], { ...rs[1], tests: [...rs[1].tests, rs[0].tests[0]] }, ...rs.slice(2)]],
      ["uncommitted changes", (rs) => [{ ...rs[0], commit: { sha: SHA, dirty: true } }, ...rs.slice(1)]],
      ["not the full suite", (rs) => [{ ...rs[0], scope: "smoke" }, ...rs.slice(1)]],
      ["ran as 1/3", (rs) => [green({ current: 1, total: 3 }), ...rs.slice(1)]],
    ];
    for (const [want, change] of cases) {
      const r = mergeShards(change(all()), { sha: SHA, total: 4 });
      expect(r.ok, want).toBe(false);
      expect(r.problems.join("\n"), want).toContain(want);
    }
    expect(mergeShards([], { sha: SHA, total: 4 }).ok).toBe(false);
  });
});

/** A throwaway git repository with two commits, and a bare remote whose main is the first. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "e2e-promote-"));
  const work = join(dir, "work");
  const remote = join(dir, "remote.git");
  mkdirSync(work);
  const g = (cwd: string, ...a: string[]) => {
    const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "init.defaultBranch=main", "-c", "core.hooksPath=/dev/null", ...a], { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  g(dir, "init", "-q", "--bare", remote);
  g(work, "init", "-q");
  writeFileSync(join(work, "a.txt"), "one\n");
  g(work, "add", "a.txt");
  g(work, "commit", "-q", "-m", "one");
  const first = g(work, "rev-parse", "HEAD");
  g(work, "remote", "add", "origin", remote);
  g(work, "push", "-q", "origin", "HEAD:refs/heads/main");
  writeFileSync(join(work, "a.txt"), "two\n");
  g(work, "commit", "-q", "-am", "two");
  const second = g(work, "rev-parse", "HEAD");
  return { dir, work, remote, first, second, g };
}

const keypair = (dir: string, name: string) => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const priv = join(dir, `${name}.key`);
  const pub = join(dir, `${name}.pem`);
  writeFileSync(priv, privateKey.export({ type: "pkcs8", format: "pem" }).toString(), { mode: 0o600 });
  writeFileSync(pub, publicKey.export({ type: "spki", format: "pem" }).toString());
  return { priv, pub };
};

const promote = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [join(REPO, "scripts/promote-main.mjs"), ...args], { cwd, encoding: "utf8" });

describe("the signed report and promote-main", () => {
  let R: ReturnType<typeof repo>;
  let trusted: { priv: string; pub: string };
  let other: { priv: string; pub: string };
  let report: string;

  /** Seal shard results for `sha` with `key` into the work tree's reports/. */
  const seal = (sha: string, key: string, results = all(4, { sha })) => {
    const shards = mkdtempSync(join(R.dir, "shards-"));
    for (const r of results) writeFileSync(join(shards, `e2e-shard-${r.shard.current}-of-${r.shard.total}.json`), JSON.stringify(r));
    return mergeCommand({ dir: shards, total: 4, sha, root: R.work, env: { LUMEN_E2E_KEY: key }, log: () => {} });
  };

  beforeAll(() => {
    R = repo();
    trusted = keypair(R.dir, "trusted");
    other = keypair(R.dir, "other");
    report = seal(R.second, trusted.priv).out;
  });
  afterAll(() => rmSync(R.dir, { recursive: true, force: true }));

  it("merge writes reports/e2e-<sha>.json, sealed with the host key; a changed number breaks it", () => {
    expect(report).toBe(join(R.work, `reports/e2e-${R.second}.json`));
    const sealed = JSON.parse(readFileSync(report, "utf8"));
    expect(sealed.ok).toBe(true);
    expect(sealed.commit.sha).toBe(R.second);
    expect(check(sealed, readFileSync(trusted.pub, "utf8")).ok).toBe(true);
    expect(check({ ...sealed, totals: { ...sealed.totals, failed: 0, passed: 999 } }, readFileSync(trusted.pub, "utf8")).ok).toBe(false);
    expect(check(sealed, readFileSync(other.pub, "utf8")).ok).toBe(false);
  });

  it("accepts the hash with a green report signed by a trusted key", () => {
    const r = promote(R.work, R.second, "--key", trusted.pub);
    expect(r.stdout + r.stderr).toContain("✓ promote:main");
    expect(r.status).toBe(0);
  });

  it("refuses without a trusted key, with another key, for another hash, after tampering, and for a red run", () => {
    expect(promote(R.work, R.second, "--keys", join(R.dir, "none")).status).toBe(2);
    const untrusted = promote(R.work, R.second, "--key", other.pub);
    expect(untrusted.status).toBe(1);
    expect(untrusted.stdout).toContain("not trusted");
    const noReport = promote(R.work, R.first, "--key", trusted.pub);
    expect(noReport.status).toBe(1);
    expect(noReport.stdout).toContain("no e2e report");
    // A report for HEAD~1 renamed to HEAD: signed, but for another commit.
    const wrong = seal(R.first, trusted.priv).out;
    const renamed = join(R.dir, "renamed.json");
    writeFileSync(renamed, readFileSync(wrong, "utf8"));
    const other2 = promote(R.work, R.second, "--key", trusted.pub, "--report", renamed);
    expect(other2.status).toBe(1);
    expect(other2.stdout).toContain(`is for ${R.first.slice(0, 12)}`);
    // Tampering: flip ok on a red report.
    const red = all(4, { sha: R.second });
    red[2] = { ...red[2], status: "failed", exit: 1, counts: { ...red[2].counts, failed: 1 } };
    const redOut = seal(R.second, trusted.priv, red).out;
    const redReport = JSON.parse(readFileSync(redOut, "utf8"));
    expect(redReport.ok).toBe(false);
    const redFile = join(R.dir, "red.json");
    writeFileSync(redFile, JSON.stringify(redReport));
    const refused = promote(R.work, R.second, "--key", trusted.pub, "--report", redFile);
    expect(refused.status).toBe(1);
    expect(refused.stdout).toContain("did not pass");
    const forged = join(R.dir, "forged.json");
    writeFileSync(forged, JSON.stringify({ ...redReport, ok: true, problems: [], totals: { ...redReport.totals, failed: 0 } }));
    const tampered = promote(R.work, R.second, "--key", trusted.pub, "--report", forged);
    expect(tampered.status).toBe(1);
    expect(tampered.stdout).toContain("changed after it was sealed");
    // Put the green report back for the push test.
    seal(R.second, trusted.priv);
  });

  it("the verdict re-checks the numbers, not only the signer's ok flag", () => {
    const sealed = JSON.parse(readFileSync(report, "utf8"));
    const yes = { ok: true, problems: [] };
    expect(e2eVerdict(R.second, sealed, yes).ok).toBe(true);
    expect(e2eVerdict(R.second, { ...sealed, totals: { ...sealed.totals, failed: 1 } }, yes).why.join()).toContain("1 failed");
    expect(e2eVerdict(R.second, { ...sealed, shards: sealed.shards.slice(1) }, yes).why.join()).toContain("3 of 4 shards");
    expect(e2eVerdict(R.second, { ...sealed, ceilingMinutes: 30 }, yes).why.join()).toContain("above 10");
    expect(e2eVerdict(R.second, { ...sealed, shards: sealed.shards.map((s: { minutes: number }, i: number) => (i ? s : { ...s, minutes: 12 })) }, yes).why.join()).toContain("12 min");
    expect(e2eVerdict(R.second, sealed, { ok: false, problems: ["x"] }).ok).toBe(false);
    expect(e2eVerdict(R.second, null, yes).ok).toBe(false);
  });

  it("T6-H1: a key from the candidate's own checkout is never trusted; one in main's tree is", () => {
    const inTree = join(R.work, "security/e2e-receipt-keys");
    mkdirSync(inTree, { recursive: true });
    writeFileSync(join(inTree, "planted.pem"), readFileSync(trusted.pub, "utf8"));
    try {
      const byFile = promote(R.work, R.second, "--key", join(inTree, "planted.pem"));
      expect(byFile.status).toBe(2);
      expect(byFile.stderr).toContain("is inside this checkout");
      expect(promote(R.work, R.second, "--keys", inTree).status).toBe(2);
      // The default reads origin/main's tree with git, never the working tree: main has no key yet.
      const none = promote(R.work, R.second);
      expect(none.status).toBe(2);
      expect(none.stderr).toContain("security/e2e-receipt-keys/*.pem in origin/main");
      // A main whose tree holds the key: trusted without --key.
      const blob = R.g(R.work, "hash-object", "-w", trusted.pub);
      const keyDir = spawnSync("git", ["mktree"], { cwd: R.work, input: `100644 blob ${blob}\ttrusted.pem\n`, encoding: "utf8" }).stdout.trim();
      const sec = spawnSync("git", ["mktree"], { cwd: R.work, input: `040000 tree ${keyDir}\te2e-receipt-keys\n`, encoding: "utf8" }).stdout.trim();
      const root = spawnSync("git", ["mktree"], { cwd: R.work, input: `040000 tree ${sec}\tsecurity\n`, encoding: "utf8" }).stdout.trim();
      const mainWithKey = R.g(R.work, "commit-tree", root, "-m", "keys");
      const before = R.g(R.work, "rev-parse", "refs/remotes/origin/main");
      R.g(R.work, "update-ref", "refs/remotes/origin/main", mainWithKey);
      try {
        const ok = promote(R.work, R.second);
        expect(ok.stdout + ok.stderr).toContain("✓ promote:main");
        expect(ok.status).toBe(0);
      } finally {
        R.g(R.work, "update-ref", "refs/remotes/origin/main", before);
      }
    } finally {
      rmSync(join(R.work, "security"), { recursive: true, force: true });
    }
  });

  it("--push moves the remote's main by fast-forward only", () => {
    const pushed = promote(R.work, R.second, "--key", trusted.pub, "--push");
    expect(pushed.stdout + pushed.stderr).toContain("→");
    expect(pushed.status).toBe(0);
    expect(R.g(R.remote, "rev-parse", "refs/heads/main")).toBe(R.second);
    // A side commit that is not a descendant of the new main: refused even with a green, signed report.
    R.g(R.work, "checkout", "-q", R.first);
    writeFileSync(join(R.work, "b.txt"), "side\n");
    R.g(R.work, "add", "b.txt");
    R.g(R.work, "commit", "-q", "-m", "side");
    const side = R.g(R.work, "rev-parse", "HEAD");
    seal(side, trusted.priv);
    const refused = promote(R.work, side, "--key", trusted.pub, "--push");
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("not a fast-forward");
    expect(R.g(R.remote, "rev-parse", "refs/heads/main")).toBe(R.second);
  });
});

describe("the Buildkite pipeline runs the shards and the report", () => {
  const ci = () => parse(readFileSync(".github/workflows/ci.yml", "utf8"), { uniqueKeys: false });
  it("e2e-shards runs E2E_SHARDS jobs of e2e-gate --full; e2e-receipt merges them for this hash", () => {
    const committed = parse(readFileSync(".buildkite/pipeline.yml", "utf8")) as { steps: Step[] };
    const shards = committed.steps.find((s) => s.key === "e2e-shards");
    const receipt = committed.steps.find((s) => s.key === "e2e-receipt");
    expect(shards?.parallelism).toBe(E2E_SHARDS);
    expect(shards?.command).toContain("node scripts/e2e-gate.mjs --full");
    expect(shards?.command).toContain("VITE_E2E=1");
    expect(shards?.if).toBeUndefined();
    expect(receipt?.depends_on?.map((d) => d.step)).toEqual(["e2e-shards"]);
    expect(receipt?.command).toContain(`node scripts/e2e-gate.mjs merge --total ${E2E_SHARDS}`);
  });

  it("dropping the shards, running them in one job or cutting the report loose is caught", () => {
    const p = buildPipeline(ci());
    expect(pipelineRules(p)).toEqual([]);
    const one = buildPipeline(ci());
    one.steps.find((s: Step) => s.key === "e2e-shards").parallelism = 1;
    expect(pipelineRules(one).join("\n")).toContain("parallelism ≥ 2");
    const cut = buildPipeline(ci());
    cut.steps.find((s: Step) => s.key === "e2e-receipt").depends_on = [];
    expect(pipelineRules(cut).join("\n")).toContain("e2e-receipt does not wait for e2e-shards");
    const gone = buildPipeline(ci());
    gone.steps = gone.steps.filter((s: Step) => s.key !== "e2e-shards" && s.key !== "e2e-receipt");
    expect(pipelineRules(gone).join("\n")).toContain("no e2e-shards job");
  });
});
