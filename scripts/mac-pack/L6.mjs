#!/usr/bin/env node
/**
 * Lane L6's Mac pack runner (wave g6): run entries of plan/mac-pack/L6.json
 * (or the `cmd` of an owner entry in plan/owner-pack/L6.json) and check
 * each one's machine-checkable `expect`. One JSON result per entry, for the
 * integrator's aggregator:
 *
 *   node scripts/mac-pack/L6.mjs --list                 ids, tasks, minutes
 *   node scripts/mac-pack/L6.mjs L6-W7.4-e2e …          run these
 *   node scripts/mac-pack/L6.mjs --all [--skip a,b]     every Mac entry, in order
 *   node scripts/mac-pack/L6.mjs --check <id> …         only check `expect` against the files a run left
 *   node scripts/mac-pack/L6.mjs … --dry                print the commands, run nothing
 *   node scripts/mac-pack/L6.mjs --owner <id> …         an owner entry's cmd/expect
 *
 * Writes reports/mac-pack/L6/<id>.result.json:
 *   { id, task, at, commit, exit, ms, ok, checks: [{ what, ok, got }] }
 * and exits 0 only when every entry it ran is ok.
 *
 * `expect` (all parts must hold):
 *   exit: n                                  the command's exit code
 *   json: [{ file, path, equals|gte|lte }]   a field of a JSON file the run wrote
 *   stdout: { path, equals|gte|lte }         a field of the last JSON line on stdout
 *   count: { glob, gte }                     files matching a glob (one * per segment, {a,b})
 * `path` is "a.b.c" or ["a", "b.c"] when a key has a dot.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = "reports/mac-pack/L6";

export function loadPacks(dir = root) {
  const mac = JSON.parse(readFileSync(join(dir, "plan/mac-pack/L6.json"), "utf8"));
  const owner = JSON.parse(readFileSync(join(dir, "plan/owner-pack/L6.json"), "utf8"));
  return { mac, owner };
}

export function getPath(obj, path) {
  const keys = Array.isArray(path) ? path : String(path).split(".");
  let v = obj;
  for (const k of keys) {
    if (v == null || typeof v !== "object" || !(k in v)) return undefined;
    v = v[k];
  }
  return v;
}

function compare(got, rule) {
  if ("equals" in rule) return JSON.stringify(got) === JSON.stringify(rule.equals);
  if ("gte" in rule) return typeof got === "number" && got >= rule.gte;
  if ("lte" in rule) return typeof got === "number" && got <= rule.lte;
  return got !== undefined;
}

/** The last line of the text that parses as a JSON object (or the whole text). */
export function lastJson(text) {
  try {
    const whole = JSON.parse(text);
    if (whole && typeof whole === "object") return whole;
  } catch {
    // not one JSON document: look line by line
  }
  const lines = String(text).trim().split(/\r?\n/).reverse();
  for (const l of lines) {
    const t = l.trim();
    if (!t.startsWith("{")) continue;
    try {
      return JSON.parse(t);
    } catch {
      // keep looking
    }
  }
  return null;
}

function expand(glob) {
  const m = glob.match(/\{([^}]+)\}/);
  return m ? m[1].split(",").flatMap((alt) => expand(glob.replace(m[0], alt))) : [glob];
}

/** Files matching a glob relative to `base`: `*` matches within one path segment. */
export function globCount(glob, base = root) {
  const found = new Set();
  for (const g of expand(glob)) {
    let dirs = [""];
    const parts = g.split("/");
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      const re = new RegExp(`^${part.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")}$`);
      const next = [];
      for (const d of dirs) {
        const abs = join(base, d);
        if (!existsSync(abs)) continue;
        let names;
        try {
          names = readdirSync(abs, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const e of names) if (re.test(e.name) && (last || e.isDirectory())) next.push(d ? `${d}/${e.name}` : e.name);
      }
      dirs = next;
    });
    for (const f of dirs) found.add(f);
  }
  return found.size;
}

/** Check an entry's `expect` against a finished run. Pure apart from reading the files it names. */
export function evaluate(expect, run, base = root) {
  const checks = [];
  if (expect.exit !== undefined) checks.push({ what: `exit ${expect.exit}`, ok: run.exit === expect.exit, got: run.exit });
  for (const j of expect.json ?? []) {
    const f = join(base, j.file);
    let got;
    try {
      got = getPath(JSON.parse(readFileSync(f, "utf8")), j.path);
    } catch (e) {
      got = `unreadable: ${e instanceof Error ? e.message : String(e)}`;
    }
    checks.push({ what: `${j.file} ${JSON.stringify(j.path)} ${JSON.stringify({ ...j, file: undefined, path: undefined })}`, ok: compare(got, j), got });
  }
  if (expect.stdout) {
    const got = getPath(lastJson(run.stdout ?? "") ?? {}, expect.stdout.path);
    checks.push({ what: `stdout ${JSON.stringify(expect.stdout)}`, ok: compare(got, expect.stdout), got });
  }
  if (expect.count) {
    const got = globCount(expect.count.glob, base);
    checks.push({ what: `count ${expect.count.glob} >= ${expect.count.gte}`, ok: got >= expect.count.gte, got });
  }
  return { ok: checks.length > 0 && checks.every((c) => c.ok), checks };
}

function commit() {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function runEntry(e, { dry, checkOnly }) {
  if (dry) {
    console.log(`# ${e.id} (${e.task}, ~${e.minutes ?? "?"} min)\n${e.cmd}\n`);
    return true;
  }
  const t0 = Date.now();
  let run = { exit: null, stdout: "" };
  if (!checkOnly) {
    console.error(`── ${e.id}: ${e.cmd}`);
    const r = spawnSync("bash", ["-lc", e.cmd], { cwd: root, encoding: "utf8", stdio: ["inherit", "pipe", "inherit"], maxBuffer: 1 << 28 });
    process.stdout.write(r.stdout ?? "");
    run = { exit: r.status, stdout: r.stdout ?? "" };
  }
  const expect = checkOnly ? { ...e.expect, exit: undefined } : e.expect;
  const v = evaluate(expect, run);
  const result = { id: e.id, task: e.task, at: new Date().toISOString(), commit: commit(), exit: run.exit, ms: Date.now() - t0, ok: v.ok, checks: v.checks };
  mkdirSync(join(root, OUT), { recursive: true });
  writeFileSync(join(root, OUT, `${e.id}.result.json`), JSON.stringify(result, null, 2) + "\n");
  console.error(`${v.ok ? "✓" : "✗"} ${e.id} ${v.checks.map((c) => `${c.ok ? "ok" : "FAIL"} ${c.what} (got ${JSON.stringify(c.got)})`).join("; ")}`);
  return v.ok;
}

function main(argv) {
  const { mac, owner } = loadPacks();
  const dry = argv.includes("--dry");
  const skipAt = argv.indexOf("--skip");
  const skip = new Set(skipAt >= 0 ? argv[skipAt + 1].split(",") : []);
  if (argv.includes("--list")) {
    for (const e of mac) console.log(`${e.id}\t${e.task}\t${e.minutes} min`);
    for (const e of owner) console.log(`${e.id}\t${e.task}\towner`);
    return 0;
  }
  const isOwner = argv.includes("--owner");
  const checkOnly = argv.includes("--check");
  const pool = isOwner ? owner : mac;
  const ids = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--skip");
  const chosen = argv.includes("--all") ? pool.filter((e) => !skip.has(e.id)) : ids.map((id) => pool.find((e) => e.id === id) ?? id);
  const unknown = chosen.filter((e) => typeof e === "string");
  if (unknown.length || !chosen.length) {
    console.error(unknown.length ? `unknown id: ${unknown.join(", ")}` : "usage: L6.mjs --list | <id>… | --all [--skip a,b] [--dry] [--check] [--owner]");
    return 2;
  }
  let ok = true;
  for (const e of chosen) ok = runEntry(e, { dry, checkOnly }) && ok;
  return ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
