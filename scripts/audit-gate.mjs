#!/usr/bin/env node
/**
 * npm audit gate (plan 2.8): fails on any high or critical advisory in the
 * lockfile of the current directory, the same as
 * `npm audit --audit-level=high`, except for advisories listed in
 * security/audit-ignore.json for this directory and not yet expired.
 *
 * An exception needs an advisory id, a reason and an expiry date; an expired
 * or malformed one fails the gate, so an ignore can never become permanent
 * by being forgotten.
 *
 * Usage (from the directory with the lockfile): node scripts/audit-gate.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = relative(root, process.cwd()) || ".";
const LEVELS = new Set(["high", "critical"]);
const today = new Date().toISOString().slice(0, 10);
let failed = false;
const fail = (msg) => {
  console.error(`::error::${msg}`);
  failed = true;
};

const { ignore } = JSON.parse(readFileSync(join(root, "security/audit-ignore.json"), "utf8"));
const active = new Map();
for (const e of ignore) {
  if (!/^GHSA-[\w-]+$/.test(e.id ?? "") || !e.reason || !/^\d{4}-\d{2}-\d{2}$/.test(e.expires ?? "")) {
    fail(`audit-ignore.json: entry ${JSON.stringify(e)} needs id (GHSA-...), reason and expires (YYYY-MM-DD)`);
  } else if ((e.dir ?? ".") !== dir) {
    continue;
  } else if (e.expires < today) {
    fail(`audit-ignore.json: the exception for ${e.id} expired on ${e.expires}; fix it or renew it with a new reason`);
  } else {
    active.set(e.id, e);
  }
}

// npm audit exits non-zero when it finds anything; the JSON is what counts.
let out;
try {
  out = execFileSync("npm", ["audit", "--package-lock-only", "--json"], { encoding: "utf8", maxBuffer: 64 << 20 });
} catch (err) {
  out = err.stdout;
}
const report = JSON.parse(out);
if (report.error) {
  fail(`npm audit failed in ${dir}: ${report.error.summary ?? JSON.stringify(report.error)}`);
}

const counts = report.metadata?.vulnerabilities ?? {};
console.log(`npm audit in ${dir}: ${JSON.stringify(counts)}`);
for (const [name, v] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of v.via) {
    if (typeof via !== "object" || !LEVELS.has(via.severity)) continue;
    const id = via.url?.match(/GHSA-[\w-]+/)?.[0] ?? String(via.source);
    if (active.has(id)) {
      console.log(`  ignored until ${active.get(id).expires}: ${id} (${name}, ${via.severity}): ${active.get(id).reason}`);
    } else {
      fail(`${dir}: ${via.severity} ${id} in ${name} ${v.range}: ${via.title} (fix: ${JSON.stringify(v.fixAvailable)})`);
    }
  }
}
process.exit(failed ? 1 : 0);
