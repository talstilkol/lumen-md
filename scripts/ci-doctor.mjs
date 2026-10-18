#!/usr/bin/env node
/**
 * Why is CI red here, and is it real? Takes the latest Actions run of a
 * branch (or of a PR's head branch), lists its failed jobs, steps and the
 * tests its check-run annotations name, then looks at the same job in the
 * last ~20 runs of that workflow on other branches:
 *
 *   real    fails consistently at similar commits (or a deterministic check —
 *           typecheck, build, budget, i18n… — that only code can change)
 *   flaky   the same commit passed elsewhere, it passed on a retry, or it both
 *           passes and fails at similar commits
 *   flake?  passed at similar commits on other branches, fails only here
 *   unknown no comparable run
 *
 * and prints the failing test names with a suggested next action.
 * Read-only, REST through the `gh` CLI.
 *
 * Usage:
 *   node scripts/ci-doctor.mjs feat/pwa-real
 *   node scripts/ci-doctor.mjs 190                 # PR number → its head branch
 *   node scripts/ci-doctor.mjs 190 --peers 30 --max-distance 50 --json
 *   node scripts/ci-doctor.mjs --run 39085293928   # one particular run, not the latest
 */
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { classify, failureItems, isFailed, nextAction, observe, parseAnnotations } from "./lib/ci-doctor.mjs";

const usage = "usage: node scripts/ci-doctor.mjs <branch|pr-number> [--run ID] [--peers N] [--max-distance N] [--json]";
const argv = process.argv.slice(2);
let target = null;
let peersWanted = 20;
let maxDistance = 30;
let asJson = false;
let runId = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--peers") peersWanted = Number(argv[++i]);
  else if (a === "--max-distance") maxDistance = Number(argv[++i]);
  else if (a === "--json") asJson = true;
  else if (a === "--run") runId = argv[++i];
  else if (!a.startsWith("--") && !target) target = a;
  else {
    console.error(`unknown argument: ${a}\n${usage}`);
    process.exit(2);
  }
}
if ((!target && !runId) || !(peersWanted > 0) || !(maxDistance >= 0) || (runId && !/^\d+$/.test(runId))) {
  console.error(usage);
  process.exit(2);
}

const execP = promisify(execFile);
const remote = process.env.GH_REPO || execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
const repo = remote.replace(/\.git$/, "").split(/[/:]/).slice(-2).join("/");
async function api(route, jq) {
  const args = ["api", route, ...(jq ? ["--jq", jq] : [])];
  const { stdout } = await execP("gh", args, { maxBuffer: 64 << 20 });
  return JSON.parse(stdout);
}
/** Map with at most `n` requests in flight. */
async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
const memo = (fn) => {
  const cache = new Map();
  return (k) => {
    if (!cache.has(k)) cache.set(k, fn(k));
    return cache.get(k);
  };
};
const annotationsOf = memo((jobId) =>
  api(`repos/${repo}/check-runs/${jobId}/annotations?per_page=100`)
    .then(parseAnnotations)
    .catch(() => null),
);
const jobsOf = memo((runId) =>
  api(`repos/${repo}/actions/runs/${runId}/jobs?per_page=100`)
    .then((r) => r.jobs ?? [])
    .catch(() => null),
);
const when = (iso) => String(iso ?? "").replace("T", " ").slice(0, 16) + " UTC";
const short = (sha) => String(sha ?? "").slice(0, 8);

// ── the run to diagnose ───────────────────────────────────────────────
let branch = target;
let pr = null;
if (/^\d+$/.test(target)) {
  pr = await api(`repos/${repo}/pulls/${target}`).catch((e) => {
    console.error(`PR #${target} not found: ${String(e.stderr || e.message).split("\n")[0]}`);
    process.exit(1);
  });
  branch = pr.head.ref;
}
const runs = runId
  ? [await api(`repos/${repo}/actions/runs/${runId}`)]
  : (await api(`repos/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=10`)).workflow_runs ?? [];
if (runId) branch = runs[0].head_branch;
if (!runs.length) {
  console.log(`ci-doctor: no Actions runs for ${branch}${pr ? ` (PR #${pr.number})` : ""}.`);
  process.exit(0);
}
const notes = [];
const latest = runs[0];
let run = latest;
if (latest.status !== "completed") {
  run = runs.find((r) => r.status === "completed");
  notes.push(`latest run ${latest.id} (${latest.name}) is ${latest.status}; diagnosing the last completed one`);
  if (!run) {
    console.log(`ci-doctor: ${branch} — run ${latest.id} is ${latest.status}, nothing completed yet. ${latest.html_url}`);
    process.exit(0);
  }
}
if (pr && run.head_sha !== pr.head.sha) notes.push(`that run is for ${short(run.head_sha)}; the PR head is ${short(pr.head.sha)} (no CI on the newest push yet?)`);

const header = [
  `ci-doctor · ${branch}${pr ? ` (PR #${pr.number})` : ""}`,
  `run ${run.id} · ${run.name} · ${run.conclusion} · ${short(run.head_sha)} · ${when(run.created_at)}`,
  run.html_url,
  ...notes.map((n) => `note: ${n}`),
];

if (run.conclusion === "success") {
  if (asJson) console.log(JSON.stringify({ branch, pr: pr?.number ?? null, run: pick(run), verdict: "green", failures: [] }, null, 2));
  else console.log([...header, "", "green — nothing to diagnose."].join("\n"));
  process.exit(0);
}

const jobs = (await jobsOf(run.id)) ?? [];
const failedJobs = jobs.filter((j) => isFailed(j.conclusion));
const parsedByJob = new Map(await Promise.all(failedJobs.map(async (j) => [j.id, await annotationsOf(j.id)])));
const items = failedJobs.flatMap((j) => failureItems(j, parsedByJob.get(j.id)));
const retried = failedJobs.flatMap((j) => (parsedByJob.get(j.id)?.flaky ?? []).map((t) => ({ job: j.name, test: t })));

// ── the same jobs on other branches ───────────────────────────────────
const recent = (await api(`repos/${repo}/actions/workflows/${run.workflow_id}/runs?status=completed&per_page=60`)).workflow_runs ?? [];
const peers = recent.filter((r) => r.head_branch !== branch && r.id !== run.id).slice(0, peersWanted);
const distanceTo = memo((sha) =>
  sha === run.head_sha
    ? Promise.resolve(0)
    : api(`repos/${repo}/compare/${sha}...${run.head_sha}`, "{a: .ahead_by, b: .behind_by}")
        .then((d) => d.a + d.b)
        .catch(() => null),
);
const peerData = await mapLimit(peers, 6, async (p) => ({ run: p, jobs: await jobsOf(p.id), distance: await distanceTo(p.head_sha) }));
const testJobs = new Set(items.filter((i) => i.kind === "test").map((i) => i.job));
// Annotations of the peer jobs that ran the failing tests (flaky lists live there even when green).
await mapLimit(
  peerData.flatMap((p) => (p.jobs ?? []).filter((j) => testJobs.has(j.name) && j.status === "completed" && j.conclusion !== "skipped")),
  6,
  (j) => annotationsOf(j.id),
);

const results = [];
for (const item of items) {
  const observations = [];
  for (const p of peerData) {
    const peerJob = (p.jobs ?? []).find((j) => j.name === item.job);
    const peerParsed = peerJob && item.kind === "test" ? await annotationsOf(peerJob.id) : null;
    observations.push({
      outcome: observe(item, peerJob, peerParsed),
      distance: p.distance,
      sameSha: p.run.head_sha === run.head_sha,
      branch: p.run.head_branch,
      run: p.run.id,
    });
  }
  const c = classify(item, observations, { maxDistance });
  results.push({ ...item, ...c, next: nextAction(item, c.verdict, run), compared: observations.filter((o) => o.outcome).length });
}

const near = peerData.filter((p) => p.distance != null && p.distance <= maxDistance).length;
const counts = { real: 0, flaky: 0, "flake?": 0, unknown: 0 };
for (const r of results) counts[r.verdict]++;

if (asJson) {
  console.log(JSON.stringify({ branch, pr: pr?.number ?? null, run: pick(run), peers: peers.length, near, failures: results, retried, counts }, null, 2));
  process.exit(results.some((r) => r.verdict === "real") ? 1 : 0);
}

const out = [...header, `compared with ${peers.length} ${run.name} run(s) on other branches — ${near} at similar commits (≤${maxDistance} commits apart)`];
if (!failedJobs.length) out.push("", `no failed jobs (run ${run.conclusion}).`);
const LABEL = { real: "REAL   ", flaky: "FLAKY  ", "flake?": "FLAKE? ", unknown: "UNKNOWN" };
for (const j of failedJobs) {
  const mine = results.filter((r) => r.job === j.name);
  const steps = (j.steps ?? []).filter((s) => isFailed(s.conclusion)).map((s) => s.name);
  out.push("", `✗ ${j.name}${steps.length ? ` — step "${steps.join('", "')}"` : ""}  ${j.html_url}`);
  for (const r of mine) {
    out.push(`  ${LABEL[r.verdict]} ${r.kind === "test" ? r.title : r.kind === "step" ? `step: ${r.step}` : `job: ${r.job}`}`);
    if (r.message) out.push(`          ${r.message}`);
    out.push(`          ${r.why}`);
    out.push(`          next: ${r.next}`);
  }
  for (const t of retried.filter((x) => x.job === j.name)) out.push(`  (passed on retry in this run: ${t.test})`);
}
out.push("", `diagnosis: ${counts.real} real · ${counts.flaky} flaky · ${counts["flake?"]} flake suspect · ${counts.unknown} unknown`);
const first = results.find((r) => r.verdict === "real") ?? results.find((r) => r.verdict === "flake?") ?? results[0];
if (first) out.push(`next: ${first.verdict === "real" ? "fix the real failure first — " : ""}${first.next}`);
console.log(out.join("\n"));

function pick(r) {
  return { id: r.id, name: r.name, conclusion: r.conclusion, sha: r.head_sha, created_at: r.created_at, url: r.html_url };
}
