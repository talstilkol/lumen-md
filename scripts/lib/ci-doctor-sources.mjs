/**
 * Where ci-doctor reads runs from (plan 0.9, W10.E32). GitHub Actions stopped
 * running the gates on 9.11; they run on Buildkite (scripts/buildkite/) and
 * in the Vercel build (scripts/vercel-build.mjs). These pure functions turn
 * a Buildkite build or a Vercel deployment, and their logs, into the shapes
 * scripts/lib/ci-doctor.mjs already classifies: a run, its jobs with their
 * steps, and failure "annotations" (what GitHub's check runs used to carry).
 * No fs, no network.
 */

/** Buildkite timestamps (`\x1b_bk;t=…\x07`), ANSI colours and CRs out of a log. */
export function cleanLog(text) {
  return String(text ?? "")
    .replace(/\x1b_bk;[^\x07]*\x07/g, "")
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\r(?!\n)/g, "\n")
    .replace(/\r\n/g, "\n");
}

// ── Buildkite ────────────────────────────────────────────────────────────

const BK_FINISHED = new Set(["passed", "failed", "canceled", "skipped", "not_run", "blocked", "finished", "broken", "timed_out", "expired"]);
/** A Buildkite build or job state → a GitHub-style conclusion (null while it runs). */
export function bkConclusion(state) {
  switch (state) {
    case "passed":
      return "success";
    case "failed":
    case "failing":
      return "failure";
    case "timed_out":
      return "timed_out";
    case "canceled":
    case "canceling":
      return "cancelled";
    case "blocked":
      return "action_required";
    case "skipped":
    case "not_run":
    case "broken": // a job that did not run because an earlier step failed
    case "expired":
      return "skipped";
    default:
      return null;
  }
}
const bkStatus = (state) => (BK_FINISHED.has(state) ? "completed" : "in_progress");

/** One Buildkite build (REST v2) → a run. Its id is the build number (`--run <number>`). */
export function bkRun(build) {
  return {
    id: build.number,
    name: build.pipeline?.name ?? build.pipeline?.slug ?? "buildkite",
    workflow_id: build.pipeline?.slug ?? "pipeline",
    status: bkStatus(build.state),
    conclusion: bkConclusion(build.state),
    head_sha: build.commit,
    head_branch: build.branch,
    created_at: build.created_at,
    html_url: build.web_url,
  };
}

/**
 * The script jobs of a build → jobs, named by their step key (stable across
 * builds; the label carries emoji). A parallel job adds its shard number.
 * A job that was retried is replaced by its retry, and remembered: a test
 * job that failed and then passed on a retry is a flake signal.
 */
export function bkJobs(build) {
  const jobs = (build.jobs ?? []).filter((j) => j.type === "script");
  const out = [];
  for (const j of jobs) {
    if (j.retried && jobs.some((k) => k.id === j.retried_in_job_id)) continue;
    const base = j.step_key || j.name || j.id;
    const name = j.parallel_group_index == null ? base : `${base} #${j.parallel_group_index + 1}`;
    const prior = jobs.filter((k) => k.retried && k.retried_in_job_id === j.id);
    out.push({
      id: j.id,
      name,
      status: bkStatus(j.state),
      conclusion: bkConclusion(j.state),
      html_url: j.web_url,
      steps: [],
      retriedAfterFailure: prior.some((k) => bkConclusion(k.state) === "failure"),
    });
  }
  return out;
}

// ── Vercel ───────────────────────────────────────────────────────────────

/** A Vercel deployment state → a conclusion. */
export function vercelConclusion(state) {
  return { READY: "success", ERROR: "failure", CANCELED: "cancelled" }[state] ?? null;
}

/** One Vercel deployment (REST v6 list item) → a run with one job, "vercel-build". */
export function vercelRun(dep) {
  const state = dep.state ?? dep.readyState;
  return {
    id: dep.uid ?? dep.id,
    name: "vercel-build",
    workflow_id: dep.name ?? "vercel",
    status: vercelConclusion(state) || state === "CANCELED" ? "completed" : "in_progress",
    conclusion: vercelConclusion(state),
    head_sha: dep.meta?.githubCommitSha ?? null,
    head_branch: dep.meta?.githubCommitRef ?? null,
    created_at: new Date(dep.createdAt ?? dep.created).toISOString(),
    html_url: dep.inspectorUrl ?? (dep.url ? `https://${dep.url}` : null),
  };
}
export const vercelJobs = (run) => [{ id: run.id, name: "vercel-build", status: run.status, conclusion: run.conclusion, html_url: run.html_url, steps: [] }];

/** Vercel build events (`/v3/deployments/<id>/events`) → the log text. */
export const vercelLog = (events) => (events ?? []).map((e) => e?.payload?.text ?? e?.text ?? "").join("\n");

// ── logs → steps and test failures ───────────────────────────────────────

/**
 * The steps of a job from its log, in order, with a conclusion each:
 *   scripts/buildkite/run.sh   `--- <title>`, `✗ <title>: exit N`,
 *                              `--- :fast_forward: <title> (not run: …)`, `✗ install failed`
 *   scripts/vercel-build.mjs   `▶ <gate>`, `✗ vercel-build: the <gate> gate failed`
 * A failed job whose last step never reported (a timeout, a killed agent)
 * has that step failed.
 */
export function stepsFromLog(text, jobConclusion = null) {
  const steps = [];
  const byName = new Map();
  const add = (name, conclusion) => {
    if (byName.has(name)) return byName.get(name);
    const s = { number: steps.length + 1, name, status: "completed", conclusion };
    steps.push(s);
    byName.set(name, s);
    return s;
  };
  for (const raw of cleanLog(text).split("\n")) {
    const line = raw.trim();
    let m;
    if ((m = /^--- :fast_forward: (.+?) \(not run: /.exec(line))) add(m[1], "skipped");
    // run.sh's section header; a diff's `--- a/path` in the output is not one.
    else if ((m = /^--- (?!:fast_forward:)(?!a\/|\/dev\/null)(.+)$/.exec(line))) add(m[1].trim(), null);
    else if ((m = /^▶ (\S.*)$/.exec(line))) add(m[1].trim(), null);
    else if ((m = /^✗ vercel-build: the (\S+) gate failed/.exec(line))) add(m[1], null).conclusion = "failure";
    else if ((m = /^✗ (.+): exit (\d+|\w+)$/.exec(line))) add(m[1], null).conclusion = "failure";
    else if (/^✗ install failed$/.test(line)) add(steps.find((s) => /install/.test(s.name))?.name ?? ":npm: install", null).conclusion = "failure";
  }
  const failed = jobConclusion === "failure" || jobConclusion === "timed_out";
  if (failed && !steps.some((s) => s.conclusion === "failure")) {
    const last = [...steps].reverse().find((s) => s.conclusion === null);
    if (last) last.conclusion = jobConclusion;
  }
  // A step that reported no failure passed, unless the job was cancelled under it.
  for (const s of steps) if (s.conclusion === null) s.conclusion = jobConclusion === "cancelled" ? "cancelled" : "success";
  return steps;
}

/**
 * Test failures in a log, as GitHub-style check-run annotations, so
 * parseAnnotations() reads them as it read Actions':
 *   Playwright (list/line reporter): `  1) [chromium] › e2e/x.spec.ts:12:3 › title ──`
 *     and its closing summary (`  2 failed` / `  1 flaky` + titles);
 *   Vitest: ` FAIL  src/__tests__/x.test.ts > describe > test` (and `×`/`✗` lines of the verbose reporter).
 * The message is the first error line after the title.
 */
export function annotationsFromLog(text) {
  const lines = cleanLog(text).split("\n");
  const out = [];
  const messageAfter = (i) => {
    const rest = [];
    for (let k = i + 1; k < Math.min(lines.length, i + 40); k++) {
      if (/^\s*\d+\) \[/.test(lines[k]) || /^\s*(FAIL|×|✗)\s/.test(lines[k])) break;
      rest.push(lines[k]);
    }
    return rest.join("\n");
  };
  const seen = new Set();
  let summaryStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if ((m = /^\s*\d+\) (\[[\w-]+\] › ((?:[\w.@-]+\/)*[\w.@-]+\.[cm]?[jt]sx?):(\d+)(?::\d+)? › .+?)\s*[─━]*\s*$/.exec(l))) {
      const key = `pw:${m[1]}`;
      if (seen.has(key)) continue; // Playwright prints a retried failure once per attempt
      seen.add(key);
      out.push({ annotation_level: "failure", path: m[2], start_line: Number(m[3]), title: m[1], message: messageAfter(i) });
    } else if ((m = /^\s*(?:FAIL|×|✗)\s+((?:[\w.@-]+\/)*[\w.@-]+\.(?:test|spec)\.[cm]?[jt]sx?)\s+(?:>|›)\s+(.+?)\s*(?:\d+ms)?\s*$/.exec(l))) {
      const title = `${m[1]} > ${m[2]}`;
      if (seen.has(title)) continue;
      seen.add(title);
      out.push({ annotation_level: "failure", path: m[1], start_line: null, title, message: messageAfter(i) });
    } else if (summaryStart < 0 && /^\s*\d+ (failed|flaky|passed|skipped|did not run|interrupted)\b/.test(l)) summaryStart = i;
  }
  if (summaryStart >= 0) {
    const block = [];
    for (let k = summaryStart; k < lines.length; k++) {
      if (!lines[k].trim()) {
        if (block.length && !/^\s*\d+ \w/.test(lines[k + 1] ?? "") && !/^\s*\[/.test(lines[k + 1] ?? "")) break;
        continue;
      }
      if (!/^\s*\d+ \w|^\s*\[[\w-]+\] ›/.test(lines[k])) break;
      block.push(lines[k]);
    }
    if (block.some((b) => /^\s*\d+ (failed|flaky)\b/.test(b))) out.push({ annotation_level: "notice", path: ".github", title: "🎭 Playwright Run Summary", message: block.join("\n") });
  }
  return out;
}
