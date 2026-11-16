/**
 * Plan W10.Z3 / 13.5 / W10.Z1: run the dod of every P0 task on a train head
 * and write the table — honestly, where vitest itself cannot run.
 *
 * `npx vitest run <files|dirs>` goes through an offline per-file runner (the
 * shim: `<runner> <root> <file>`, last line "… pass N fail M"), or, with no
 * runner, through vitest itself with its JSON reporter (review 9, M5: an exit 0
 * of a file whose every test skipped is not a pass); either way a file is green
 * with at least one passed test and no failure. Every other command runs in a shell.
 * Commands that cannot run on a cloud machine without the full install (a
 * browser, cargo, the npm registry, a GPU or the owner's accounts) are not run
 * and are reported as "not here", with the reason: never as a pass. A Rust
 * test run that ran no test ("running 0 tests") is a fail (review 10, M5).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { rustCounts, rustGreen } from "./rustStd.mjs";

/** [pattern, reason]: commands this runner does not run, and why. */
export const NOT_HERE = [
  [/\bnpx playwright\b|\btest:e2e\b|\be2e:gate\b|--e2e\b/, "Playwright needs real browsers (Mac, W10.M1)"],
  [/\bnpm ci\b|\bnpm audit\b/, "the npm registry is blocked here"],
  [/\bcargo\b|\btauri:build\b/, "the Rust toolchain and the desktop build (Mac, W10.M3)"],
  [/\btest:mutation\b/, "the mutation run needs the full install (Stryker)"],
  [/\bnightly:full\b|\bmodels:cloud\b|\brepro\b/, "a full nightly, cloud models or a reproducible build: not on this machine"],
  [/^npm test$/, "the whole vitest suite needs the full install; its files run one by one in the P0 rows instead"],
  [/refs\/tags\/v1\.0\.0-rc/, "the rc tag is the owner's (made after this review)"],
  [/scripts\/dod\.mjs \$\(/, "this table is that run"],
];

export const notHere = (cmd) => NOT_HERE.find(([re]) => re.test(cmd))?.[1] ?? null;

/** Test files named by `npx vitest run …`, directories expanded; null when the command is not a plain file list. */
export function vitestFiles(cmd, root) {
  const m = /^npx vitest run((?:\s+[^\s-][^\s]*)+)\s*$/.exec(cmd.trim());
  if (!m) return null;
  const out = [];
  for (const arg of m[1].trim().split(/\s+/)) {
    const p = join(root, arg);
    if (existsSync(p) && statSync(p).isDirectory()) out.push(...testsUnder(root, arg));
    else out.push(arg);
  }
  return out;
}

function testsUnder(root, dir) {
  const out = [];
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir.replace(/\/$/, "")}/${e.name}`;
    if (e.isDirectory()) out.push(...testsUnder(root, rel));
    else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(e.name)) out.push(rel);
  }
  return out.sort();
}

/** Pass/fail counts from the runner's last "pass N fail M" line. */
export function counts(out) {
  const lines = String(out).trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /pass (\d+) fail (\d+)/.exec(lines[i]);
    if (m) return { pass: Number(m[1]), fail: Number(m[2]) };
  }
  return null;
}

function sh(cmd, args, opts) {
  return new Promise((res) => {
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 900_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      res({ code: code ?? 1, out });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      res({ code: 1, out: String(e) });
    });
  });
}

/** vitest's arguments for a JSON report of `files` written to `outFile`. */
export const vitestJsonArgs = (files, outFile) => ["vitest", "run", "--reporter=json", `--outputFile=${outFile}`, ...files];

/**
 * Per-file counts from vitest's JSON reporter: relative path → { pass, fail }.
 * Skipped, todo and pending tests count as neither; a file that failed with no
 * test result (a load error) counts as one failure.
 * @param {any} json  the reporter's output (`testResults[].name` is an absolute path)
 * @param {string} root
 */
export function jsonCounts(json, root) {
  const out = new Map();
  for (const f of json?.testResults ?? []) {
    if (!f || typeof f.name !== "string") continue;
    const a = Array.isArray(f.assertionResults) ? f.assertionResults : [];
    let fail = a.filter((x) => x?.status === "failed").length;
    if (f.status === "failed" && !fail) fail = 1;
    out.set(relative(root, f.name).split(sep).join("/"), { pass: a.filter((x) => x?.status === "passed").length, fail });
  }
  return out;
}

/**
 * The verdict of a vitest command from each file's counts (`counts.get(f)` →
 * { pass, fail } | undefined): fail when a file is missing, has a failure, has
 * no result, or when there are no files at all; skipped when every test of
 * some file skipped itself; else pass.
 * @param {string[]} files
 * @param {string} root
 * @param {Map<string, { pass: number, fail: number }|null>} counts
 */
export function judgeFiles(files, root, counts) {
  const parts = [];
  // No file to run is not a pass (an empty directory, a typo'd path).
  let ok = files.length > 0;
  let skippedOnly = 0;
  for (const f of files) {
    if (!existsSync(join(root, f))) {
      ok = false;
      parts.push(`${f}: no such file`);
      continue;
    }
    const c = counts.get(f) ?? null;
    const green = !!c && c.pass > 0 && c.fail === 0;
    // Every test of the file skipped (a describe.skipIf with its skip-reason): not
    // a failure, and not a pass either — nothing was checked here.
    const empty = !!c && c.pass === 0 && c.fail === 0;
    if (empty) skippedOnly++;
    else if (!green) ok = false;
    parts.push(`${f.split("/").pop()} ${c ? (empty ? "0/0 (all skipped here)" : `${c.pass}/${c.pass + c.fail}`) : "load error"}`);
  }
  const status = !ok ? "fail" : skippedOnly ? "skipped" : "pass";
  return { status, detail: parts.join(", ") || "no files" };
}

/** Reads a JSON report file, or null. */
function readReport(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The same verdict for a vitest command run synchronously through vitest's JSON
 * reporter (scripts/dod.mjs without --runner). `spawn` is injectable for tests.
 * @returns {{ status: string, detail: string }}
 */
export function vitestJsonSync(files, root, spawn = spawnSync) {
  const dir = mkdtempSync(join(tmpdir(), "dod-vitest-"));
  try {
    const outFile = join(dir, "report.json");
    if (files.length) spawn(process.platform === "win32" ? "npx.cmd" : "npx", vitestJsonArgs(files, outFile), { cwd: root, stdio: "inherit" });
    return judgeFiles(files, root, jsonCounts(readReport(outFile), root));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * One dod command → { cmd, status: "pass"|"fail"|"skipped"|"not here", detail }.
 * @param {string} cmd
 * @param {{ root: string, runner?: string|null, run?: typeof sh }} o
 */
export async function runCommand(cmd, { root, runner = null, run = sh }) {
  const why = notHere(cmd);
  if (why) return { cmd, status: "not here", detail: why };
  const files = vitestFiles(cmd, root);
  if (files && runner) {
    const byFile = new Map();
    for (const f of files) if (existsSync(join(root, f))) byFile.set(f, counts((await run(runner, [root, f], { cwd: root })).out));
    return { cmd, ...judgeFiles(files, root, byFile) };
  }
  if (files) {
    const dir = mkdtempSync(join(tmpdir(), "dod-vitest-"));
    try {
      const outFile = join(dir, "report.json");
      if (files.length) await run("npx", vitestJsonArgs(files, outFile), { cwd: root });
      const byFile = jsonCounts(readReport(outFile), root);
      return { cmd, ...judgeFiles(files, root, byFile) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const r = await run("bash", ["-c", cmd], { cwd: root });
  // Review 10, M5: a Rust test run (cargo test, rustc --test) that ran no test checked nothing.
  const rust = rustCounts(r.out);
  if (r.code === 0 && rust && !rustGreen(rust)) return { cmd, status: "fail", detail: `exit 0 — but ${rust.ran === 0 ? "running 0 tests" : `${rust.passed}/${rust.ran} passed`}: nothing was checked` };
  const outLines = r.out.trim().split("\n").filter((l) => l.trim() && !/^Node\.js v\d/.test(l));
  const tail = (r.code !== 0 ? outLines.filter((l) => /error|✗|fail|cannot|not found/i.test(l)).slice(-1)[0] : null) ?? outLines.slice(-1)[0] ?? "";
  return { cmd, status: r.code === 0 ? "pass" : "fail", detail: `exit ${r.code}${tail ? ` — ${tail.slice(0, 160)}` : ""}` };
}

/**
 * Every command of every task, `jobs` tasks at a time; a task's commands run
 * in order and all of them run (the table shows each one).
 */
export async function runTasks(tasks, { root, runner = null, jobs = 1, run = sh, log = () => {} }) {
  const out = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      const t = tasks[i];
      const cmds = [];
      for (const cmd of t.dod ?? []) {
        cmds.push(await runCommand(cmd, { root, runner, run }));
        log(`${t.id} ${cmds.at(-1).status} ${cmd.slice(0, 100)}`);
      }
      out[i] = { id: t.id, title: t.title, status: t.status ?? "", verdict: verdictOf(cmds), cmds, expect: t.dodExpect ?? [] };
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, tasks.length)) }, worker));
  return out;
}

/**
 * green: every command passed · red: any failed · not here: none failed, some could
 * not run (or every test of a file was skipped here) · no dod.
 */
export function verdictOf(cmds) {
  if (!cmds.length) return "no dod";
  if (cmds.some((c) => c.status === "fail")) return "red";
  if (cmds.some((c) => c.status === "not here" || c.status === "skipped")) return "not here";
  return "green";
}

const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The markdown table. */
export function reportMarkdown(rows, { sha, branch, runner, at, mode = "--p0" }) {
  const n = (v) => rows.filter((r) => r.verdict === v).length;
  // Review 9, L12: the header names the run that was made, not always "P0 … --runner <shim>".
  const what = mode === "--done" ? "✅" : mode === "--p0" ? "P0" : "selected";
  const lines = [
    `# ${what === "selected" ? "Selected" : what} definition-of-done run on ${branch} @ ${sha.slice(0, 10)}`,
    "",
    `Generated by \`node scripts/dod.mjs ${mode}${runner ? " --runner <shim>" : ""} --report …\` at ${at}, commit ${sha}.`,
    `Runner for \`npx vitest run\`: ${runner ? "the offline shim (one file at a time; green = at least one pass and no failure)" : "vitest with its JSON reporter (green = at least one passed test per file and no failure)"}; every other command ran in a shell.`,
    "A command marked *not here* did not run on this machine (the reason is given), and *skipped* means every test of a file skipped itself here (its skip-reason); neither is a pass. Nothing in plan.json was changed by this run.",
    "",
    `**${rows.length} ${what} tasks:** green ${n("green")} · red ${n("red")} · not here ${n("not here")} · no dod ${n("no dod")}`,
    "",
    "| task | verdict | command | result | expected |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const r of rows) {
    r.cmds.forEach((c, i) => {
      lines.push(`| ${i === 0 ? cell(r.id) : ""} | ${i === 0 ? r.verdict : ""} | \`${cell(c.cmd.length > 140 ? `${c.cmd.slice(0, 137)}…` : c.cmd)}\` | ${c.status}: ${cell(c.detail)} | ${cell(r.expect[i] ?? "")} |`);
    });
    if (!r.cmds.length) lines.push(`| ${cell(r.id)} | no dod | — | — | — |`);
  }
  return `${lines.join("\n")}\n`;
}
