/**
 * Plan W11.L1 — launch gates as code. The rules shared by
 * scripts/launch-gate.mjs and its tests.
 *
 * docs/launch/milestones.json lists each milestone's criteria. Every
 * criterion names the plan acceptance it comes from and the kind of receipt
 * that proves it. A receipt is a JSON file under
 * docs/launch/receipts/<milestone>/<criterion>.json, written by whoever ran
 * the check (a lane for tests that run offline, the owner on the Mac for the
 * rest). The gate never runs anything and never trusts a missing file:
 * a criterion without a valid receipt is FAIL, not "unknown" and not "pass".
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHA = /^[0-9a-f]{7,40}$/;
export const RECEIPT_KINDS = ["test", "run", "owner", "metric"];
/**
 * Where a metric's value comes from:
 *   - "beta-reports": aggregated by `launch:gate -- --beta-metrics <dir>` from
 *     the weekly opt-in beta reports testers chose to send (W6.31, W11.P4);
 *   - "owner": measured or counted by the owner (a test protocol, a store
 *     console, a drill) and recorded with its evidence.
 */
export const METRIC_FROM = ["beta-reports", "owner"];
/** The metrics `aggregateBetaReports` computes. */
export const BETA_METRICS = ["optInUsers", "testersWeek1", "activationRate", "d7", "d30"];

/** Problems with milestones.json itself (shape, ids, sources, order). */
export function milestoneProblems(data) {
  const out = [];
  const ids = new Set();
  const list = Array.isArray(data?.milestones) ? data.milestones : null;
  if (!list?.length) return ["milestones.json: no milestones"];
  for (const m of list) {
    const where = m?.id ?? "(no id)";
    if (!/^(M\d+|GA)$/.test(String(m?.id))) out.push(`${where}: id must be M<n> or GA`);
    if (ids.has(m.id)) out.push(`${where}: listed twice`);
    ids.add(m.id);
    if (!m.title?.en?.trim() || !m.title?.he?.trim()) out.push(`${where}: needs a title in English and Hebrew`);
    if (m.after != null && !ids.has(m.after)) out.push(`${where}: after ${m.after}, which is not listed before it`);
    if (!Array.isArray(m.criteria) || !m.criteria.length) {
      out.push(`${where}: no criteria`);
      continue;
    }
    const cids = new Set();
    for (const c of m.criteria) {
      const cw = `${where}/${c?.id ?? "(no id)"}`;
      if (!/^[a-z0-9][a-z0-9-]*$/.test(String(c?.id))) out.push(`${cw}: id must be kebab-case`);
      if (cids.has(c.id)) out.push(`${cw}: listed twice`);
      cids.add(c.id);
      if (!c.en?.trim() || !c.he?.trim()) out.push(`${cw}: needs the criterion in English and Hebrew`);
      const src = c.source ?? {};
      if (!/^(W\d+\.[A-Z]*\d+|\d+\.\d+)$/.test(String(src.task))) out.push(`${cw}: source.task must be a plan id`);
      if (!String(src.acceptance ?? "").trim()) out.push(`${cw}: source.acceptance must quote the plan acceptance it maps to`);
      const r = c.receipt ?? {};
      if (!RECEIPT_KINDS.includes(r.kind)) out.push(`${cw}: receipt.kind must be one of ${RECEIPT_KINDS.join(", ")}`);
      if (r.kind === "test" && !(Array.isArray(r.tests) && r.tests.length)) out.push(`${cw}: a test receipt names the test files`);
      if (r.kind === "run" && !(Array.isArray(r.runs) && r.runs.length)) out.push(`${cw}: a run receipt names the runs it needs`);
      if (r.kind === "owner" && !(Array.isArray(r.facts) && r.facts.length)) out.push(`${cw}: an owner receipt names the facts to record`);
      if (r.kind === "metric") {
        if (!METRIC_FROM.includes(r.from)) out.push(`${cw}: a metric receipt says where its values come from (${METRIC_FROM.join(" or ")})`);
        if (!(Array.isArray(r.metrics) && r.metrics.length)) out.push(`${cw}: a metric receipt names the metrics and their thresholds`);
        for (const mt of Array.isArray(r.metrics) ? r.metrics : []) {
          if (!/^[a-z][A-Za-z0-9]*$/.test(String(mt?.name))) out.push(`${cw}: a metric needs a camelCase name`);
          const hasMin = typeof mt?.min === "number" && Number.isFinite(mt.min);
          const hasMax = typeof mt?.max === "number" && Number.isFinite(mt.max);
          if (!hasMin && !hasMax) out.push(`${cw}/${mt?.name}: a metric needs a numeric min or max`);
          if (r.from === "beta-reports" && !BETA_METRICS.includes(mt?.name)) out.push(`${cw}/${mt?.name}: not a metric the beta reports give (${BETA_METRICS.join(", ")})`);
        }
      }
    }
  }
  return out;
}

/**
 * Why `receipt` does not prove `criterion` (empty when it does).
 * `ctx.fileExists(path)` and `ctx.commitExists(sha)` check the repository;
 * `ctx.today` (YYYY-MM-DD) rejects receipts from the future.
 */
export function receiptProblems(criterion, receipt, ctx = {}) {
  const { fileExists = () => true, commitExists = () => true, today = new Date().toISOString().slice(0, 10) } = ctx;
  if (receipt == null) return ["no receipt"];
  if (typeof receipt !== "object" || Array.isArray(receipt)) return ["the receipt is not a JSON object"];
  const out = [];
  const spec = criterion.receipt ?? {};
  if (receipt.criterion !== criterion.id) out.push(`the receipt is for ${JSON.stringify(receipt.criterion)}, not ${criterion.id}`);
  if (receipt.kind !== spec.kind) out.push(`the receipt is a ${receipt.kind ?? "?"} receipt; this criterion needs ${spec.kind}`);
  if (receipt.result !== "pass") out.push(`the receipt's result is ${JSON.stringify(receipt.result ?? null)}, not "pass"`);
  if (!DATE.test(String(receipt.date))) out.push("the receipt needs a date (YYYY-MM-DD)");
  else if (receipt.date > today) out.push(`the receipt is dated ${receipt.date}, after today`);
  if (!String(receipt.by ?? "").trim()) out.push("the receipt needs `by` (who ran it)");
  if (!SHA.test(String(receipt.commit))) out.push("the receipt needs the commit it ran on");
  else if (!commitExists(receipt.commit)) out.push(`commit ${receipt.commit} is not in this repository`);

  if (spec.kind === "test") {
    const got = new Map((Array.isArray(receipt.tests) ? receipt.tests : []).map((t) => [t?.file, t]));
    for (const file of spec.tests ?? []) {
      const t = got.get(file);
      if (!fileExists(file)) out.push(`${file} does not exist in this checkout`);
      if (!t) {
        out.push(`no result for ${file}`);
        continue;
      }
      const passed = Number(t.passed);
      const total = Number(t.total);
      if (!Number.isInteger(total) || total < 1) out.push(`${file}: no tests counted`);
      else if (passed !== total) out.push(`${file}: ${t.passed}/${t.total} passed`);
      if (!String(t.command ?? "").trim()) out.push(`${file}: the receipt needs the command that ran`);
    }
  }
  if (spec.kind === "run") {
    const got = new Map((Array.isArray(receipt.runs) ? receipt.runs : []).map((r) => [r?.name, r]));
    for (const name of spec.runs ?? []) {
      const r = got.get(name);
      if (!r) out.push(`no result for the run ${name}`);
      else if (r.result !== "pass") out.push(`the run ${name}: ${JSON.stringify(r.result ?? null)}, not "pass"`);
      else if (!String(r.evidence ?? "").trim()) out.push(`the run ${name}: no evidence (a log, a report or an artifact path)`);
    }
  }
  if (spec.kind === "metric") {
    const values = receipt.metrics && typeof receipt.metrics === "object" && !Array.isArray(receipt.metrics) ? receipt.metrics : {};
    for (const mt of spec.metrics ?? []) {
      const v = values[mt.name];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        out.push(`the metric ${mt.name} is not recorded as a number`);
        continue;
      }
      if (typeof mt.min === "number" && v < mt.min) out.push(`${mt.name} = ${v}, below ${mt.min}`);
      if (typeof mt.max === "number" && v > mt.max) out.push(`${mt.name} = ${v}, above ${mt.max}`);
    }
    if (!String(receipt.evidence ?? "").trim()) out.push("the metric receipt needs evidence (the reports folder, a protocol or a console export)");
    if (spec.from === "beta-reports" && !(Number.isInteger(receipt.reports) && receipt.reports > 0)) out.push("the metric receipt needs `reports`: how many beta reports it was computed from");
  }
  if (spec.kind === "owner") {
    const facts = receipt.facts && typeof receipt.facts === "object" ? receipt.facts : {};
    for (const f of spec.facts ?? []) {
      const v = facts[f];
      if (v === undefined || v === null || v === "" || v === false) out.push(`the fact ${f} is not recorded`);
    }
  }
  return out;
}

/**
 * Evaluate one milestone. `readReceipt(milestone, criterion)` returns the
 * parsed receipt, `null` when there is none, or throws on a broken file.
 * A milestone with `after` also needs the milestone before it to pass.
 */
export function evaluate(data, id, ctx = {}) {
  const { readReceipt = () => null } = ctx;
  const m = data.milestones.find((x) => x.id === id);
  if (!m) throw new Error(`unknown milestone ${id}; known: ${data.milestones.map((x) => x.id).join(", ")}`);
  const criteria = m.criteria.map((c) => {
    let receipt = null;
    let problems;
    try {
      receipt = readReceipt(m.id, c.id);
      problems = receiptProblems(c, receipt, ctx);
    } catch (e) {
      problems = [`the receipt does not parse: ${e?.message ?? e}`];
    }
    return { id: c.id, en: c.en, he: c.he, source: c.source, kind: c.receipt?.kind, pass: problems.length === 0, problems };
  });
  const before = m.after ? evaluate(data, m.after, ctx) : null;
  const pass = criteria.every((c) => c.pass) && (before ? before.pass : true);
  return { id: m.id, title: m.title, after: m.after ?? null, before: before ? { id: before.id, pass: before.pass } : null, pass, passed: criteria.filter((c) => c.pass).length, total: criteria.length, criteria };
}

/** The gate's report as plain text. */
export function gateText(r) {
  const lines = [`launch:gate ${r.id} — ${r.title.en} / ${r.title.he}`];
  if (r.before) lines.push(`${r.before.pass ? "PASS" : "FAIL"}  (needs ${r.before.id} to pass first)`);
  for (const c of r.criteria) {
    lines.push(`${c.pass ? "PASS" : "FAIL"}  ${c.id} [${c.kind}; ${c.source.task}] ${c.en}`);
    for (const p of c.problems) lines.push(`        - ${p}`);
  }
  const open = r.criteria.filter((c) => !c.pass).map((c) => c.id);
  if (open.length) lines.push(`open (${open.length}): ${open.join(", ")}`);
  lines.push(`${r.pass ? "PASS" : "FAIL"} ${r.id}: ${r.passed}/${r.total} criteria with a valid receipt${r.before && !r.before.pass ? `; ${r.before.id} is not green` : ""}`);
  return lines.join("\n") + "\n";
}

/**
 * Plan W11.L2: the beta metrics, from the weekly opt-in beta reports
 * (`kind: "lumen-beta-report"`, src/beta/programme.ts) that testers sent.
 * One report per tester per week; the folder for a receipt holds one week.
 * Reports carry no id, so a tester who sent two in the same folder counts
 * twice: whoever collects them keeps the latest one per tester.
 *
 *   - optInUsers: reports in the folder (every report is an opt-in);
 *   - testersWeek1: reports from testers at least one week into the beta;
 *   - activationRate: activated / reports whose activation is decided
 *     (W11.P4: own note or import, plus a second-day return within 7 days);
 *   - d7 / d30: retained7 / retained30 true over the reports where it is
 *     known (W4.26's retention: did they come back).
 *
 * A rate over 0 known reports is null, never 0 or 1.
 */
export function aggregateBetaReports(reports) {
  const list = (Array.isArray(reports) ? reports : []).filter((r) => r && r.kind === "lumen-beta-report");
  const rate = (pick) => {
    const known = list.map(pick).filter((v) => v === true || v === false);
    return known.length ? Math.round((known.filter(Boolean).length / known.length) * 1000) / 1000 : null;
  };
  const weeks = new Set(list.map((r) => r.week).filter(Boolean));
  return {
    reports: list.length,
    weeks: [...weeks].sort(),
    optInUsers: list.length,
    testersWeek1: list.filter((r) => Number(r.weeksInBeta) >= 1).length,
    activationRate: rate((r) => r.activation?.activated),
    d7: rate((r) => r.retained7),
    d30: rate((r) => r.retained30),
  };
}

/** docs/launch/ga-checklist.md, built from milestones.json (W11.L2). */
export function checklistMarkdown(data) {
  const out = [
    "<!-- Built from docs/launch/milestones.json by `npm run launch:gate -- --checklist`. Do not edit by hand: `--check` fails when this file differs. -->",
    "",
    "# Launch checklist: M1–M4 and 1.0 GA / רשימת השקה",
    "",
    "Each item is a criterion in `docs/launch/milestones.json`. It names the plan acceptance it maps to and the receipt that proves it (`docs/launch/receipts/<milestone>/<criterion>.json`). `npm run launch:gate -- <milestone>` prints every open item. A box is ticked only by a valid receipt, never by hand.",
    "",
    "כל פריט הוא קריטריון ב-`docs/launch/milestones.json`, עם קבלת התוכנית שהוא ממופה אליה והקבלה שמוכיחה אותו. `npm run launch:gate -- <אבן דרך>` מדפיס כל פריט פתוח.",
    "",
  ];
  const proof = (r) => {
    if (r.kind === "test") return `test: ${r.tests.map((t) => `\`${t}\``).join(", ")}`;
    if (r.kind === "run") return `run: ${r.runs.map((t) => `\`${t}\``).join(", ")}`;
    if (r.kind === "owner") return `owner facts: ${r.facts.map((t) => `\`${t}\``).join(", ")}`;
    return `metric (${r.from}): ${r.metrics.map((m) => `\`${m.name}\` ${typeof m.min === "number" ? `≥ ${m.min}` : ""}${typeof m.min === "number" && typeof m.max === "number" ? ", " : ""}${typeof m.max === "number" ? `≤ ${m.max}` : ""}`).join("; ")}`;
  };
  for (const m of data.milestones) {
    out.push(`## ${m.id}: ${m.title.en} / ${m.title.he}`, "");
    const meta = [m.target ? `Target: ${m.target}.` : "", m.after ? `Opens after ${m.after} passes.` : ""].filter(Boolean).join(" ");
    if (meta) out.push(meta, "");
    let group = null;
    for (const c of m.criteria) {
      if (c.group && c.group !== group) {
        group = c.group;
        out.push(`**${group}**`, "");
      }
      out.push(`- [ ] **${c.id}**: ${c.en}`);
      out.push(`  - ${c.he}`);
      out.push(`  - Source: ${c.source.task}${c.source.research ? ` (${c.source.research})` : ""}: ${c.source.acceptance}`);
      out.push(`  - Proof: ${proof(c.receipt)}`);
    }
    out.push("");
  }
  return out.join("\n");
}
