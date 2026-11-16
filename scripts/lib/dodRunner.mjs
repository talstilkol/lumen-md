/**
 * Plan W10.Z3 / 13.5 / W10.Z1: run the dod of every P0 task on a train head
 * and write the table — honestly, where vitest itself cannot run.
 *
 * `npx vitest run <files|dirs>` goes through an offline per-file runner (the
 * shim: `<runner> <root> <file>`, last line "… pass N fail M"); a file is green
 * with at least one pass and no failure. Every other command runs in a shell.
 * Commands that cannot run on a cloud machine without the full install (a
 * browser, cargo, the npm registry, a GPU or the owner's accounts) are not run
 * and are reported as "not here", with the reason: never as a pass.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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

/**
 * One dod command → { cmd, status: "pass"|"fail"|"not here", detail }.
 * @param {string} cmd
 * @param {{ root: string, runner?: string|null, run?: typeof sh }} o
 */
export async function runCommand(cmd, { root, runner = null, run = sh }) {
  const why = notHere(cmd);
  if (why) return { cmd, status: "not here", detail: why };
  const files = runner ? vitestFiles(cmd, root) : null;
  if (files) {
    const parts = [];
    let ok = files.length > 0;
    for (const f of files) {
      if (!existsSync(join(root, f))) {
        ok = false;
        parts.push(`${f}: no such file`);
        continue;
      }
      const r = await run(runner, [root, f], { cwd: root });
      const c = counts(r.out);
      const green = !!c && c.pass > 0 && c.fail === 0;
      if (!green) ok = false;
      parts.push(`${f.split("/").pop()} ${c ? `${c.pass}/${c.pass + c.fail}` : "load error"}`);
    }
    return { cmd, status: ok ? "pass" : "fail", detail: parts.join(", ") || "no files" };
  }
  const r = await run("bash", ["-c", cmd], { cwd: root });
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

/** green: every command passed · red: any failed · not here: none failed, some could not run · no dod. */
export function verdictOf(cmds) {
  if (!cmds.length) return "no dod";
  if (cmds.some((c) => c.status === "fail")) return "red";
  if (cmds.some((c) => c.status === "not here")) return "not here";
  return "green";
}

const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The markdown table. */
export function reportMarkdown(rows, { sha, branch, runner, at }) {
  const n = (v) => rows.filter((r) => r.verdict === v).length;
  const lines = [
    `# P0 definition-of-done run on ${branch} @ ${sha.slice(0, 10)}`,
    "",
    `Generated by \`node scripts/dod.mjs --p0 --runner <shim> --report …\` at ${at}, commit ${sha}.`,
    `Runner for \`npx vitest run\`: ${runner ? "the offline shim (one file at a time; green = at least one pass and no failure)" : "vitest"}; every other command ran in a shell.`,
    "A command marked *not here* did not run on this machine (the reason is given) and is not a pass. Nothing in plan.json was changed by this run.",
    "",
    `**${rows.length} P0 tasks:** green ${n("green")} · red ${n("red")} · not here ${n("not here")} · no dod ${n("no dod")}`,
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
