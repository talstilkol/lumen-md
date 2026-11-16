#!/usr/bin/env node
/**
 * One Playwright run for the whole Mac pack (scripts/mac-pack/run-all.mjs):
 * stand in for `npx playwright test <specs…> --project=<p>…` by cutting that
 * slice out of the shared JSON report instead of starting the browsers again.
 *
 *   node scripts/mac-pack/pw-from-shared.mjs --report <shared.json> [--out <file>] --project=<p>… [<spec>…]
 *
 * Writes the slice (same shape as Playwright's JSON reporter, `stats`
 * recounted) to --out, and exits like Playwright would: 1 when the slice has
 * an unexpected test, a load error in one of its files, or no test at all;
 * otherwise 0 (Playwright does not fail on flaky tests, so neither does this;
 * the entries' own checks read `.stats.flaky`). Exit 2: no shared report.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const norm = (p) => String(p ?? "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^e2e\//, "");

/** Does a report file path (relative to the test dir) match one CLI spec filter? */
export function specMatches(file, spec) {
  // Playwright treats a file argument as a filter on the path; the report's
  // paths are relative to testDir ("./e2e" in playwright.config.ts).
  const path = `e2e/${norm(file)}`;
  const s = String(spec ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!s || s === "e2e" || s === "e2e/") return true;
  return path.includes(s);
}

/** The slice of `report` for `specs` (none = every file) and `projects`. */
export function slice(report, specs, projects) {
  const keepFile = (file) => !specs.length || specs.some((s) => specMatches(file, s));
  const counts = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  const cut = (suite, file) => {
    const f = suite.file ?? file;
    const specsOut = [];
    for (const sp of suite.specs ?? []) {
      if (!keepFile(sp.file ?? f)) continue;
      const tests = (sp.tests ?? []).filter((t) => projects.includes(t.projectName));
      if (!tests.length) continue;
      for (const t of tests) if (t.status in counts) counts[t.status]++;
      specsOut.push({ ...sp, tests, ok: tests.every((t) => t.status !== "unexpected") });
    }
    const suitesOut = (suite.suites ?? []).map((s) => cut(s, f)).filter(Boolean);
    if (!specsOut.length && !suitesOut.length) return null;
    return { ...suite, specs: specsOut, suites: suitesOut };
  };
  const suites = (report.suites ?? []).map((s) => cut(s, s.file)).filter(Boolean);
  const errors = (report.errors ?? []).filter((e) => {
    const file = e.location?.file ?? e.file;
    return !file || specs.length === 0 || specs.some((s) => specMatches(String(file).split("/e2e/").pop(), s));
  });
  const stats = { ...(report.stats ?? {}), ...counts };
  const total = counts.expected + counts.unexpected + counts.flaky + counts.skipped;
  const code = total === 0 || counts.unexpected > 0 || errors.length > 0 ? 1 : 0;
  return { report: { config: report.config, suites, errors, stats, slicedFrom: { specs, projects } }, code, total };
}

function main(argv) {
  const args = [...argv];
  const take = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return null;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const reportPath = take("--report");
  const out = take("--out");
  const projects = args.filter((a) => a.startsWith("--project=")).map((a) => a.slice(10));
  const specs = args.filter((a) => !a.startsWith("--"));
  if (!reportPath || !existsSync(reportPath)) {
    console.error(`pw-from-shared: no shared report at ${reportPath}: run the shared e2e step first`);
    return 2;
  }
  const r = slice(JSON.parse(readFileSync(reportPath, "utf8")), specs, projects);
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, `${JSON.stringify(r.report, null, 2)}\n`);
  }
  const s = r.report.stats;
  console.log(`pw-from-shared: ${r.total} tests (${s.expected} expected, ${s.unexpected} unexpected, ${s.flaky} flaky, ${s.skipped} skipped) from ${reportPath}${out ? ` → ${out}` : ""}`);
  return r.code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
