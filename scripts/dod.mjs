#!/usr/bin/env node
/**
 * Definition-of-done checker (plan 0.7). For a task in plan/plan.json it
 * checks, mechanically and from GitHub's REST API only, what can be checked:
 *
 *   PR        the task's PR exists (from its status "✅ #NNN" or its branch)
 *   CI        every check run on the PR's head is green; "typecheck • test • build" passed
 *   DoD       every acceptance line has a linked automated check (plan.json
 *             tasks[].dod.checks, one entry per acceptance line) and that check
 *             passed on the head: a vitest file / test name, a Playwright spec,
 *             an npm script run by a CI job, a CI job, or a golden-set eval
 *   review    every Codex thread on the PR is resolved, or is recorded in the
 *             owner's item 15.16 ("#NNN ×k")
 *   docs      the task's doc page (tasks[].dod.docs) exists on the head
 *   status    the status the evidence supports (✅ · ✅* · ⏳ · ⬜) matches plan.json
 *
 * It prints a table and exits 1 on any gap.
 *
 *   npm run dod -- <task id>          one task
 *   npm run dod -- <task id> --run    also run the linked vitest files and npm scripts here
 *   npm run dod -- --all              every ✅ task: a summary and the list of gaps (input to 1.8)
 *   npm run dod -- --changed <ref>    the tasks whose status became ✅ since plan.json at <ref> (CI gate)
 *   npm run dod -- <task id> --pr-body   the DoD checklist for the PR description
 *   --report                           exit 0 even with gaps (for summaries)
 *   --json <file>                      also write the full report as JSON
 *
 * GraphQL is not used. Thread resolution comes from the /ccr/review_threads
 * route; everything else is plain REST. The `gh` CLI must be authenticated.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PLAN_FILE = "plan/plan.json";
export const CHECK_JOB = "typecheck • test • build";
/** Owner item whose details record Codex threads left open on purpose ("#NNN ×k"). */
export const RECORDED_THREADS_ITEM = "15.16";
const OK_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);

// ───────────────────────────── pure helpers ─────────────────────────────

/** PR numbers named in a status such as "✅ #194 + #206 (…)"; the first is the task's PR. */
export const prNumbers = (status = "") => [...new Set([...status.matchAll(/#(\d+)/g)].map((m) => Number(m[1])))];
/** "✅", "✅*", "⏳" or "⬜" from a status string. */
export const statusMark = (status = "") => (status.trim().split(/\s+/)[0] || "⬜").replace(/[^✅*⏳⬜]/g, "") || "⬜";

/** Codex threads recorded as left open on purpose: { prNumber: count } from the owner item's details. */
export function recordedThreads(plan) {
  const item = plan.owner.find((o) => o.id === RECORDED_THREADS_ITEM);
  const out = {};
  for (const m of (item?.details ?? "").matchAll(/#(\d+) ×(\d+)/g)) out[Number(m[1])] = (out[Number(m[1])] ?? 0) + Number(m[2]);
  return out;
}

/**
 * Which CI job runs each npm script, from the workflow files at the head:
 * { scriptName: [jobName, …] }. A matrix job's name keeps its `${{ … }}`
 * part, which is matched as a prefix against check-run names.
 */
export function scriptJobs(workflows) {
  const out = {};
  for (const text of workflows) {
    let wf;
    try {
      wf = YAML.parse(text);
    } catch {
      continue;
    }
    if (!wf?.on || !wf.jobs) continue;
    const on = wf.on;
    const onPr = on === "pull_request" || (Array.isArray(on) && on.includes("pull_request")) || (typeof on === "object" && "pull_request" in on);
    if (!onPr) continue;
    for (const [id, job] of Object.entries(wf.jobs)) {
      const name = String(job.name ?? id).replace(/\s*\(\$\{\{.*$/, "").trim();
      for (const step of job.steps ?? []) {
        for (const m of String(step.run ?? "").matchAll(/npm run (?:-s |--silent )?([\w:.-]+)/g)) (out[m[1]] ??= []).push(name);
        for (const m of String(step.run ?? "").matchAll(/node (scripts\/[\w./-]+\.mjs)/g)) (out[m[1]] ??= []).push(name);
      }
    }
  }
  return out;
}

/** Does a check run with this (possibly matrix-prefixed) name exist, and did it pass? */
export function jobResult(checkRuns, jobName) {
  const runs = checkRuns.filter((r) => r.name === jobName || r.name.startsWith(jobName + " ("));
  if (!runs.length) return { state: "missing" };
  if (runs.some((r) => r.status !== "completed")) return { state: "pending" };
  if (runs.every((r) => OK_CONCLUSIONS.has(r.conclusion))) return { state: runs.every((r) => r.conclusion === "skipped") ? "skipped" : "passed" };
  return { state: "failed", failed: runs.filter((r) => !OK_CONCLUSIONS.has(r.conclusion)).map((r) => r.name) };
}

/** The status the evidence supports. */
export function derivedStatus(rows) {
  if (rows.some((r) => r.kind === "pr" && !r.ok)) return "⬜";
  const gaps = rows.filter((r) => !r.ok);
  if (!gaps.length) return "✅";
  if (gaps.every((r) => r.gap === "owner")) return "✅*";
  return "⏳";
}

// ───────────────────────────── GitHub (REST, via gh) ─────────────────────────────

export function restApi(repo) {
  const cache = new Map();
  const call = (path, args = []) => {
    const key = path + args.join(" ");
    if (!cache.has(key)) {
      let out;
      try {
        out = execFileSync("gh", ["api", path, ...args], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        const msg = String(e.stderr ?? e.message).trim();
        if (/HTTP 404/.test(msg)) cache.set(key, null);
        else throw new Error(`gh api ${path}: ${msg.split("\n")[0]}`);
      }
      if (out !== undefined) cache.set(key, out ? JSON.parse(out) : null);
    }
    return cache.get(key);
  };
  const list = (path) => {
    const out = [];
    for (let page = 1; ; page++) {
      const r = call(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      const arr = Array.isArray(r) ? r : (r?.check_runs ?? []);
      out.push(...arr);
      if (arr.length < 100) return out;
    }
  };
  return {
    pr: (n) => call(`repos/${repo}/pulls/${n}`),
    prsForBranch: (branch) => list(`repos/${repo}/pulls?head=${repo.split("/")[0]}:${encodeURIComponent(branch)}&state=all`),
    checkRuns: (sha) => list(`repos/${repo}/commits/${sha}/check-runs?filter=latest`),
    threads: (n) => call(`repos/${repo}/pulls/${n}/ccr/review_threads`) ?? [],
    comments: (n) => list(`repos/${repo}/pulls/${n}/comments`),
    file: (sha, path) => {
      const r = call(`repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${sha}`);
      if (!r || Array.isArray(r)) return r ? { dir: true } : null;
      return { sha: r.sha, text: r.encoding === "base64" ? Buffer.from(r.content, "base64").toString("utf8") : (r.content ?? "") };
    },
    dir: (sha, path) => call(`repos/${repo}/contents/${path}?ref=${sha}`) ?? [],
  };
}

// ───────────────────────────── the check ─────────────────────────────

/**
 * Check one task. Returns { id, status, derived, rows, gaps, pr, head }.
 * `api` is a restApi(); `local` runs linked vitest files / npm scripts here.
 */
export function checkTask(plan, task, api, { local = false, root = ROOT } = {}) {
  const rows = [];
  const row = (kind, what, ok, detail = "", gap = ok ? "" : kind) => rows.push({ kind, what, ok, detail, gap });
  const recorded = recordedThreads(plan);
  const isCodex = (login = "") => /codex/i.test(login);

  // PR and head.
  let numbers = prNumbers(task.status);
  if (!numbers.length && task.branch && task.branch !== "—") numbers = api.prsForBranch(task.branch).map((p) => p.number);
  const prs = numbers.map((n) => api.pr(n)).filter(Boolean);
  if (!prs.length) {
    row("pr", "PR", false, task.branch && task.branch !== "—" ? `no PR for branch ${task.branch}` : "no branch");
    return finish();
  }
  const pr = prs[0];
  const head = pr.head.sha;
  row("pr", "PR", true, `#${pr.number} ${pr.state}${pr.merged_at ? " (merged)" : ""} head ${head.slice(0, 8)}${prs.length > 1 ? ` + ${prs.slice(1).map((p) => `#${p.number}`).join(", ")}` : ""}`);

  // CI on every PR's head.
  const runsBy = new Map(prs.map((p) => [p.number, api.checkRuns(p.head.sha)]));
  for (const p of prs) {
    const runs = runsBy.get(p.number);
    const failed = runs.filter((r) => r.status === "completed" && !OK_CONCLUSIONS.has(r.conclusion)).map((r) => r.name);
    const pending = runs.filter((r) => r.status !== "completed").map((r) => r.name);
    const gate = jobResult(runs, CHECK_JOB);
    const ok = !failed.length && !pending.length && gate.state === "passed";
    row("ci", `CI #${p.number}`, ok, ok ? `${runs.length} check runs green` : failed.length ? `failing: ${failed.join(", ")}` : pending.length ? `pending: ${pending.join(", ")}` : `${CHECK_JOB}: ${gate.state}`);
  }
  const runs = runsBy.get(pr.number);

  // Acceptance lines and their linked checks.
  const checks = task.dod?.checks ?? [];
  let jobsOfScript = null;
  const scriptJob = (script) => {
    if (!jobsOfScript) {
      const files = api.dir(head, ".github/workflows").filter((f) => /\.ya?ml$/.test(f.name));
      jobsOfScript = scriptJobs(files.map((f) => api.file(head, `.github/workflows/${f.name}`)?.text ?? ""));
    }
    return jobsOfScript[script] ?? [];
  };
  const fileHas = (path, needle) => {
    const f = api.file(head, path);
    if (!f) return { exists: false };
    return { exists: true, has: needle ? f.text.includes(needle) : true };
  };
  const linked = (spec, kind, jobs) => {
    // "path > test name"
    const [path, name] = spec.split(" > ").map((s) => s.trim());
    const f = fileHas(path, name);
    if (!f.exists) return [false, `${path} is not on the head`];
    if (name && !f.has) return [false, `"${name}" is not in ${path}`];
    const bad = jobs.map((j) => [j, jobResult(runs, j)]).find(([, r]) => r.state !== "passed");
    if (bad) return [false, `${bad[0]}: ${bad[1].state}${bad[1].failed ? ` (${bad[1].failed.join(", ")})` : ""}`];
    return [true, `${path}${name ? ` › ${name}` : ""} · ${jobs.join(", ")} passed on ${head.slice(0, 8)}`];
  };
  task.acceptance.forEach((line, i) => {
    const c = checks[i];
    const what = `${task.id}.ok${i + 1}`;
    if (!c) return row("dod", what, false, `${line} — no linked check`, "unlinked");
    if (c.owner) return row("dod", what, false, `${line} — owner check ${c.owner}`, "owner");
    if (c.manual) return row("dod", what, false, `${line} — manual: ${c.manual}`, "manual");
    let res;
    if (c.test) res = linked(c.test, "test", [CHECK_JOB]);
    else if (c.e2e) res = linked(c.e2e, "e2e", c.ci ? [c.ci] : ["e2e"]);
    else if (c.eval) res = linked(c.eval, "eval", [c.ci ?? "local agents"]);
    else if (c.script) {
      const pkg = api.file(head, "package.json");
      const scripts = pkg ? JSON.parse(pkg.text).scripts ?? {} : {};
      const target = c.script.replace(/^node /, "");
      if (!(target in scripts) && !api.file(head, target)) res = [false, `script ${c.script} is not on the head`];
      else {
        const jobs = c.ci ? [c.ci] : scriptJob(target);
        if (!jobs.length) res = [false, `no CI job runs ${c.script} on the head`];
        else {
          const bad = jobs.map((j) => [j, jobResult(runs, j)]).find(([, r]) => r.state !== "passed");
          res = bad ? [false, `${bad[0]}: ${bad[1].state}`] : [true, `${c.script} · ${jobs.join(", ")} passed on ${head.slice(0, 8)}`];
        }
      }
    } else if (c.ci) {
      const r = jobResult(runs, c.ci);
      res = [r.state === "passed", `${c.ci}: ${r.state}${r.failed ? ` (${r.failed.join(", ")})` : ""}`];
    } else res = [false, `unknown check ${JSON.stringify(c)}`];
    // Optionally run it here too (vitest files and npm scripts only).
    if (local && res[0]) {
      const cmd = c.test ? ["npx", ["vitest", "run", c.test.split(" > ")[0]]] : c.script && !c.script.startsWith("node ") ? ["npm", ["run", "-s", c.script]] : null;
      if (cmd) {
        try {
          execFileSync(cmd[0], cmd[1], { cwd: root, stdio: "ignore" });
          res[1] += " · passed here too";
        } catch {
          res = [false, `${res[1]} · FAILED when run here`];
        }
      }
    }
    row("dod", what, res[0], `${line} — ${res[1]}`);
  });

  // Codex threads.
  for (const p of prs) {
    const threads = api.threads(p.number).filter((t) => !t.resolved);
    const first = new Map(api.comments(p.number).map((c) => [c.id, c]));
    const codex = threads.filter((t) => isCodex(first.get(t.comment_ids[0])?.user?.login));
    const allowed = recorded[p.number] ?? 0;
    const ok = codex.length <= allowed;
    row("review", `Codex threads #${p.number}`, ok, codex.length ? `${codex.length} unresolved, ${allowed} recorded in ${RECORDED_THREADS_ITEM}${ok ? "" : `: ${codex.map((t) => t.comment_ids[0]).join(", ")}`}` : "none unresolved");
  }

  // Doc page.
  const docs = task.dod?.docs;
  if (!docs) row("docs", "doc page", false, "no doc page linked (dod.docs)");
  else if (docs.startsWith("none:")) row("docs", "doc page", true, docs);
  else row("docs", "doc page", !!api.file(head, docs), `${docs}${api.file(head, docs) ? "" : " is not on the head"}`);

  return finish();

  function finish() {
    const derived = derivedStatus(rows);
    const mark = statusMark(task.status);
    const statusOk = mark === derived || (mark === "⬜" && derived !== "✅") || (mark === "⏳" && derived === "✅*");
    row("status", "status", statusOk, `plan ${mark} · evidence ${derived}`);
    return { id: task.id, title: task.title, status: task.status ?? "", derived, pr: prs[0]?.number ?? null, head: prs[0]?.head.sha ?? null, rows, gaps: rows.filter((r) => !r.ok) };
  }
}

// ───────────────────────────── rendering ─────────────────────────────

const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
export function renderTask(r) {
  const out = [`### ${r.id} · ${r.title} — ${r.gaps.length ? `${r.gaps.length} gap(s)` : "DoD green"} (evidence: ${r.derived})`, "", "| check | result | detail |", "|---|---|---|"];
  for (const row of r.rows) out.push(`| ${cell(row.what)} | ${row.ok ? "✅" : row.gap === "owner" ? "👤" : "❌"} | ${cell(row.detail)} |`);
  return out.join("\n") + "\n";
}
export function renderAll(results) {
  const out = [`## DoD: ${results.length} task(s), ${results.filter((r) => !r.gaps.length).length} green`, "", "| task | plan | evidence | PR | gaps |", "|---|---|---|---|---|"];
  for (const r of results) out.push(`| ${r.id} ${cell(r.title)} | ${statusMark(r.status)} | ${r.derived} | ${r.pr ? `#${r.pr}` : "—"} | ${r.gaps.map((g) => g.gap).join(", ") || "—"} |`);
  const gaps = results.flatMap((r) => r.gaps.map((g) => [r.id, g.what, g.detail]));
  if (gaps.length) {
    out.push("", "### Gaps (input to 1.8)", "", "| task | check | detail |", "|---|---|---|");
    for (const [id, what, detail] of gaps) out.push(`| ${id} | ${cell(what)} | ${cell(detail)} |`);
  }
  return out.join("\n") + "\n";
}
/** The DoD checklist for a PR description. */
export function prBody(task) {
  const checks = task.dod?.checks ?? [];
  const out = [`## DoD · ${task.id} ${task.title}`, "", `- [ ] PR open, CI green on the head`, `- [ ] every Codex thread resolved or recorded in ${RECORDED_THREADS_ITEM}`, `- [ ] doc page: ${task.dod?.docs ?? "_not linked yet_"}`, "", "Acceptance:"];
  task.acceptance.forEach((line, i) => {
    const c = checks[i];
    const link = !c ? "_no linked check_" : c.owner ? `owner ${c.owner}` : c.manual ? `manual: ${c.manual}` : c.test ?? c.e2e ?? c.eval ?? c.script ?? c.ci;
    out.push(`- [ ] ${line} — \`${link}\``);
  });
  return out.join("\n") + "\n";
}

// ───────────────────────────── CLI ─────────────────────────────

function main(argv) {
  const plan = JSON.parse(readFileSync(join(ROOT, PLAN_FILE), "utf8"));
  const tasks = plan.phases.flatMap((p) => p.tasks);
  const repo = process.env.GITHUB_REPOSITORY ?? "talstilkol/lumen-md";
  const flag = (f) => argv.includes(f);
  const arg = (f) => (argv.indexOf(f) >= 0 ? argv[argv.indexOf(f) + 1] : undefined);
  const ids = argv.filter((a) => /^\d+\.\d+$/.test(a));
  let selected;
  if (flag("--all")) selected = tasks.filter((t) => statusMark(t.status).startsWith("✅"));
  else if (flag("--changed")) {
    const ref = arg("--changed");
    const before = JSON.parse(execFileSync("git", ["show", `${ref}:${PLAN_FILE}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 }));
    const was = new Map(before.phases.flatMap((p) => p.tasks).map((t) => [t.id, statusMark(t.status)]));
    selected = tasks.filter((t) => statusMark(t.status).startsWith("✅") && !(was.get(t.id) ?? "").startsWith("✅"));
    if (!selected.length) {
      console.log(`dod: no task became ✅ since ${ref}`);
      return 0;
    }
  } else {
    selected = ids.map((id) => tasks.find((t) => t.id === id) ?? (() => { throw new Error(`dod: unknown task ${id}`); })());
    if (!selected.length) throw new Error("dod: give a task id, --all or --changed <ref>");
  }
  if (flag("--pr-body")) {
    for (const t of selected) process.stdout.write(prBody(t));
    return 0;
  }
  const api = restApi(repo);
  const results = selected.map((t) => checkTask(plan, t, api, { local: flag("--run") }));
  const md = selected.length === 1 && !flag("--all") && !flag("--changed") ? renderTask(results[0]) : renderAll(results);
  process.stdout.write(md);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, md, { flag: "a" });
  if (arg("--json")) {
    mkdirSync(dirname(resolve(arg("--json"))), { recursive: true });
    writeFileSync(arg("--json"), JSON.stringify({ date: new Date().toISOString(), results }, null, 2) + "\n");
  }
  const gaps = results.reduce((n, r) => n + r.gaps.length, 0);
  return gaps && !flag("--report") ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exit(2);
  }
}
