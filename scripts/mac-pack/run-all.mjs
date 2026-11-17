#!/usr/bin/env node
/**
 * The whole Mac pack in one command (integrator INT6a, wave g6).
 *
 *   npm run mac:pack                    run every entry of every plan/mac-pack/L*.json
 *   npm run mac:pack -- --list          what would run, how, and in which order; run nothing
 *   npm run mac:pack -- --only <id|lane>[,…]   run only those (an id, or a lane such as L3)
 *   npm run mac:pack -- --dry           print each rewritten command; run nothing
 *
 * How it runs:
 *  1. Shared steps, each once: the install (`npm ci` + the three browsers),
 *     ONE Playwright run of the whole e2e suite on chromium, firefox and
 *     webkit (reports/mac-pack/shared/e2e.pw.json), and `npm run models:day -- --yes`.
 *     A step runs only when some picked entry needs it.
 *  2. The entries, the ones they name in `needs` first. A top-level segment
 *     that repeats a shared step becomes `true`; a
 *     `npx playwright test <specs> --project=…` segment reads its slice of the
 *     shared report (scripts/mac-pack/pw-from-shared.mjs). Two entries with the
 *     same command (the L8 golden batch, `nightly --status`) run it once.
 *     `<lane>.setup` entries are the shared install. An entry `node X <id>`
 *     whose lane also has `node X all` is judged from the files `all` wrote.
 *     An entry that moves the checked-out branch (`git switch`, `git pull`)
 *     never runs inside the aggregate: run it alone with --only.
 *  3. Each entry's `expect`, in whatever shape its lane wrote it, is checked
 *     (scripts/mac-pack/lib/expect.mjs). Every entry that runs must exit 0
 *     unless its expect names another exit code. A result file counts only
 *     when it was written during this run: a JSON or file check reads only
 *     fresh files, and before an entry runs, the older files its shell
 *     `check` would read are moved aside and put back afterwards
 *     (scripts/mac-pack/lib/fresh.mjs), so a committed or left-over result
 *     never passes. The shared e2e step holds only when its report was
 *     written by this run. What only a person can judge is listed, never
 *     counted as a pass.
 *  4. reports/mac-pack/summary.json and summary.md; logs in reports/mac-pack/logs/.
 *     The result is "ok" only when every picked entry passed on machine
 *     checks alone; "not ok" when any failed or was blocked (exit 1);
 *     "incomplete" when none failed but some still need their own run or a
 *     person (exit 3). Only "ok" exits 0.
 *
 * reports/ is git-ignored by .gitignore (/reports/*), not only by a clone's
 * .git/info/exclude; the run checks that with `git check-ignore` and says so
 * in the summary when it is not.
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { judge, normalize } from "./lib/expect.mjs";
import { CLOCK_SLACK_MS, restoreAll, restoreAside, setAside } from "./lib/fresh.mjs";
import { SHARED_CMDS, movesHead, parsePlaywright, rewrite, sharedKind, splitTop } from "./lib/shell.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = resolve(HERE, "../..");
export const OUT_DIR = "reports/mac-pack";
const SHARED_REPORT = `${OUT_DIR}/shared/e2e.pw.json`;

// ── load and classify ─────────────────────────────────────────────────────

/** Every entry of every plan/mac-pack/L*.json, in lane then file order. */
export function loadPacks(root) {
  const dir = join(root, "plan/mac-pack");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^L\d+\.json$/.test(f)).sort((a, b) => Number(a.slice(1, -5)) - Number(b.slice(1, -5))) : [];
  const out = [];
  for (const f of files) {
    const lane = f.slice(0, -5);
    const list = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (!Array.isArray(list)) throw new Error(`plan/mac-pack/${f}: not a list of entries`);
    for (const e of list) {
      if (!e?.id || typeof e.cmd !== "string") throw new Error(`plan/mac-pack/${f}: an entry without id or cmd`);
      out.push({ lane, ...e, norm: normalize(e.expect) });
    }
  }
  const seen = new Set();
  for (const e of out) {
    if (seen.has(e.id)) throw new Error(`duplicate mac-pack id ${e.id}`);
    seen.add(e.id);
  }
  return out;
}

const isSetup = (e) => /(^|[/.-])setup$/i.test(e.id);
const nodeCall = (cmd) => cmd.trim().match(/^node (\S+\.mjs) (\S+)(?: (--[\w-]+))?$/);

/** Every entry that runs must exit 0 unless its expect names another exit code. */
const withExit = (e) => (e.norm.checks.some((c) => c.kind === "exit") ? e : { ...e, norm: { ...e.norm, checks: [{ kind: "exit", value: 0, implicit: true }, ...e.norm.checks] } });

/** How each entry runs: run | setup | covered (by an umbrella `node X all`) | own-run. */
export function classify(entries) {
  const umbrellas = new Map();
  for (const e of entries) {
    const m = nodeCall(e.cmd);
    if (m && m[2] === "all" && !m[3]) umbrellas.set(`${e.lane} ${m[1]}`, e.id);
  }
  const ids = new Set(entries.map((e) => e.id));
  return entries.map((e) => {
    const needIds = (e.needs ?? []).filter((n) => ids.has(n));
    if (isSetup(e)) return { ...withExit(e), mode: "setup", needIds };
    const m = nodeCall(e.cmd);
    const um = m && umbrellas.get(`${e.lane} ${m[1]}`);
    if (um && um !== e.id) return { ...e, mode: "covered", coveredBy: um, needIds: [...new Set([...needIds, um])] };
    if (movesHead(e.cmd)) return { ...withExit(e), mode: "own-run", needIds };
    return { ...withExit(e), mode: "run", needIds };
  });
}

/** Entries ordered so every id an entry needs comes before it (lane order otherwise). */
export function order(entries) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const done = new Set();
  const out = [];
  const visit = (e, path = []) => {
    if (done.has(e.id)) return;
    if (path.includes(e.id)) throw new Error(`mac-pack needs loop: ${[...path, e.id].join(" → ")}`);
    for (const n of e.needIds) if (byId.has(n)) visit(byId.get(n), [...path, e.id]);
    done.add(e.id);
    out.push(e);
  };
  for (const e of entries) visit(e);
  return out;
}

/** Which shared steps the picked entries need. */
export function sharedNeeds(picked) {
  const need = { setup: false, e2e: false, modelsDay: false };
  for (const e of picked) {
    if (e.mode === "setup") need.setup = true;
    if (e.mode !== "run") continue;
    for (const s of splitTop(e.cmd)) {
      const k = sharedKind(s.text);
      if (k) need[k] = true;
      if (parsePlaywright(s.text)) need.e2e = true;
    }
  }
  return need;
}

/** Entries picked by --only (ids or lane names); all when `only` is empty. */
export function pick(entries, only) {
  if (!only?.length) return entries;
  const want = new Set(only);
  const unknown = only.filter((o) => !entries.some((e) => e.id === o || e.lane === o));
  if (unknown.length) throw new Error(`--only: no entry or lane ${unknown.join(", ")}`);
  return entries.filter((e) => want.has(e.id) || want.has(e.lane));
}

// ── running ───────────────────────────────────────────────────────────────

/** Run `cmd` in bash at `root`; the output goes to `logFile` (and is kept, last 2 MB). */
export function bashExec(root, { echo = false } = {}) {
  return (cmd, { logFile }) =>
    new Promise((done) => {
      mkdirSync(dirname(logFile), { recursive: true });
      const log = createWriteStream(logFile);
      log.write(`$ ${cmd}\n`);
      let stdout = "";
      const child = spawn("bash", ["-c", cmd], { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
      const keep = (buf, isOut) => {
        log.write(buf);
        if (echo) (isOut ? process.stdout : process.stderr).write(buf);
        if (isOut) stdout = (stdout + buf.toString()).slice(-2_000_000);
      };
      child.stdout.on("data", (b) => keep(b, true));
      child.stderr.on("data", (b) => keep(b, false));
      child.on("close", (code, signal) => log.end(`\n[exit ${code ?? signal}]\n`, () => done({ code: code ?? 128, stdout })));
      child.on("error", (err) => log.end(`\n[spawn error ${err.message}]\n`, () => done({ code: 127, stdout })));
    });
}

const safe = (id) => id.replace(/[^\w.-]+/g, "_");

/**
 * Run the picked entries. Options:
 *   root, only, exec(cmd, {logFile}) → {code, stdout}, now() → ms,
 *   previous (an earlier summary of the same sha: its shared steps and entry
 *   results stand in for those not picked now), dry (print, run nothing).
 */
export async function runAll({ root = DEFAULT_ROOT, only = [], exec, now = Date.now, previous = null, dry = false, log = () => {} } = {}) {
  exec ??= bashExec(root);
  const all = order(classify(loadPacks(root)));
  const picked = new Set(pick(all, only).map((e) => e.id));
  const reuse = previous && only.length ? previous : null;
  const since = reuse ? Date.parse(reuse.startedAt) : now();
  const startedAt = new Date(since).toISOString();
  const need = sharedNeeds(all.filter((e) => picked.has(e.id)));
  const shared = {};
  const sharedRuns = [];
  for (const lane of new Set(all.map((e) => e.lane))) {
    for (const d of [`${OUT_DIR}/${lane}`, `.mac-pack/${lane}`]) if (!dry) mkdirSync(join(root, d), { recursive: true });
  }
  if (!dry) restoreAll(root); // why: an interrupted earlier run may have left committed files aside
  for (const kind of ["setup", "e2e", "modelsDay"]) {
    if (!need[kind]) continue;
    const prev = reuse?.shared?.find((s) => s.id === kind);
    if (prev) {
      shared[kind] = { ok: prev.ok, report: SHARED_REPORT, reused: true };
      sharedRuns.push({ ...prev, reused: true });
      continue;
    }
    const cmd = kind === "e2e" ? SHARED_CMDS.e2e(SHARED_REPORT) : SHARED_CMDS[kind];
    if (dry) {
      log(`[dry] shared ${kind}: ${cmd}`);
      shared[kind] = { ok: true, report: SHARED_REPORT };
      continue;
    }
    log(`── shared ${kind}: ${cmd}`);
    const t0 = now();
    const r = await exec(cmd, { logFile: join(root, OUT_DIR, "logs", `shared-${kind}.log`) });
    // Playwright exits 1 on any failing test; the shared report is still the evidence each entry slices,
    // but only a report this step wrote: one left by an earlier run is not.
    const ok = kind === "e2e" ? freshSince(join(root, SHARED_REPORT), t0) : r.code === 0;
    shared[kind] = { ok, report: SHARED_REPORT };
    sharedRuns.push({ id: kind, cmd, code: r.code, ok, ms: now() - t0 });
  }

  const results = new Map();
  for (const e of reuse?.entries ?? []) if (!picked.has(e.id)) results.set(e.id, e);
  const memo = new Map();
  const shell = async (cmd, id) => (await exec(cmd, { logFile: join(root, OUT_DIR, "logs", `${safe(id)}.check.log`) })).code;

  for (const e of all) {
    if (!picked.has(e.id)) continue;
    const base = { lane: e.lane, id: e.id, task: e.task ?? e.tasks ?? null, mode: e.mode, minutes: e.minutes ?? null, manual: e.norm.manual, info: e.norm.info, needs: e.needs ?? [] };
    // An umbrella that ran but failed still wrote the per-task files its covered entries are judged on.
    const okNeed = (n) => ["pass", "manual", "dry"].includes(results.get(n)?.status) || (n === e.coveredBy && results.get(n)?.status === "fail");
    const failedNeeds = e.needIds.filter((n) => !okNeed(n));
    if (e.mode === "own-run" && only.length === 0) {
      results.set(e.id, { ...base, status: "own-run", reason: "moves the checked-out branch; run it alone: npm run mac:pack -- --only " + e.id, checks: [] });
      continue;
    }
    if (failedNeeds.length) {
      results.set(e.id, { ...base, status: "blocked", blockedBy: failedNeeds, checks: [] });
      continue;
    }
    let run;
    let cmd = e.cmd;
    let replaced = [];
    let checks = e.norm.checks;
    if (e.mode === "setup") {
      run = { code: sharedRuns.find((s) => s.id === "setup")?.code ?? (dry ? 0 : null), stdout: "" };
      cmd = `(shared setup) ${SHARED_CMDS.setup}`;
    } else if (e.mode === "covered") {
      run = { code: null, stdout: "" };
      cmd = `(judged from the files ${e.coveredBy} wrote)`;
      checks = checks.filter((c) => c.kind !== "exit");
    } else {
      const rw = rewrite(e.cmd, shared);
      cmd = rw.cmd;
      replaced = rw.replaced;
      if (rw.blockedBy.length) {
        results.set(e.id, { ...base, status: "blocked", blockedBy: rw.blockedBy.map((k) => `shared ${k}`), cmd, checks: [] });
        continue;
      }
      if (dry) {
        log(`[dry] ${e.id}: ${cmd}`);
        results.set(e.id, { ...base, status: "dry", cmd, replaced, checks: [] });
        continue;
      }
      const t0 = now();
      if (memo.has(cmd)) run = { ...memo.get(cmd), reusedFrom: memo.get(cmd).id };
      else {
        for (const c of checks) if (c.kind === "shell") setAside(root, e.id, c.cmd, since);
        log(`── ${e.id}`);
        run = await exec(cmd, { logFile: join(root, OUT_DIR, "logs", `${safe(e.id)}.log`) });
        memo.set(cmd, { ...run, id: e.id });
      }
      run.ms = now() - t0;
    }
    if (dry) {
      results.set(e.id, { ...base, status: "dry", cmd, checks: [] });
      continue;
    }
    let judged;
    try {
      judged = await judge(checks, run, { root, since, shell: (c) => shell(c, e.id) });
    } finally {
      restoreAside(root, e.id);
    }
    if (e.mode === "covered" && judged.length === 0) {
      // Nothing of its own to read (L4.e2e): it holds exactly when its umbrella held.
      const u = results.get(e.coveredBy)?.status;
      judged.push({ kind: "umbrella", desc: `${e.coveredBy} passed`, ok: u === "pass", actual: u });
    }
    const status = judged.length === 0 ? "manual" : judged.every((c) => c.ok) ? "pass" : "fail";
    results.set(e.id, { ...base, status, code: run.code, ms: run.ms ?? 0, reusedFrom: run.reusedFrom, cmd, replaced, log: `${OUT_DIR}/logs/${safe(e.id)}.log`, checks: judged, at: new Date(now()).toISOString() });
  }

  const entries = all.map((e) => results.get(e.id)).filter(Boolean);
  const count = (s) => entries.filter((r) => r.status === s).length;
  const counts = { pass: count("pass"), fail: count("fail"), blocked: count("blocked"), manual: count("manual"), ownRun: count("own-run"), dry: count("dry"), forPerson: entries.filter((r) => r.manual?.length).length, total: entries.length };
  const result = counts.fail || counts.blocked ? "not ok" : counts.manual || counts.ownRun || counts.forPerson || counts.dry ? "incomplete" : "ok";
  return {
    schema: "lumen.mac-pack.summary/1",
    sha: gitOut(root, ["rev-parse", "HEAD"]),
    startedAt,
    finishedAt: new Date(now()).toISOString(),
    only,
    ignored: { reports: gitIgnored(root, `${OUT_DIR}/summary.json`), macPack: gitIgnored(root, ".mac-pack/x") },
    shared: sharedRuns,
    counts,
    result,
    ok: result === "ok",
    entries,
  };
}

/** true when `file` exists and was written at or after `t0`. */
function freshSince(file, t0) {
  try {
    return statSync(file).mtimeMs >= t0 - CLOCK_SLACK_MS;
  } catch {
    return false; // why: no report at all is not evidence either
  }
}

function gitOut(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** true / false from `git check-ignore`; null outside a git checkout. */
export function gitIgnored(root, rel) {
  const r = spawnSync("git", ["check-ignore", "-q", rel], { cwd: root });
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  return null;
}

// ── reports ───────────────────────────────────────────────────────────────

const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The readable summary. */
export function renderMarkdown(sum) {
  const c = sum.counts;
  const lanes = [...new Set(sum.entries.map((e) => e.lane))];
  const lines = [
    `# Mac pack run — ${sum.sha ? sum.sha.slice(0, 10) : "(no git)"}`,
    "",
    `Started ${sum.startedAt}, finished ${sum.finishedAt}${sum.only.length ? `; only ${sum.only.join(", ")}` : ""}.`,
    "",
    `**${sum.result.toUpperCase()}**: ${c.pass} pass, ${c.fail} fail, ${c.blocked} blocked, ${c.manual} for a person only, ${c.ownRun} need their own run, ${c.forPerson} with parts still for a person (of ${c.total}).`,
    "A pass means the entry exited as expected and every machine check held on files written by this run. The \"still for a person\" lines are not checked by anything, so the run is incomplete until a person has done them.",
    "",
  ];
  if (sum.ignored.reports === false || sum.ignored.macPack === false) lines.push("> **Warning:** reports/mac-pack/ or .mac-pack/ is not git-ignored in this checkout; do not commit them.", "");
  if (sum.shared.length) {
    lines.push("## Shared steps", "", "| step | exit | ok | minutes |", "|---|---|---|---|");
    for (const s of sum.shared) lines.push(`| ${s.id} | ${s.code ?? ""} | ${s.ok ? "yes" : "NO"}${s.reused ? " (earlier run)" : ""} | ${s.ms ? (s.ms / 60000).toFixed(1) : ""} |`);
    lines.push("");
  }
  lines.push("## Per lane", "", "| lane | pass | fail | blocked | person only | own run |", "|---|---|---|---|---|---|");
  for (const l of lanes) {
    const es = sum.entries.filter((e) => e.lane === l);
    const n = (s) => es.filter((e) => e.status === s).length;
    lines.push(`| ${l} | ${n("pass")} | ${n("fail")} | ${n("blocked")} | ${n("manual")} | ${n("own-run")} |`);
  }
  const bad = sum.entries.filter((e) => e.status === "fail" || e.status === "blocked");
  if (bad.length) {
    lines.push("", "## Not OK", "", "| entry | status | first failed check | actual | log |", "|---|---|---|---|---|");
    for (const e of bad) {
      const f = e.checks.find((x) => !x.ok);
      lines.push(`| ${e.id} | ${e.status} | ${cell(f?.desc ?? (e.blockedBy ?? []).join(", "))} | ${cell(f ? JSON.stringify(f.actual) : "")} | ${e.log ?? ""} |`);
    }
  }
  const own = sum.entries.filter((e) => e.status === "own-run");
  if (own.length) lines.push("", "## Run on their own", "", ...own.map((e) => `- ${e.id}: \`npm run mac:pack -- --only ${e.id}\``));
  const person = sum.entries.filter((e) => e.manual?.length);
  if (person.length) {
    lines.push("", "## Still for a person", "");
    for (const e of person) lines.push(`- **${e.id}** (${e.status}): ${e.manual.map(cell).join("; ")}`);
  }
  return `${lines.join("\n")}\n`;
}

/** The --list table. */
export function renderList(root, only) {
  const all = order(classify(loadPacks(root)));
  const picked = pick(all, only);
  const need = sharedNeeds(picked);
  const rows = ["shared steps (each once): " + Object.entries(need).filter(([, v]) => v).map(([k]) => `${k}: ${k === "e2e" ? SHARED_CMDS.e2e(SHARED_REPORT) : SHARED_CMDS[k]}`).join(" | ")];
  rows.push(["id", "lane", "mode", "min", "checks", "person", "needs"].join("\t"));
  for (const e of picked) rows.push([e.id, e.lane, e.mode === "covered" ? `covered by ${e.coveredBy}` : e.mode, e.minutes ?? "", e.norm.checks.length, e.norm.manual.length, e.needIds.join(",")].join("\t"));
  rows.push(`${picked.length} entries, ${picked.reduce((n, e) => n + (Number(e.minutes) || 0), 0)} minutes as the lanes estimated them (before sharing)`);
  return rows.join("\n");
}

function parseArgs(argv) {
  const a = { list: false, dry: false, only: [], root: DEFAULT_ROOT, echo: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--list") a.list = true;
    else if (x === "--dry") a.dry = true;
    else if (x === "--echo") a.echo = true;
    else if (x === "--only") a.only.push(...String(argv[++i] ?? "").split(",").filter(Boolean));
    else if (x.startsWith("--only=")) a.only.push(...x.slice(7).split(",").filter(Boolean));
    else if (x === "--root") a.root = resolve(argv[++i]);
    else throw new Error(`unknown option ${x}`);
  }
  if (argv.includes("--only") && !a.only.length) throw new Error("--only needs an id or a lane");
  return a;
}

export async function main(argv) {
  let a;
  try {
    a = parseArgs(argv);
  } catch (e) {
    console.error(`mac:pack: ${e.message}\nusage: npm run mac:pack -- [--list] [--dry] [--only <id|lane>[,…]] [--echo]`);
    return 2;
  }
  if (a.list) {
    console.log(renderList(a.root, a.only));
    return 0;
  }
  const out = join(a.root, OUT_DIR);
  const prevFile = join(out, "summary.json");
  let previous = null;
  if (a.only.length && existsSync(prevFile)) {
    try {
      const p = JSON.parse(readFileSync(prevFile, "utf8"));
      if (p.sha && p.sha === gitOut(a.root, ["rev-parse", "HEAD"])) previous = p;
    } catch {
      previous = null; // why: an unreadable earlier summary is simply not reused
    }
  }
  let sum;
  try {
    sum = await runAll({ root: a.root, only: a.only, previous, dry: a.dry, exec: bashExec(a.root, { echo: a.echo }), log: (s) => console.log(s) });
  } catch (e) {
    console.error(`mac:pack: ${e.message}`);
    return 2;
  }
  if (a.dry) return 0;
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "summary.json"), `${JSON.stringify(sum, null, 2)}\n`);
  writeFileSync(join(out, "summary.md"), renderMarkdown(sum));
  const c = sum.counts;
  console.log(`\nmac:pack ${sum.result.toUpperCase()}: ${c.pass} pass, ${c.fail} fail, ${c.blocked} blocked, ${c.manual} person only, ${c.ownRun} own run, ${c.forPerson} with parts for a person → ${OUT_DIR}/summary.md`);
  if (sum.ignored.reports === false) console.log(`warning: ${OUT_DIR}/ is not git-ignored here; do not commit it`);
  return sum.result === "ok" ? 0 : sum.result === "incomplete" ? 3 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then((code) => process.exit(code));
