#!/usr/bin/env node
/**
 * One command installs the nightly scheduler (plan 0.11, W10.E11):
 * launchd on a Mac, cron on Linux, from the templates next to this file
 * (scripts/nightly/launchd.plist, scripts/nightly/crontab).
 *
 *   npm run nightly:install                 # this clone, 02:17 local time
 *   npm run nightly:install -- --at 03:41   # another time
 *   npm run nightly:install -- --print      # print what it would install, change nothing
 *   npm run nightly:install -- --uninstall
 *
 * Each night: `git pull --rebase origin main` onto the clone's own branch, `npm ci`,
 * then `npm run nightly -- --scheduled --commit`. The run commits its
 * reports locally and never pushes; nothing is uploaded anywhere.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const LABEL = "dev.lumen-md.nightly";
export const MARK_BEGIN = "# >>> lumen-md nightly (npm run nightly:install) >>>";
export const MARK_END = "# <<< lumen-md nightly <<<";
export const DEFAULT_AT = "02:17";

/** "02:17" → { hour: 2, minute: 17 }; anything else throws. */
export function parseAt(at) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(at ?? ""));
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`--at wants HH:MM (got "${at}")`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/** A path in single quotes for sh/zsh. */
const sq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/** The command the scheduler runs in `repo`. */
export const nightlyCommand = (repo) => `cd ${sq(repo)} && git pull -q --rebase origin main && npm ci --silent && npm run nightly -- --scheduled --commit`;

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Fill a template's {{…}} fields; a field left over is an error. */
export function fill(template, fields, escape = (s) => s) {
  const out = template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in fields)) throw new Error(`template field {{${k}}} has no value`);
    return escape(String(fields[k]));
  });
  return out;
}

export function renderPlist({ repo, hour, minute, log }, template = readFileSync(join(here, "launchd.plist"), "utf8")) {
  return fill(template, { COMMAND: nightlyCommand(repo), HOUR: hour, MINUTE: minute, LOG: log }, xml);
}

/** The crontab block (markers, comment lines dropped, the job line). */
export function renderCron({ repo, hour, minute, log }, template = readFileSync(join(here, "crontab"), "utf8")) {
  const line = template
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => fill(l, { COMMAND: nightlyCommand(repo), HOUR: hour, MINUTE: minute, LOG: sq(log) }))
    .join("\n");
  return `${MARK_BEGIN}\n${line}\n${MARK_END}`;
}

/** The user's crontab with our block replaced (or added, or removed with block = null); other lines untouched. */
export function mergeCrontab(existing, block) {
  const lines = String(existing ?? "").split("\n");
  const out = [];
  let inside = false;
  for (const l of lines) {
    if (l === MARK_BEGIN) inside = true;
    else if (l === MARK_END) inside = false;
    else if (!inside) out.push(l);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  if (block) out.push(...(out.length ? [""] : []), block);
  return out.length ? `${out.join("\n")}\n` : "";
}

export const plistPath = (home = homedir()) => join(home, "Library", "LaunchAgents", `${LABEL}.plist`);

function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const repo = resolve(opt("repo") ?? join(here, "..", ".."));
  const { hour, minute } = parseAt(opt("at") ?? DEFAULT_AT);
  const log = opt("log") ?? join(homedir(), "Library", "Logs", "lumen-nightly.log");
  const print = argv.includes("--print");
  const uninstall = argv.includes("--uninstall");
  const platform = opt("platform") ?? process.platform;
  const run = (cmd, args, input) => spawnSync(cmd, args, { encoding: "utf8", input });
  if (platform === "darwin") {
    const path = plistPath();
    const uid = process.getuid?.() ?? "";
    if (uninstall) {
      if (!print) {
        run("launchctl", ["bootout", `gui/${uid}`, path]);
        rmSync(path, { force: true });
      }
      console.log(print ? `would remove ${path}` : `✓ removed ${path}`);
      return;
    }
    const plist = renderPlist({ repo, hour, minute, log });
    if (print) return void console.log(`${path}:\n${plist}`);
    mkdirSync(dirname(path), { recursive: true });
    mkdirSync(dirname(log), { recursive: true });
    if (existsSync(path)) run("launchctl", ["bootout", `gui/${uid}`, path]);
    writeFileSync(path, plist);
    const r = run("launchctl", ["bootstrap", `gui/${uid}`, path]);
    if (r.status !== 0) {
      console.error(`✗ launchctl bootstrap: ${(r.stderr || "").trim()}`);
      process.exit(1);
    }
    console.log(`✓ launchd: ${LABEL} runs ${nightlyCommand(repo)} at ${opt("at") ?? DEFAULT_AT} (log ${log})`);
    return;
  }
  if (platform === "linux") {
    const cronLog = opt("log") ?? join(homedir(), ".cache", "lumen-nightly.log");
    const current = run("crontab", ["-l"]);
    const existing = current.status === 0 ? current.stdout : "";
    const next = mergeCrontab(existing, uninstall ? null : renderCron({ repo, hour, minute, log: cronLog }));
    if (print) return void console.log(next);
    mkdirSync(dirname(cronLog), { recursive: true });
    const r = run("crontab", ["-"], next);
    if (r.status !== 0) {
      console.error(`✗ crontab: ${(r.stderr || "").trim()}`);
      process.exit(1);
    }
    console.log(uninstall ? "✓ cron: the lumen-md nightly line is removed" : `✓ cron: ${nightlyCommand(repo)} at ${opt("at") ?? DEFAULT_AT} (log ${cronLog})`);
    return;
  }
  console.error(`✗ nightly:install: no scheduler for ${platform} (launchd on macOS, cron on Linux)`);
  process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
