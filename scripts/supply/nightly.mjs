#!/usr/bin/env node
/**
 * The supply-chain checks of the nightly, without GitHub Actions (plan
 * W11.S5, research R3.7). Scorecard and CodeQL exist only as Actions YAML,
 * so neither ever ran; this runs the checks on the owner's machine and puts
 * the results in a sealed receipt (scripts/nightly/receipt.mjs).
 *
 *   scorecard   OSSF Scorecard on github.com/talstilkol/lumen-md, JSON. Needs
 *               GITHUB_AUTH_TOKEN: a fine-grained token with read-only access.
 *   osv         osv-scanner on package-lock.json, mcp-server/package-lock.json
 *               and src-tauri/Cargo.lock
 *   cargo-deny  cargo deny check advisories bans (src-tauri)
 *   sbom        syft → CycloneDX JSON
 *
 *   node scripts/supply/nightly.mjs              run what is installed; sealed
 *                                                receipt → reports/nightly/<date>-supply.json
 *   node scripts/supply/nightly.mjs --dry-run    run nothing (no network); the receipt
 *                                                says why each check was skipped
 *   … --out <file>          also write the unsealed summary there (scripts/nightly/run.mjs
 *                           reads it and seals it into its own report)
 *   … --no-seal             do not write a sealed receipt (with --out)
 *   … --receipt <file>      the sealed receipt goes here instead
 *   … --open-tasks          open a GitHub issue for each new task (`gh issue create`);
 *                           without it the tasks are only listed in the receipt
 *
 * A skipped check never counts as passed: its gate is "unmeasured". The
 * gates are the acceptance of W11.S5 / W11.M8 and must never be lowered:
 * Scorecard aggregate ≥ 7.0, Branch-Protection ≥ 8, Code-Review ≥ 8,
 * Dangerous-Workflow 10, OSV 0 critical.
 *
 * A task is opened when the Scorecard aggregate drops below the previous
 * receipt's, a gated check is below its floor, OSV finds a critical or high
 * vulnerability, or cargo deny reports an error. Tasks have a stable key, so
 * the same finding does not open a second issue.
 *
 * Exit 1 when a gate failed or a check errored; 0 when all ran green or were
 * skipped (a skipped gate is reported, not passed).
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOrCreateKey, seal } from "../nightly/receipt.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const REPO = "github.com/talstilkol/lumen-md";
export const OUT_DIR = "reports/supply";
export const NIGHTLY_DIR = "reports/nightly";
export const LOCKFILES = ["package-lock.json", "mcp-server/package-lock.json", "src-tauri/Cargo.lock"];

/** The floors. Never lower them (raising is fine). */
export const GATES = Object.freeze({
  scorecardAggregate: 7.0,
  scorecardChecks: Object.freeze({ "Branch-Protection": 8, "Code-Review": 8, "Dangerous-Workflow": 10 }),
  osvCritical: 0,
});

/**
 * The checks: binary, whether they need the network, what else they need,
 * and the command. `stdout` captures the command's stdout into that file.
 * `findingsExit` are exit codes that mean "ran, found something" (the output
 * is still parsed), not "failed to run".
 */
export const CHECKS = [
  {
    id: "scorecard",
    bin: "scorecard",
    network: true,
    env: "GITHUB_AUTH_TOKEN",
    install: "https://github.com/ossf/scorecard/releases; a fine-grained GitHub token with read-only repository access in GITHUB_AUTH_TOKEN",
    cmd: ["scorecard", `--repo=${REPO}`, "--format", "json", "--show-details"],
    stdout: `${OUT_DIR}/scorecard.json`,
  },
  {
    id: "osv",
    bin: "osv-scanner",
    network: true,
    install: "https://github.com/google/osv-scanner/releases (v2)",
    cmd: ["osv-scanner", "scan", "source", "--format", "json", ...LOCKFILES.map((f) => `--lockfile=${f}`)],
    stdout: `${OUT_DIR}/osv.json`,
    findingsExit: [1],
  },
  {
    id: "cargo-deny",
    bin: "cargo-deny",
    network: true,
    install: "cargo install cargo-deny --locked (it fetches the RustSec advisory database)",
    cmd: ["cargo-deny", "--manifest-path", "src-tauri/Cargo.toml", "--format", "json", "check", "advisories", "bans"],
    stderr: `${OUT_DIR}/cargo-deny.jsonl`,
    findingsExit: [1],
  },
  {
    id: "sbom",
    bin: "syft",
    network: false,
    install: "https://github.com/anchore/syft/releases",
    cmd: ["syft", "dir:.", "-o", `cyclonedx-json=${OUT_DIR}/sbom.cdx.json`],
    file: `${OUT_DIR}/sbom.cdx.json`,
  },
];

/** Is `bin` on PATH? */
export function onPath(bin, env = process.env) {
  for (const d of String(env.PATH ?? "").split(":")) if (d && existsSync(join(d, bin))) return true;
  return false;
}

/**
 * What to do with each check: run it, or skip it with a reason.
 * → [{ id, action: "run" | "skip", why? }]
 */
export function planChecks({ dryRun = false, hasBin = onPath, env = process.env, only = null } = {}) {
  return CHECKS.filter((c) => !only || only.includes(c.id)).map((c) => {
    if (dryRun) return { id: c.id, action: "skip", why: `dry-run: nothing run${c.network ? ", and this check needs the network" : ""}${hasBin(c.bin) ? "" : `; ${c.bin} is not installed either (${c.install})`}` };
    if (!hasBin(c.bin)) return { id: c.id, action: "skip", why: `${c.bin} is not installed (${c.install})` };
    if (c.env && !env[c.env]) return { id: c.id, action: "skip", why: `${c.env} is not set (${c.install})` };
    return { id: c.id, action: "run" };
  });
}

// ---------------------------------------------------------------- parsers

/** Scorecard's JSON → { aggregate, version, commit, checks: { name: score } }. -1 (inconclusive) stays -1. */
export function parseScorecard(json) {
  const j = typeof json === "string" ? JSON.parse(json) : json;
  if (typeof j?.score !== "number" || !Array.isArray(j.checks)) throw new Error("not a Scorecard JSON result (no score or checks)");
  const checks = {};
  for (const c of j.checks) if (c?.name) checks[c.name] = typeof c.score === "number" ? c.score : -1;
  return { aggregate: j.score, version: j.scorecard?.version ?? null, commit: j.repo?.commit ?? null, checks };
}

const RANK = { unknown: 0, low: 1, medium: 2, high: 3, critical: 4 };
/** A CVSS base score → the CVSS v3 qualitative band. */
export function band(score) {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return "unknown";
  return n >= 9 ? "critical" : n >= 7 ? "high" : n >= 4 ? "medium" : "low";
}
const dbBand = (s) => ({ CRITICAL: "critical", HIGH: "high", MODERATE: "medium", MEDIUM: "medium", LOW: "low" })[String(s ?? "").toUpperCase()] ?? "unknown";

/**
 * osv-scanner's JSON → { counts: {critical, high, medium, low, unknown}, findings: [{ id, aliases, package, version, ecosystem, source, severity }] }.
 * One finding per group (osv-scanner groups aliases of the same vulnerability). The severity
 * is the higher of the group's max CVSS score and the advisory database's own label.
 */
export function parseOsv(json) {
  const j = typeof json === "string" ? (json.trim() ? JSON.parse(json) : { results: [] }) : json;
  if (!j || !Array.isArray(j.results)) throw new Error("not an osv-scanner JSON result (no results)");
  const counts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  const findings = [];
  for (const r of j.results)
    for (const p of r.packages ?? []) {
      const vulns = new Map((p.vulnerabilities ?? []).map((v) => [v.id, v]));
      const groups = p.groups?.length ? p.groups : [...vulns.keys()].map((id) => ({ ids: [id] }));
      for (const g of groups) {
        const ids = g.ids ?? [];
        let sev = band(g.max_severity);
        for (const id of ids) {
          const d = dbBand(vulns.get(id)?.database_specific?.severity);
          if (RANK[d] > RANK[sev]) sev = d;
        }
        const id = [...ids].sort()[0] ?? "?";
        const aliases = [...new Set([...ids, ...(g.aliases ?? []), ...ids.flatMap((i) => vulns.get(i)?.aliases ?? [])])].filter((a) => a !== id).sort();
        counts[sev]++;
        findings.push({ id, aliases, package: p.package?.name ?? "?", version: p.package?.version ?? "?", ecosystem: p.package?.ecosystem ?? "?", source: String(r.source?.path ?? "").replace(/^.*?((mcp-server\/)?package-lock\.json|src-tauri\/Cargo\.lock)$/, "$1"), severity: sev });
      }
    }
  findings.sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.id.localeCompare(b.id));
  return { counts, findings };
}

/** cargo deny's --format json (one JSON object per line on stderr) → { errors, warnings, advisories: [id], bans: [message] }. */
export function parseCargoDeny(text) {
  let errors = 0;
  let warnings = 0;
  const advisories = new Set();
  const bans = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type !== "diagnostic") continue;
    const f = o.fields ?? {};
    if (f.severity === "error") errors++;
    else if (f.severity === "warning") warnings++;
    else continue;
    if (f.advisory?.id) advisories.add(f.advisory.id);
    else if (f.severity === "error") bans.push(String(f.message ?? f.code ?? "?"));
  }
  return { errors, warnings, advisories: [...advisories].sort(), bans };
}

/** A CycloneDX JSON SBOM → { format, specVersion, components, sha256 }. */
export function parseSbom(text) {
  const j = JSON.parse(text);
  if (j.bomFormat !== "CycloneDX") throw new Error("not a CycloneDX SBOM");
  return { format: "CycloneDX", specVersion: j.specVersion ?? null, components: (j.components ?? []).length, sha256: createHash("sha256").update(text).digest("hex") };
}

// ------------------------------------------------------------------ gates

/**
 * The gates over the parsed results → [{ gate, status: "pass" | "fail" | "unmeasured", value, floor }].
 * A check that did not run leaves its gates "unmeasured", never "pass".
 */
export function evaluateGates(results) {
  const out = [];
  const sc = results.scorecard?.parsed;
  out.push({ gate: "scorecard.aggregate", floor: GATES.scorecardAggregate, value: sc?.aggregate ?? null, status: !sc ? "unmeasured" : sc.aggregate >= GATES.scorecardAggregate ? "pass" : "fail" });
  for (const [name, floor] of Object.entries(GATES.scorecardChecks)) {
    const v = sc ? (sc.checks[name] ?? null) : null;
    out.push({ gate: `scorecard.${name}`, floor, value: v, status: !sc ? "unmeasured" : typeof v === "number" && v >= floor ? "pass" : "fail" });
  }
  const osv = results.osv?.parsed;
  out.push({ gate: "osv.critical", floor: GATES.osvCritical, value: osv?.counts.critical ?? null, status: !osv ? "unmeasured" : osv.counts.critical <= GATES.osvCritical ? "pass" : "fail" });
  return out;
}

/**
 * The tasks this run opens: Scorecard below the previous receipt or below a
 * floor, each critical or high OSV finding, cargo deny errors.
 * `previous` is the last supply summary (or null). → [{ key, title, body }]
 */
export function tasksFor(results, gates, previous = null) {
  const tasks = [];
  const sc = results.scorecard?.parsed;
  const prev = previous?.results?.scorecard?.parsed;
  if (sc && prev && sc.aggregate < prev.aggregate)
    tasks.push({ key: `supply:scorecard-drop:${sc.aggregate}`, title: `Scorecard dropped from ${prev.aggregate} to ${sc.aggregate}`, body: `Checks that went down: ${Object.entries(sc.checks).filter(([k, v]) => typeof prev.checks[k] === "number" && v < prev.checks[k]).map(([k, v]) => `${k} ${prev.checks[k]} → ${v}`).join(", ") || "none individually"}.` });
  for (const g of gates.filter((x) => x.status === "fail" && x.gate.startsWith("scorecard.")))
    tasks.push({ key: `supply:${g.gate}`, title: `${g.gate.replace("scorecard.", "Scorecard ")} is ${g.value ?? "missing"}, below ${g.floor}`, body: `Gate from W11.S5 / W11.M8: ${g.gate} ≥ ${g.floor}.` });
  for (const f of results.osv?.parsed?.findings ?? [])
    if (f.severity === "critical" || f.severity === "high")
      tasks.push({ key: `supply:osv:${f.id}:${f.package}`, title: `${f.severity} vulnerability ${f.id} in ${f.package} ${f.version} (${f.ecosystem})`, body: `In ${f.source}. Aliases: ${f.aliases.join(", ") || "none"}.` });
  const cd = results["cargo-deny"]?.parsed;
  if (cd?.errors) tasks.push({ key: `supply:cargo-deny:${[...cd.advisories, ...cd.bans].join(",")}`, title: `cargo deny: ${cd.errors} error(s)`, body: `Advisories: ${cd.advisories.join(", ") || "none"}. Bans: ${cd.bans.join("; ") || "none"}.` });
  return tasks;
}

// ------------------------------------------------------------------ running

export function runCheck(c, cwd, env = process.env) {
  const t0 = Date.now();
  const r = spawnSync(c.cmd[0], c.cmd.slice(1), { cwd, encoding: "utf8", maxBuffer: 256 << 20, timeout: 30 * 60_000, env });
  if (c.stdout) writeFileSync(join(cwd, c.stdout), r.stdout ?? "");
  if (c.stderr) writeFileSync(join(cwd, c.stderr), r.stderr ?? "");
  const status = r.status ?? String(r.signal ?? r.error?.code ?? "error");
  const res = { status, ms: Date.now() - t0, cmd: c.cmd.join(" ") };
  if (status !== 0 && !(c.findingsExit ?? []).includes(status)) return { ...res, outcome: "error", error: `${c.cmd[0]} exited ${status}: ${String(r.stderr ?? "").trim().split("\n").slice(-3).join(" | ").slice(0, 400)}` };
  try {
    const text = c.stdout ? r.stdout : c.stderr ? r.stderr : readFileSync(join(cwd, c.file), "utf8");
    const parsed = c.id === "scorecard" ? parseScorecard(text) : c.id === "osv" ? parseOsv(text) : c.id === "cargo-deny" ? parseCargoDeny(text) : parseSbom(text);
    return { ...res, outcome: "ran", parsed };
  } catch (e) {
    return { ...res, outcome: "error", error: `could not read ${c.id}'s output: ${e.message}` };
  }
}

/** The newest supply summary in reports/nightly (the previous run), or null. */
export function previousSummary(dir) {
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir)
    .filter((n) => /^\d{4}-\d{2}-\d{2}-supply(-\d+)?\.json$/.test(n))
    .sort()
    .pop();
  if (!f) return null;
  try {
    const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
    return j.dryRun ? null : j;
  } catch {
    return null;
  }
}

/** Run (or plan) every check and build the summary the receipt seals. */
export function runSupply({ cwd = root, dryRun = false, hasBin = onPath, env = process.env, only = null, run = runCheck, previous = previousSummary(join(cwd, NIGHTLY_DIR)), now = new Date() } = {}) {
  mkdirSync(join(cwd, OUT_DIR), { recursive: true });
  const results = {};
  for (const p of planChecks({ dryRun, hasBin, env, only })) {
    const c = CHECKS.find((x) => x.id === p.id);
    results[p.id] = p.action === "skip" ? { outcome: "skipped", skipReason: p.why, cmd: c.cmd.join(" ") } : run(c, cwd, env);
  }
  const gates = evaluateGates(results);
  const tasks = dryRun ? [] : tasksFor(results, gates, previous);
  return {
    version: 1,
    kind: "supply",
    dryRun,
    startedAt: now.toISOString(),
    repo: REPO,
    gates,
    results,
    tasks,
    summary: {
      ran: Object.values(results).filter((r) => r.outcome === "ran").length,
      skipped: Object.values(results).filter((r) => r.outcome === "skipped").length,
      errored: Object.values(results).filter((r) => r.outcome === "error").length,
      gatesFailed: gates.filter((g) => g.status === "fail").length,
      gatesUnmeasured: gates.filter((g) => g.status === "unmeasured").length,
    },
  };
}

/** The exit code of a summary: 1 when a gate failed or a check errored. */
export const exitCode = (s) => (s.summary.gatesFailed || s.summary.errored ? 1 : 0);

/** `gh issue create` for each task whose key no open issue already carries. */
function openTasks(tasks) {
  for (const t of tasks) {
    const found = spawnSync("gh", ["issue", "list", "--state", "open", "--search", `"${t.key}" in:body`, "--json", "number", "-q", "length"], { encoding: "utf8" });
    if (found.status === 0 && Number(found.stdout.trim()) > 0) {
      console.log(`  task already open: ${t.key}`);
      continue;
    }
    const r = spawnSync("gh", ["issue", "create", "--title", `[supply] ${t.title}`, "--body", `${t.body}\n\nOpened by scripts/supply/nightly.mjs (W11.S5).\nkey: \`${t.key}\``, "--label", "supply-chain"], { stdio: "inherit" });
    if (r.status !== 0) console.error(`✗ could not open the task ${t.key}`);
  }
}

function main(argv) {
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const dryRun = argv.includes("--dry-run");
  const s = runSupply({ dryRun, only: opt("only")?.split(",") ?? null });
  for (const [id, r] of Object.entries(s.results)) console.log(`${r.outcome === "ran" ? "✓" : r.outcome === "skipped" ? "-" : "✗"} ${id}: ${r.outcome}${r.skipReason ? `, ${r.skipReason}` : r.error ? `, ${r.error}` : ""}`);
  for (const g of s.gates) console.log(`  gate ${g.gate} ${g.gate === "osv.critical" ? "≤" : "≥"} ${g.floor}: ${g.status}${g.value === null ? "" : ` (${g.value})`}`);
  for (const t of s.tasks) console.log(`  task: ${t.title}`);
  const out = opt("out");
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, JSON.stringify(s, null, 2) + "\n");
  }
  if (!argv.includes("--no-seal")) {
    const { privateKeyPem } = loadOrCreateKey();
    let file = opt("receipt");
    if (!file) {
      const dir = join(root, dryRun ? OUT_DIR : NIGHTLY_DIR);
      mkdirSync(dir, { recursive: true });
      const d = s.startedAt.slice(0, 10);
      if (dryRun) file = join(dir, `dry-run-receipt.json`);
      else for (let i = 1; ; i++) if (!existsSync((file = join(dir, `${d}-supply${i > 1 ? `-${i}` : ""}.json`)))) break;
    }
    writeFileSync(file, JSON.stringify(seal(s, privateKeyPem), null, 2) + "\n");
    console.log(`receipt → ${file}${dryRun ? " (dry run: not a measurement)" : ""}`);
  }
  if (argv.includes("--open-tasks") && !dryRun) openTasks(s.tasks);
  return exitCode(s);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
