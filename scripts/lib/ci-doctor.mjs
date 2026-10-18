/**
 * Pure helpers for `scripts/ci-doctor.mjs`: read a failed Actions job (its
 * steps and check-run annotations), compare each failure with the same job in
 * recent runs on other branches, and say whether it looks real or flaky.
 * No fs, no network — the CLI fetches and passes the JSON in.
 */

/** Job / step conclusions that mean "this failed". */
const FAILED = new Set(["failure", "timed_out", "startup_failure"]);
export const isFailed = (conclusion) => FAILED.has(conclusion);

/**
 * Steps whose outcome depends only on the code, never on timing: if one of
 * them fails here and passes elsewhere, the difference is the code. Steps
 * that talk to a service (cache, artifacts, checkout, installs, comments)
 * never are, whatever they are named after ("Restore main's bundle sizes").
 */
const DETERMINISTIC = /\b(typecheck|tsc|hygiene|lint|coverage|build|budget|i18n|format|audit)\b/i;
const SERVICE_STEP = /\b(restore|save|upload|download|cache|artifacts?|checkout|setup|set up|install|comment|post|deploy|publish|e2e|playwright)\b/i;
export const isDeterministicStep = (name) => DETERMINISTIC.test(String(name ?? "")) && !SERVICE_STEP.test(String(name ?? ""));

/** A step that runs tests (vitest, Playwright): its failure annotations name tests. */
export const isTestStep = (name) => /^test\b|\b(e2e|playwright|vitest)\b/i.test(String(name ?? "")) && !SERVICE_STEP.test(String(name ?? "").replace(/\b(e2e|playwright)\b/gi, ""));

/**
 * A failure annotation that names a test: Playwright's title
 * ("[chromium] › e2e/x.spec.ts:12:3 › …") or a test file's path. A compiler
 * diagnostic from setup-node's tsc problem matcher (src/foo.ts) is not one.
 */
const isTestAnnotation = (a) => /^\s*\[[\w-]+\]\s+›/.test(a.title ?? "") || /(^|\/)(e2e|__tests__|tests?)\/|\.(spec|test)\.[cm]?[jt]sx?$/.test(a.path ?? "");

/** The failed steps of a job, in order. */
export const failedSteps = (job) => (job?.steps ?? []).filter((s) => isFailed(s.conclusion));

/**
 * A test's identity across branches: Playwright titles carry `file:line:col`,
 * and the line moves whenever the spec is edited, so it is dropped.
 */
export function testKey(title) {
  return String(title ?? "")
    .replace(/(\.[cm]?[jt]sx?):\d+(?::\d+)?/g, "$1")
    .replace(/[─━]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Same test? Annotation titles are cut at the first comma (a workflow-command
 * property ends there), the run summary keeps the whole name — so one key may
 * be a prefix of the other.
 */
export function sameTest(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.includes(" › ") && long.startsWith(short) && /^[,\s]/.test(long.slice(short.length));
}

/** The first line of an annotation message that says what went wrong. */
export function errorLine(message) {
  const lines = String(message ?? "")
    .split("\n")
    .map((l) => l.replace(/[─━]+/g, "").trim())
    .filter(Boolean);
  const hit = lines.find((l) => /(^|\s)(\w*Error|AssertionError|Test timeout|expect\(|Timed out|toBe|toEqual)\b/.test(l) && !/^\d+\)\s/.test(l));
  return (hit ?? lines.find((l) => !/^\d+\)\s/.test(l) && !/^Retry #\d+/.test(l)) ?? lines[0] ?? "").slice(0, 300);
}

/**
 * Check-run annotations of one job → failing tests, tests that passed on a
 * retry (Playwright's "flaky"), and `other`: failure annotations with a path
 * that do not look like tests (a test step's own may still be, see failureItems).
 */
export function parseAnnotations(annotations) {
  const failed = new Map();
  const other = new Map();
  const flaky = new Set();
  const summaryFailed = new Set();
  const fullTitle = new Map(); // summary key → the summary's own line (keeps file:line)
  let summary = false; // Playwright got to the end of the run and reported it
  for (const a of annotations ?? []) {
    if (/Playwright Run Summary/i.test(a.title ?? "")) {
      summary = true;
      let section = "";
      for (const raw of String(a.message ?? "").split("\n")) {
        const head = /^\s*\d+\s+(failed|flaky|skipped|passed|interrupted|did not run)\b/i.exec(raw);
        if (head) section = head[1].toLowerCase();
        else if (/^\s*\[/.test(raw) || /›/.test(raw)) {
          if (section === "flaky") flaky.add(testKey(raw));
          if (section === "failed") {
            summaryFailed.add(testKey(raw));
            fullTitle.set(testKey(raw), raw.replace(/[─━]+/g, "").trim());
          }
        }
      }
      continue;
    }
    if (a.annotation_level !== "failure") continue;
    // `.github` annotations are the runner's own ("Process completed with exit code 1").
    if (!a.path || a.path === ".github") continue;
    const title = a.title || `${a.path}:${a.start_line}`;
    const key = testKey(title);
    const bucket = isTestAnnotation(a) ? failed : other;
    const prev = bucket.get(key);
    const msg = errorLine(a.message);
    if (!prev) bucket.set(key, { key, title: title.trim(), path: a.path, line: a.start_line || null, message: msg });
    else if (!prev.message && msg) prev.message = msg;
  }
  // A test Playwright lists as flaky failed once and then passed: not a failure of this run.
  const tests = [...failed.values()].filter((t) => ![...flaky].some((f) => sameTest(f, t.key)));
  // Show the summary's full name when the annotation's title was cut short.
  for (const t of tests) {
    const full = [...summaryFailed].find((f) => f.length > t.key.length && sameTest(f, t.key));
    if (full) t.title = fullTitle.get(full) ?? full;
  }
  return { tests, other: [...other.values()], flaky: [...flaky], summaryFailed: [...summaryFailed], summary };
}

/**
 * What failed in one job: its failing tests when annotations name them
 * (other failure annotations count as tests only when a test step failed),
 * otherwise its failed steps (or the job itself).
 */
export function failureItems(job, parsed) {
  const steps = failedSteps(job);
  const step = steps[0]?.name ?? null;
  const tests = [...(parsed?.tests ?? []), ...(isTestStep(step) ? (parsed?.other ?? []) : [])];
  if (tests.length) return tests.map((t) => ({ kind: "test", job: job.name, step, ...t }));
  if (steps.length) return steps.map((s) => ({ kind: "step", job: job.name, step: s.name, key: s.name }));
  return [{ kind: "job", job: job.name, step: null, key: job.name }];
}

/**
 * The same failure in a peer run's job: "passed" | "failed" | "flaky" | null (no signal).
 * @param {object} item from failureItems
 * @param {object|undefined} peerJob the peer run's job with the same name
 * @param {object|null} peerParsed parseAnnotations of that job (only needed when it failed)
 * @param {{testPresent?: boolean}} [opts] testPresent: false = the test may not exist at the
 *   peer's commit (its file differs there). Annotations list failures and flakes, never passes,
 *   so a green job then proves nothing about it: no signal instead of "passed".
 */
export function observe(item, peerJob, peerParsed, opts = {}) {
  if (!peerJob || peerJob.status !== "completed") return null;
  const c = peerJob.conclusion;
  if (c === "skipped" || c === "cancelled" || c === "neutral" || c === null) return null;
  if (item.kind === "job") return isFailed(c) ? "failed" : c === "success" ? "passed" : null;
  if (item.kind === "step") {
    const s = (peerJob.steps ?? []).find((x) => x.name === item.step);
    if (!s || s.conclusion === "skipped" || s.conclusion === "cancelled" || s.conclusion === null) return null;
    return isFailed(s.conclusion) ? "failed" : s.conclusion === "success" ? "passed" : null;
  }
  // A test. Named in the peer's annotations: it existed there.
  if (peerParsed?.flaky?.some((f) => sameTest(f, item.key))) return "flaky";
  const pass = opts.testPresent === false ? null : "passed";
  if (c === "success") return pass;
  if (!isFailed(c)) return null;
  if (peerParsed?.tests?.some((t) => sameTest(t.key, item.key))) return "failed";
  // The peer job failed elsewhere: the tests only count if its failure is in
  // the same step, and the reporter got far enough to say so (the run
  // summary, or other tests' failures). A step that crashed before
  // reporting anything is no evidence that this test passed.
  const peerStep = failedSteps(peerJob)[0]?.name;
  const reported = Boolean(peerParsed && (peerParsed.summary || peerParsed.tests?.length));
  return peerStep && peerStep === item.step && reported ? pass : null;
}

/**
 * Real or flaky?
 * @param {object} item
 * @param {Array<{outcome:string|null, distance:number|null, sameSha?:boolean, branch?:string, unproven?:boolean}>} observations
 *   unproven: the job was green there, but the test may not have existed (see observe)
 * @param {{maxDistance?: number}} [opts] commits apart that still count as "a similar commit"
 * @returns {{verdict:"real"|"flaky"|"flake?"|"unknown", why:string, passed:number, failed:number, flaky:number}}
 */
export function classify(item, observations, opts = {}) {
  const maxDistance = opts.maxDistance ?? 30;
  const seen = (observations ?? []).filter((o) => o.outcome);
  const near = seen.filter((o) => o.sameSha || (o.distance != null && o.distance <= maxDistance));
  const count = (list, outcome) => list.filter((o) => o.outcome === outcome).length;
  const passed = count(near, "passed");
  const failed = count(near, "failed");
  const flaky = count(near, "flaky");
  const names = (list, outcome) => [...new Set(list.filter((o) => o.outcome === outcome).map((o) => o.branch).filter(Boolean))];
  const list = (xs) => (xs.length > 3 ? `${xs.slice(0, 3).join(", ")} +${xs.length - 3}` : xs.join(", "));
  const res = (verdict, why) => ({ verdict, why, passed, failed, flaky });

  if (!near.length) {
    const unproven = (observations ?? []).filter((o) => !o.outcome && o.unproven && (o.sameSha || (o.distance != null && o.distance <= maxDistance))).length;
    if (unproven) return res("unknown", `green at ${unproven} similar commit(s), but the test's file differs there (a new or renamed test?): no comparison`);
    return res("unknown", seen.length ? `no run of this job at a similar commit (${seen.length} further away)` : "no other branch ran this job recently");
  }
  if (item.kind !== "test" && isDeterministicStep(item.step ?? item.job)) {
    if (passed && !failed) return res("real", `deterministic check — passes on ${list(names(near, "passed"))}, so it is this branch's change`);
    if (failed && !passed) return res("real", `deterministic check — fails on ${list(names(near, "failed"))} too: broken in a shared base`);
    return res("real", `deterministic check — fails on ${failed}, passes on ${passed} similar commits: compare those branches' diffs`);
  }
  const samePass = near.filter((o) => o.sameSha && o.outcome === "passed");
  if (samePass.length) return res("flaky", `the same commit passed on ${list(names(samePass, "passed"))}`);
  if (flaky) return res("flaky", `passed only on a retry on ${list(names(near, "flaky"))}`);
  if (passed && failed) return res("flaky", `intermittent — failed on ${failed}, passed on ${passed} runs at similar commits`);
  if (failed) return res("real", `failed consistently: ${failed}/${failed} runs at similar commits (${list(names(near, "failed"))})`);
  return res("flake?", `fails only here — passed on ${passed} run(s) at similar commits (${list(names(near, "passed"))})`);
}

/** Browser project of a Playwright title ("[chromium] › …"). */
const project = (title) => /^\s*\[([\w-]+)\]/.exec(String(title ?? ""))?.[1] ?? null;

/** How ci.yml's "e2e against production build" job serves the app. */
const PROD = "npm run build && (npx http-server dist -p 5180 -c-1 &) && PLAYWRIGHT_BASE_URL=http://localhost:5180";

/** Command that reproduces a failed CI step locally (ci.yml step names). */
export function localCommand(step) {
  const s = String(step ?? "");
  if (/typecheck/i.test(s)) return "npx tsc --noEmit -p .";
  if (/hygiene/i.test(s)) return "npm run hygiene";
  if (/coverage/i.test(s)) return "npm run test:coverage";
  if (/bundle-size budget|budget/i.test(s)) return "npm run build && npm run budget";
  if (/i18n/i.test(s)) return "npm run i18n:check";
  if (/^build\b/i.test(s)) return "npm run build";
  if (/^test$/i.test(s)) return "npx vitest run";
  if (/e2e against prod/i.test(s)) return `${PROD} npx playwright test --project=chromium`;
  if (/e2e/i.test(s)) return "npx playwright test";
  return null;
}

/** The suggested next action for one classified failure. */
export function nextAction(item, verdict, run) {
  const rerun = run?.id ? `gh run rerun ${run.id} --failed` : "re-run the failed jobs";
  const isE2e = item.kind === "test" && /^e2e\//.test(item.path ?? "");
  const where = item.kind === "test" ? `${item.path}${item.line ? `:${item.line}` : ""}` : null;
  const browser = project(item.title);
  const repro = isE2e
    ? `${/production/i.test(item.job ?? "") ? `${PROD} ` : ""}npx playwright test ${item.path}${browser ? ` --project=${browser}` : ""}`
    : item.kind === "test"
      ? `npx vitest run ${item.path}`
      : localCommand(item.step ?? item.job);
  switch (verdict) {
    case "flaky":
      return isE2e
        ? `${rerun}; then make it stable: npm run e2e:flake -- ${item.path} --times 10${browser ? ` --project ${browser}` : ""}`
        : `${rerun}; the test is timing-dependent — fix the wait in ${where ?? item.step}`;
    case "flake?":
      return `${rerun} once; if it fails again it is real — reproduce with: ${repro ?? "the job log"}`;
    case "real":
      return repro ? `reproduce and fix locally: ${repro}` : `read the failed step's log: ${item.step ?? item.job}`;
    default:
      return repro ? `no comparison available — reproduce locally: ${repro}` : `${rerun} and read the log`;
  }
}
