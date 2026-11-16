/**
 * Plan W10.G9 (W6.7, W6.44): a task's verification level is computed from
 * the signed receipts that exist, not typed by hand. Pure functions; the
 * I/O is scripts/plan/receipts.mjs and the gate is scripts/plan/build.mjs.
 *
 * What a receipt proves, for the commit it names:
 *   factory / Buildkite "full" receipt, sealed   build ok → built; + vitest ok → node;
 *                                                + e2e in all three browsers ok → browser
 *   nightly "flake" receipt, sealed              every browser ran with nothing flaky or broken → browser
 *   Vercel /__build/receipt.json                 node, only when the caller vouches for it
 *                                                (GitHub's "Vercel" status for the sha is success)
 *   "real" / "safari" receipt, sealed            real, for the tasks it lists, when every check passed
 *   lumen-review v1, signed (W6.11)              no test level: the PR's independent review, counted
 *                                                under the rules pr:check uses (scripts/lib/independentReview.mjs)
 *
 * A receipt counts for a task only when its commit contains the task's PR at
 * that PR's current head: a push after the run makes the old evidence stale.
 * A skipped suite proves nothing. Sealed receipts use the format of
 * scripts/nightly/receipt.mjs (sorted-key JSON, sha256, Ed25519).
 */
import { createPublicKey, verify } from "node:crypto";
import { canonical, sha256 } from "../nightly/receipt.mjs";
import { receiptFor } from "../lib/independentReview.mjs";

/** Test levels, lowest first. `owner` (the agent's side ran in a browser, the owner's item is left) ranks as browser. */
export const LEVELS = Object.freeze(["built", "node", "browser", "real"]);
export const BROWSERS = Object.freeze(["chromium", "firefox", "webkit"]);
export const RECEIPTS_FILE = "plan/verified-receipts.json";

/** The rank of a level for comparison: -1 for none; owner counts as browser. */
export const rank = (level) => (level === "owner" ? LEVELS.indexOf("browser") : LEVELS.indexOf(level ?? ""));
/** Claimed levels that are a claim that something ran (built is the floor: code written, nothing ran). */
const RAN = new Set(["node", "browser", "real", "owner"]);

/** The fingerprint scripts/nightly/receipt.mjs puts in `receipt.key`. */
export const fingerprint = (pem) => sha256(createPublicKey(pem).export({ type: "spki", format: "pem" }).toString()).slice(0, 16);

/** A sealed report against trusted keys (fingerprint → PEM) → { ok, problems, key }. */
export function verifySealed(report, keys) {
  const r = report?.receipt;
  if (!r || typeof r !== "object") return { ok: false, problems: ["not sealed"] };
  const { receipt: _r, ...rest } = report;
  void _r;
  const text = canonical(rest);
  if (r.sha256 !== sha256(text)) return { ok: false, problems: ["the digest does not match: changed after sealing"] };
  const pem = keys.get(r.key);
  if (!pem) return { ok: false, problems: [`signed by key ${r.key ?? "?"}, which is not trusted`] };
  let good = false;
  try {
    good = verify(null, Buffer.from(text), createPublicKey(pem), Buffer.from(r.signature ?? "", "base64"));
  } catch {
    good = false; // why: a malformed signature is a bad signature
  }
  return good ? { ok: true, problems: [], key: r.key } : { ok: false, problems: ["the signature does not verify"] };
}

const passed = (s) => s?.ok === true && !s.skipped;
const allPassed = (xs) => xs.length > 0 && xs.every(passed);
const isSha = (s) => typeof s === "string" && /^[0-9a-f]{40}$/.test(s);

/**
 * A receipt whose origin the caller checked (a verified seal, or Vercel's
 * status) → { commit, level, kind, tasks? } or null (it proves no level).
 */
export function evidenceOf(report) {
  if (!report || typeof report !== "object" || report.format === "lumen-review") return null;
  const commit = report.commit?.sha ?? report.sha;
  if (!isSha(commit)) return null;
  if (report.kind === "full") {
    const s = report.suites ?? {};
    const e2e = BROWSERS.map((b) => s[`e2e ${b}`]);
    const level = passed(s.build) && passed(s.vitest) && allPassed(e2e) ? "browser" : passed(s.build) && passed(s.vitest) ? "node" : passed(s.build) ? "built" : null;
    return { commit, level, kind: "full" };
  }
  if (report.kind === "flake") {
    const bs = report.flake?.browsers ?? [];
    const clean = BROWSERS.every((n) => {
      const b = bs.find((x) => x.browser === n);
      return b && !b.missing && b.tests > 0 && !(b.flaky ?? []).length && !(b.broken ?? []).length;
    });
    return { commit, level: clean ? "browser" : null, kind: "flake" };
  }
  if (report.kind === "real" || report.kind === "safari") {
    const tasks = Array.isArray(report.real?.tasks) ? report.real.tasks.filter((x) => typeof x === "string") : [];
    const checks = report.kind === "safari" ? report.platforms ?? [] : report.checks ?? [];
    return { commit, level: tasks.length && allPassed(checks) ? "real" : null, kind: report.kind, tasks };
  }
  if (Array.isArray(report.gates) && report.gates.length) return { commit, level: report.gates.every(passed) ? "node" : null, kind: "vercel" };
  return null;
}

/** The higher of two levels (null lowest). */
const higher = (a, b) => (rank(a) >= rank(b) ? a : b);

/**
 * A PR's independent review from the lumen-review receipts that exist, under
 * pr:check's rules: signed by a key in the registry, not by the PR's author or
 * a committer in its range, for this PR, its merge base and its current head.
 *   pr: { number, head, base, sensitive: [{ file, pattern }], reviewers, excluded }
 *   receipts: [{ source, receipt }]
 * → { status: "signed" | "rejected" | "none", reviewer?, source?, why? }
 */
export function reviewOf(pr, receipts) {
  if (!receipts.length) return { status: "none" };
  const why = [];
  for (const { source, receipt, rejected } of receipts) {
    if (rejected) {
      why.push(`${source}: ${rejected}`);
      continue;
    }
    const p = receiptFor(receipt, pr.head, pr.sensitive ?? [], pr.reviewers ?? null, pr.excluded ?? null, { pr: pr.number, base: pr.base ?? null });
    if (!p.length) return { status: "signed", reviewer: receipt.reviewer, source };
    why.push(`${source}: ${p.join("; ")}`);
  }
  return { status: "rejected", why };
}

/**
 * The computed level per task and per PR.
 *   tasks:    [{ id, pr, claimed, phase }]
 *   heads:    { "<pr>": "<current head sha>" }
 *   evidence: [{ commit, level, kind, source, tasks? }]
 *   contains(head, commit) → true | false | null (null: unknown, the git objects are missing)
 *   reviews:  { "<pr>": reviewOf(...) }
 * → { tasks: { id: row }, prs: { pr: { head, computed, review } }, counts, unknown }
 */
export function computeLevels({ tasks, heads = {}, evidence = [], contains, reviews = {} }) {
  const out = {};
  const prs = {};
  let unknown = 0;
  const memo = new Map();
  const has = (head, commit) => {
    const k = `${head}:${commit}`;
    if (!memo.has(k)) memo.set(k, head === commit ? true : contains(head, commit));
    return memo.get(k);
  };
  for (const t of tasks) {
    const head = t.pr ? heads[String(t.pr)] ?? null : null;
    const row = { pr: t.pr ?? null, head, claimed: t.claimed ?? null, computed: null, evidence: [], review: t.pr ? reviews[String(t.pr)]?.status ?? "none" : "none", phase: t.phase };
    if (head) {
      for (const e of evidence) {
        if (!e.level || !e.commit) continue;
        if (e.level === "real" && !(e.tasks ?? []).includes(t.id)) continue;
        const c = has(head, e.commit);
        if (c === null) {
          unknown++;
          continue;
        }
        if (!c) continue;
        row.evidence.push({ level: e.level, kind: e.kind, commit: e.commit, source: e.source });
        row.computed = higher(e.level, row.computed);
      }
    }
    row.note = noteFor(row);
    out[t.id] = row;
    if (t.pr) {
      const p = (prs[String(t.pr)] ??= { head, computed: null, review: row.review, tasks: [] });
      p.tasks.push(t.id);
      // A level that only a "real" receipt naming one task proves is that task's, not the PR's.
      const prLevel = row.evidence.filter((e) => e.level !== "real").reduce((a, e) => higher(e.level, a), null);
      p.computed = higher(prLevel, p.computed);
    }
  }
  return { tasks: out, prs, counts: countBy(out), unknown };
}

/** Is a claimed level a claim the receipts don't back (a "manual" level)? */
export const isManual = (claimed, computed) => RAN.has(claimed) && rank(claimed) > rank(computed);

function noteFor(row) {
  if (row.claimed === "real" && row.computed !== "real") return "claims real without a receipt";
  if (isManual(row.claimed, row.computed)) return `claims ${row.claimed}; receipts prove ${row.computed ?? "nothing"}`;
  if (rank(row.computed) > rank(row.claimed)) return `receipts prove ${row.computed}; the plan says ${row.claimed ?? "nothing"}`;
  if (!row.pr) return "no PR";
  if (!row.head) return "the PR's head is unknown";
  return "matches";
}

/** { claimed: { level: n }, computed: { level: n, none: n }, manual: n } */
export function countBy(rows) {
  const claimed = {};
  const computed = Object.fromEntries([...LEVELS, "none"].map((k) => [k, 0]));
  let manual = 0;
  for (const r of Object.values(rows)) {
    claimed[r.claimed ?? "none"] = (claimed[r.claimed ?? "none"] ?? 0) + 1;
    computed[r.computed ?? "none"]++;
    if (isManual(r.claimed, r.computed)) manual++;
  }
  return { claimed, computed, manual };
}

/** Per plan phase: { phase, tasks, computed }, in the plan's order. */
export function byPhase(rows, phases) {
  return phases.map((title, i) => {
    const mine = Object.values(rows).filter((r) => r.phase === i);
    return { phase: title, tasks: mine.length, computed: countBy(Object.fromEntries(mine.map((r, j) => [j, r]))).computed };
  });
}

/**
 * The plan's levels against the receipts (plan:check).
 *   receipts: plan/verified-receipts.json, or null when it was never computed
 *   strict: every claimed level the receipts don't back is a problem (else only "real")
 * → { problems: string[], manual: string[] (task ids whose level is typed, not proven) }
 */
export function checkReceiptClaims(plan, receipts, { strict = false } = {}) {
  const problems = [];
  const manual = [];
  for (const p of plan.phases)
    for (const t of p.tasks) {
      if (!t.verified) continue;
      const row = receipts?.tasks?.[t.id];
      const computed = row?.computed ?? null;
      if (t.verified === "real" && computed !== "real") {
        problems.push(`${t.id}: verified "real" but ${row ? `its receipts prove ${computed ?? "nothing"}` : `${RECEIPTS_FILE} has no entry for it (npm run plan:receipts)`}`);
        continue;
      }
      if (!isManual(t.verified, computed)) continue;
      manual.push(t.id);
      if (strict) problems.push(`${t.id}: verified "${t.verified}" but the receipts prove ${computed ?? "nothing"} (W10.G9: a level comes from a receipt)`);
    }
  return { problems, manual };
}
