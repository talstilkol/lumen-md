#!/usr/bin/env node
/**
 * Launch gates as code (plan W11.L1).
 *
 *   npm run launch:gate -- M0            PASS/FAIL per criterion of M0; exit 1 unless all pass
 *   npm run launch:gate -- M0 --json     the same as JSON
 *   npm run launch:gate -- GA            the 1.0 GA exit checklist: every open item
 *   npm run launch:gate -- --check       only check docs/launch/milestones.json itself, and
 *                                        that docs/launch/ga-checklist.md is built from it
 *   npm run launch:gate -- --checklist   rebuild docs/launch/ga-checklist.md
 *   npm run launch:gate -- --beta-metrics <dir>
 *                                        the beta metrics (W11.L2) from a folder of weekly
 *                                        opt-in beta reports, as JSON for a metric receipt
 *   … --root <dir>                       another checkout (the tests use this)
 *
 * Reads docs/launch/milestones.json and the receipts in
 * docs/launch/receipts/<milestone>/<criterion>.json. Runs no tests and sends
 * nothing: a receipt is the record of a run made elsewhere (see
 * docs/launch/receipts/README.md). A criterion without a valid receipt fails.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { aggregateBetaReports, checklistMarkdown, evaluate, gateText, milestoneProblems } from "./lib/launchGate.mjs";

const args = process.argv.slice(2);
const rootAt = args.indexOf("--root");
const root = resolve(rootAt >= 0 ? args[rootAt + 1] : ".");
const valueFlags = ["--root", "--beta-metrics"];
const ids = args.filter((a, i) => !a.startsWith("--") && !valueFlags.includes(args[i - 1]));

const metricsAt = args.indexOf("--beta-metrics");
if (metricsAt >= 0) {
  const dir = resolve(args[metricsAt + 1] ?? "");
  let reports;
  try {
    reports = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  } catch (e) {
    console.error(`✖ ${dir}: ${e.message}`);
    process.exit(2);
  }
  const m = aggregateBetaReports(reports);
  process.stdout.write(JSON.stringify({ ...m, evidence: dir }, null, 2) + "\n");
  process.exit(m.reports > 0 ? 0 : 1);
}
const file = join(root, "docs/launch/milestones.json");

let data;
try {
  data = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  console.error(`✖ ${file}: ${e.message}`);
  process.exit(2);
}
const shape = milestoneProblems(data);
if (shape.length) {
  for (const p of shape) console.error(`✖ ${p}`);
  process.exit(2);
}
const checklistFile = join(root, "docs/launch/ga-checklist.md");
if (args.includes("--checklist")) {
  writeFileSync(checklistFile, checklistMarkdown(data));
  console.log(`✓ wrote ${checklistFile}`);
  process.exit(0);
}
if (args.includes("--check")) {
  const built = checklistMarkdown(data);
  const onDisk = existsSync(checklistFile) ? readFileSync(checklistFile, "utf8") : null;
  if (onDisk !== built) {
    console.error(`✖ docs/launch/ga-checklist.md ${onDisk === null ? "is missing" : "differs from milestones.json"}: run npm run launch:gate -- --checklist`);
    process.exit(2);
  }
  console.log(`✓ milestones.json: ${data.milestones.length} milestones, ${data.milestones.reduce((n, m) => n + m.criteria.length, 0)} criteria, each mapped to a plan acceptance and a receipt`);
  process.exit(0);
}
if (ids.length !== 1) {
  console.error(`usage: npm run launch:gate -- <${data.milestones.map((m) => m.id).join("|")}> [--json] [--root <dir>]`);
  process.exit(2);
}

const commitExists = (sha) => {
  try {
    execFileSync("git", ["-C", root, "cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" });
    return true;
  } catch {
    return false; // not a git checkout, or the commit is not in it: the receipt cannot be tied to this code
  }
};
const readReceipt = (m, c) => {
  const p = join(root, "docs/launch/receipts", m, `${c}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
};
const today = process.env.LAUNCH_GATE_TODAY ?? new Date().toISOString().slice(0, 10);
let r;
try {
  r = evaluate(data, ids[0], { readReceipt, commitExists, fileExists: (f) => existsSync(join(root, f)), today });
} catch (e) {
  console.error(`✖ ${e.message}`);
  process.exit(2);
}
process.stdout.write(args.includes("--json") ? JSON.stringify(r, null, 2) + "\n" : gateText(r));
process.exit(r.pass ? 0 : 1);
