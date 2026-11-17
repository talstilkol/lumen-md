#!/usr/bin/env node
/**
 * Mac pack L3 (wave g6): run the lane's pack entries on the Mac and record
 * each one's result in one JSON file the integrator's aggregator can read.
 *
 *   node scripts/mac-pack/L3/run.mjs --list                 the entries, their needs and minutes
 *   node scripts/mac-pack/L3/run.mjs --check                the pack's shape and that every
 *                                                           script and spec it names exists; runs nothing
 *   node scripts/mac-pack/L3/run.mjs [--only a,b] [--skip a,b] [--from id] [--dry-run]
 *   node scripts/mac-pack/L3/run.mjs --verify-only          re-check every expect without running
 *                                                           (the files the commands wrote are already there)
 *
 *   --pack F   the pack (default plan/mac-pack/L3.json)
 *   --out F    the results (default reports/mac-pack/L3.json)
 *
 * Each entry's `cmd` runs in `sh -c` from the repository root, with a time
 * limit of 3 × its `minutes`. An entry whose `needs` names another entry
 * that failed still runs (its own expect decides), so one red step never
 * hides the rest. Results: { schema, lane, sha, dirty, machine, results: [{ id, ok, exit, minutes, detail }] }.
 * Exit 0 only when every entry that ran is ok.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkExpect, packErrors } from "./lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Read a JSON file; a `*` in the last path segment picks the newest match (by mtime). */
export function readJsonGlob(file, root = ROOT) {
  const abs = resolve(root, file);
  if (!abs.includes("*")) return JSON.parse(readFileSync(abs, "utf8"));
  // `a/*/report.json`: a star in a directory segment (one level only).
  const parts = abs.split("/");
  const star = parts.findIndex((p) => p.includes("*"));
  const base = parts.slice(0, star).join("/") || "/";
  const re = new RegExp(`^${parts[star].replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`);
  const rest = parts.slice(star + 1).join("/");
  const hits = (existsSync(base) ? readdirSync(base) : [])
    .filter((n) => re.test(n))
    .map((n) => join(base, n, rest))
    .filter((p) => existsSync(p) && statSync(p).isFile());
  if (!hits.length) throw new Error(`no file matches ${file}`);
  hits.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
  return JSON.parse(readFileSync(hits.at(-1), "utf8"));
}

/** Scripts and specs a command names that are not in the repository (for --check). */
export function missingRefs(cmd, { root = ROOT, scripts = {} } = {}) {
  const missing = [];
  for (const m of cmd.matchAll(/npm run ([a-z0-9:_-]+)/gi)) if (!(m[1] in scripts)) missing.push(`npm script ${m[1]}`);
  for (const m of cmd.matchAll(/(?:^|[\s,=])((?:scripts|e2e|src|sr)\/[\w./-]+\.(?:mjs|tsx|ts|sh|json))(?![\w.])/g)) if (!existsSync(join(root, m[1]))) missing.push(m[1]);
  return missing;
}

function git(args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
  const ids = (v) => (v ? new Set(v.split(",").map((s) => s.trim())) : null);
  const packFile = resolve(ROOT, opt("pack", "plan/mac-pack/L3.json"));
  const pack = JSON.parse(readFileSync(packFile, "utf8"));
  const errs = packErrors(pack);
  if (errs.length) {
    console.error(`✗ ${basename(packFile)}:\n  ${errs.join("\n  ")}`);
    process.exit(2);
  }
  if (argv.includes("--list")) {
    for (const e of pack) console.log(`${e.id.padEnd(16)} ${String(e.minutes).padStart(4)} min  needs: ${e.needs.join(", ") || "—"}\n    ${e.cmd}`);
    console.log(`\n${pack.length} entries, ${pack.reduce((n, e) => n + e.minutes, 0)} min of machine time declared`);
    return;
  }
  if (argv.includes("--check")) {
    const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts ?? {};
    const bad = pack.flatMap((e) => missingRefs(e.cmd, { scripts }).map((m) => `${e.id}: ${m}`));
    console.log(bad.length ? `✗ ${bad.length} missing:\n  ${bad.join("\n  ")}` : `✓ ${pack.length} entries; every script and spec they name exists`);
    process.exit(bad.length ? 1 : 0);
  }
  const only = ids(opt("only"));
  const skip = ids(opt("skip")) ?? new Set();
  const from = opt("from");
  const verifyOnly = argv.includes("--verify-only");
  const dry = argv.includes("--dry-run");
  let started = !from;
  const results = [];
  for (const e of pack) {
    if (e.id === from) started = true;
    if (!started || (only && !only.has(e.id)) || skip.has(e.id)) continue;
    console.log(`\n■ ${e.id} (${e.minutes} min) — ${e.cmd}`);
    if (dry) continue;
    const t0 = Date.now();
    let exit = null;
    if (!verifyOnly) {
      const r = spawnSync("sh", ["-c", e.cmd], { cwd: ROOT, stdio: "inherit", timeout: e.minutes * 3 * 60_000 });
      exit = r.status ?? (r.signal ? 128 : 1);
    }
    const expect = verifyOnly ? Object.fromEntries(Object.entries(e.expect).filter(([k]) => k !== "exit")) : e.expect;
    const v = Object.keys(expect).some((k) => k !== "says") ? checkExpect(expect, { exit, readJson: (f) => readJsonGlob(f) }) : { ok: false, detail: ["only an exit code to check: run it"] };
    results.push({ id: e.id, ok: v.ok, exit, minutes: Math.round((Date.now() - t0) / 6000) / 10, detail: v.detail });
    console.log(`${v.ok ? "✓" : "✗"} ${e.id}: ${v.detail.join("; ")}`);
  }
  if (dry) return;
  const out = resolve(ROOT, opt("out", "reports/mac-pack/L3.json"));
  mkdirSync(dirname(out), { recursive: true });
  const sha = git(["rev-parse", "HEAD"]);
  const dirty = (git(["status", "--porcelain", "--untracked-files=no"]) ?? "x") !== "";
  // Keep the results of entries this run did not touch (a run with --only adds to the file).
  let prior = [];
  try {
    const old = JSON.parse(readFileSync(out, "utf8"));
    if (old.sha === sha) prior = (old.results ?? []).filter((r) => !results.some((x) => x.id === r.id));
  } catch {
    /* first run */
  }
  const doc = {
    schema: "lumen.mac-pack/1",
    lane: "L3",
    pack: "plan/mac-pack/L3.json",
    sha,
    dirty,
    at: new Date().toISOString(),
    machine: { platform: platform(), release: release(), arch: arch(), cpus: cpus().length, memGiB: Math.round(totalmem() / 2 ** 30), node: process.version },
    results: [...prior, ...results],
  };
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  const bad = results.filter((r) => !r.ok);
  console.log(`\nmac-pack L3: ${results.length - bad.length}/${results.length} ok → ${out}${bad.length ? `\n  not ok: ${bad.map((r) => r.id).join(", ")}` : ""}`);
  process.exit(bad.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
