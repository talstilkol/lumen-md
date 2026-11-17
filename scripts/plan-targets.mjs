#!/usr/bin/env node
/**
 * npm run plan:targets (plan 13.6, W10.E13): the final audit against the
 * targets of MASTER_PLAN.md appendix 14 ("הטובה בעולם בתחומה").
 *
 * plan/targets.json holds one entry per clause of the appendix's table (the
 * target cell split at "; "), each with the evidence that measures it. This
 * script computes each target's status; nothing in the file says "pass":
 *   pass          every evidence passed
 *   fail          an evidence failed
 *   not measured  anything else: no result yet, no tool yet, needs the owner,
 *                 or not run (vitest and command evidence run only with --run).
 *                 It is shown as such, never as a pass.
 *
 * Evidence types:
 *   e2e     the signed e2e report for HEAD, reports/e2e-<sha>.json (W10.E39):
 *           passes when the run was green and the spec is in its project and
 *           browsers; fails when one of the report's failures is in the spec
 *   vitest  `npx vitest run <file>` (with --run)
 *   command a shell command, exit 0 (with --run)
 *   json    a value in a result file against a bound (`-1` is the last item)
 *   grep    0 matches of a pattern under paths (computed here, every time)
 *   none    a reason it cannot be measured here (owner, hardware, a model)
 *
 *   npm run plan:targets                     # the report (markdown)
 *   npm run plan:targets -- --run            # also run the vitest and command evidence
 *   npm run plan:targets -- --run --runner <cmd>   # vitest files through an offline runner: <cmd> <root> <file>
 *   npm run plan:targets -- --json           # the report as JSON
 *   npm run plan:targets -- --check          # exit 1 when an appendix clause has no target (or the text drifted)
 *   npm run plan:targets -- --strict         # exit 1 unless every target passed
 *   --out <file>                             # also write the markdown there
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PASS = "pass";
export const FAIL = "fail";
export const NOT = "not measured";

/** MASTER_PLAN.md's appendix 14 table → [{ area, clauses: [text] }]. */
export function parseAppendix(md) {
  const start = md.indexOf("## נספח 14");
  if (start < 0) throw new Error("MASTER_PLAN.md has no appendix 14 (## נספח 14)");
  const end = md.indexOf("\n## ", start + 4);
  const rows = [];
  for (const line of md.slice(start, end < 0 ? undefined : end).split("\n")) {
    const m = /^\| \*\*(.+?)\*\* \| (.+?) \| (.+?) \| (.+?) \|$/.exec(line);
    if (m) rows.push({ area: m[1], clauses: m[2].split("; ").map((c) => c.trim()) });
  }
  return rows;
}

/** Every clause has exactly one target with the same text, and no target points at nothing. */
export function coverage(rows, targets) {
  const problems = [];
  const ids = new Set();
  for (const t of targets) {
    if (ids.has(t.id)) problems.push(`target id ${t.id} is used twice`);
    ids.add(t.id);
    if (!Array.isArray(t.evidence) || !t.evidence.length) problems.push(`${t.id}: no evidence`);
  }
  for (const r of rows)
    r.clauses.forEach((text, i) => {
      const ts = targets.filter((t) => t.area === r.area && t.clause === i);
      if (!ts.length) problems.push(`${r.area} #${i + 1} has no target: "${text}"`);
      else if (ts.length > 1) problems.push(`${r.area} #${i + 1} has ${ts.length} targets`);
      else if (ts[0].target !== text) problems.push(`${ts[0].id}: the appendix now says "${text}", the target says "${ts[0].target}"`);
    });
  for (const t of targets) if (!rows.some((r) => r.area === t.area && t.clause >= 0 && t.clause < r.clauses.length)) problems.push(`${t.id}: ${t.area} #${t.clause + 1} is not in the appendix`);
  const clauses = rows.reduce((n, r) => n + r.clauses.length, 0);
  const mapped = rows.reduce((n, r) => n + r.clauses.filter((_, i) => targets.some((t) => t.area === r.area && t.clause === i)).length, 0);
  return { ok: problems.length === 0, problems, clauses, mapped };
}

/** "a.b.-1.c" in an object; `-1` is the last element of an array. */
export function at(obj, path) {
  let v = obj;
  for (const k of String(path).split(".")) {
    if (v === null || v === undefined) return undefined;
    v = Array.isArray(v) && /^-\d+$/.test(k) ? v[v.length + Number(k)] : v[k];
  }
  return v;
}

const OPS = { ">=": (a, b) => a >= b, ">": (a, b) => a > b, "<=": (a, b) => a <= b, "<": (a, b) => a < b, "==": (a, b) => a === b };

const SOURCE = /\.(m?[jt]sx?|cjs)$/;
function* files(root, rel) {
  const p = join(root, rel);
  if (!existsSync(p)) return;
  if (statSync(p).isFile()) {
    yield rel;
    return;
  }
  for (const f of readdirSync(p)) {
    if (f === "node_modules" || f.startsWith(".") || f === "__snapshots__" || f === "fixtures") continue;
    const r = join(rel, f);
    if (statSync(join(root, r)).isDirectory()) yield* files(root, r);
    else if (SOURCE.test(f)) yield r;
  }
}

/**
 * Matches of `pattern` under `paths` (minus `exclude` prefixes), as "file:line".
 * A match on a line that is a // comment up to it is prose, not code, and is not counted.
 */
export function grepCount(root, pattern, paths, exclude = []) {
  const re = new RegExp(pattern, "g");
  const hits = [];
  for (const rel of paths) {
    for (const f of files(root, rel)) {
      if (exclude.some((x) => f === x || f.startsWith(x.endsWith("/") ? x : `${x}/`))) continue;
      const text = readFileSync(join(root, f), "utf8");
      for (const m of text.matchAll(re)) {
        const lineStart = text.lastIndexOf("\n", m.index) + 1;
        if (/^\s*(\/\/|\*|\/\*)/.test(text.slice(lineStart, m.index))) continue;
        hits.push(`${f}:${text.slice(0, m.index).split("\n").length}`);
      }
    }
  }
  return hits;
}

/**
 * One evidence → { status, detail }.
 * ctx: { root, run: boolean, e2e: report|null, e2eProblem: string|null, exec(cmd, args) → exit code }
 */
export function evaluate(ev, ctx) {
  const { root } = ctx;
  switch (ev.type) {
    case "none":
      return { status: NOT, detail: ev.reason };
    case "grep": {
      const missing = ev.paths.filter((p) => !existsSync(join(root, p)));
      if (missing.length === ev.paths.length) return { status: NOT, detail: `nothing to scan: ${missing.join(", ")}` };
      const hits = grepCount(root, ev.pattern, ev.paths, ev.exclude ?? []);
      return hits.length <= (ev.max ?? 0) ? { status: PASS, detail: `0 matches of /${ev.pattern}/ in ${ev.paths.join(", ")}${ev.exclude?.length ? ` (not ${ev.exclude.join(", ")})` : ""}` } : { status: FAIL, detail: `${hits.length} matches of /${ev.pattern}/: ${hits.slice(0, 5).join(", ")}${hits.length > 5 ? ", …" : ""}` };
    }
    case "json": {
      const f = join(root, ev.file);
      if (!existsSync(f)) return { status: NOT, detail: `no result yet: ${ev.file}` };
      let v;
      try {
        v = at(JSON.parse(readFileSync(f, "utf8")), ev.path);
      } catch {
        return { status: NOT, detail: `${ev.file} is not JSON` };
      }
      if (typeof v !== "number") return { status: NOT, detail: `${ev.file}: ${ev.path} is not a number (${JSON.stringify(v)})` };
      return { status: OPS[ev.op](v, ev.value) ? PASS : FAIL, detail: `${ev.file}: ${ev.path} = ${v} (target ${ev.op} ${ev.value})` };
    }
    case "vitest":
    case "command": {
      if (ev.type === "vitest" && !existsSync(join(root, ev.file))) return { status: NOT, detail: `no measurement yet: ${ev.file} does not exist` };
      // --runner <cmd>: a vitest file goes through an offline runner (`<cmd> <root> <file>`, as dod --runner).
      const what = ev.type === "vitest" ? (ctx.runner ? `${shq(ctx.runner)} ${shq(ctx.root)} ${shq(ev.file)}` : `npx vitest run ${ev.file}`) : ev.cmd;
      if (!ctx.run) return { status: NOT, detail: `not run (--run runs \`${what}\`)` };
      const code = ctx.exec(what);
      return { status: code === 0 ? PASS : FAIL, detail: `\`${what}\` exit ${code}` };
    }
    case "e2e": {
      if (!existsSync(join(root, ev.spec))) return { status: NOT, detail: `no measurement yet: ${ev.spec} does not exist` };
      if (!ctx.e2e) return { status: NOT, detail: ctx.e2eProblem ?? "no e2e report for HEAD" };
      const r = ctx.e2e;
      const failures = (r.shards ?? []).flatMap((s) => s.failures ?? []).filter((f) => String(f.where).startsWith(`${ev.spec}:`));
      if (failures.length) return { status: FAIL, detail: `${failures.length} failed in ${ev.spec}: ${failures.slice(0, 3).map((f) => f.where).join(", ")}` };
      if (ev.project !== r.project) return { status: NOT, detail: `the e2e report covers the ${r.project} project; this needs ${ev.project}` };
      const others = ev.browsers.filter((b) => b !== r.project);
      if (others.length) return { status: NOT, detail: `the e2e report is ${r.project} only; this needs ${others.join(" and ")} too` };
      if (r.ok !== true) return { status: NOT, detail: "the e2e run was red elsewhere, so this spec's own outcome is not known" };
      return { status: PASS, detail: `${ev.spec} green in reports/e2e-${String(r.commit?.sha).slice(0, 12)}…json` };
    }
    default:
      return { status: NOT, detail: `unknown evidence type ${ev.type}` };
  }
}

/** Every evidence passed → pass; one failed → fail; else not measured. */
export function combine(results) {
  if (results.some((r) => r.status === FAIL)) return FAIL;
  if (results.length && results.every((r) => r.status === PASS)) return PASS;
  return NOT;
}

export function audit(targets, ctx) {
  const rows = targets.map((t) => {
    const results = t.evidence.map((ev) => ({ type: ev.type, ...evaluate(ev, ctx) }));
    return { id: t.id, area: t.area, clause: t.clause, target: t.target, status: combine(results), evidence: results };
  });
  const counts = { [PASS]: 0, [FAIL]: 0, [NOT]: 0 };
  for (const r of rows) counts[r.status]++;
  return { counts, rows };
}

/** A shell-quoted argument. */
const shq = (x) => `'${String(x).replace(/'/g, "'\\''")}'`;

const mark = { [PASS]: "✅ pass", [FAIL]: "❌ fail", [NOT]: "⬜ not measured" };
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

export function markdown(result, cov, head) {
  const lines = [
    `# Appendix 14 targets (plan 13.6)`,
    "",
    `Commit ${head ?? "?"} · ${cov.mapped}/${cov.clauses} clauses mapped · ${result.counts[PASS]} pass · ${result.counts[FAIL]} fail · ${result.counts[NOT]} not measured`,
    "",
    "| area | target | status | evidence |",
    "|---|---|---|---|",
  ];
  for (const r of result.rows) lines.push(`| ${cell(r.area)} | ${cell(r.target)} | ${mark[r.status]} | ${cell(r.evidence.map((e) => `${e.type}: ${e.detail}`).join(" · "))} |`);
  if (!cov.ok) lines.push("", "Mapping problems:", ...cov.problems.map((p) => `- ${p}`));
  return lines.join("\n") + "\n";
}

/** The e2e report for `sha` under root/reports/, its digest checked (and its signature with a key). */
export async function loadE2e(root, sha, keyPem = null) {
  const f = join(root, "reports", `e2e-${sha}.json`);
  if (!existsSync(f)) return { report: null, problem: `no e2e report for HEAD (reports/e2e-${sha?.slice(0, 12)}….json; W10.E39)` };
  let report;
  try {
    report = JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return { report: null, problem: `reports/e2e-${sha.slice(0, 12)}….json is not JSON` };
  }
  const { check } = await import("./nightly/receipt.mjs");
  const v = check(report, keyPem);
  if (!v.ok) return { report: null, problem: `the e2e report does not hold: ${v.problems.join("; ")}` };
  if (report.commit?.sha !== sha) return { report: null, problem: "the e2e report is for another commit" };
  return { report, problem: null };
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = resolve(opt("root") ?? join(fileURLToPath(new URL(".", import.meta.url)), ".."));
  const rows = parseAppendix(readFileSync(join(root, "MASTER_PLAN.md"), "utf8"));
  const { targets } = JSON.parse(readFileSync(join(root, "plan/targets.json"), "utf8"));
  const cov = coverage(rows, targets);
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout?.trim() || null;
  const { report, problem } = head ? await loadE2e(root, head, opt("key") ? readFileSync(opt("key"), "utf8") : null) : { report: null, problem: "not a git checkout" };
  const exec = (cmd) => spawnSync("sh", ["-c", cmd], { cwd: root, stdio: "inherit" }).status ?? 1;
  const result = audit(targets, { root, run: argv.includes("--run"), runner: opt("runner") ?? null, e2e: report, e2eProblem: problem, exec });
  if (argv.includes("--json")) console.log(JSON.stringify({ commit: head, coverage: cov, ...result }, null, 2));
  else {
    const md = markdown(result, cov, head?.slice(0, 12));
    process.stdout.write(md);
    if (opt("out")) writeFileSync(opt("out"), md);
  }
  if (!cov.ok) {
    for (const p of cov.problems) console.error(`✗ ${p}`);
    process.exit(1);
  }
  if (argv.includes("--strict") && result.counts[PASS] !== result.rows.length) process.exit(1);
  if (argv.includes("--check")) console.error(`✓ plan:targets: ${cov.mapped}/${cov.clauses} clauses of appendix 14 are mapped (${relative(process.cwd(), join(root, "plan/targets.json"))})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
