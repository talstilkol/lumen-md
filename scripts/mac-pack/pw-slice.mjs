#!/usr/bin/env node
/**
 * One Mac run, many checks (wave g6, lane L1): read a Playwright JSON report
 * (`--reporter=json`) and judge only the tests of the given spec files.
 *
 *   node scripts/mac-pack/pw-slice.mjs <report.json> <spec> [<spec>…] --total <n> [--out <file>]
 *
 * Prints one JSON line {report, specs, total, expected, unexpected, flaky,
 * skipped, projects, ok} and writes it to --out when given. Exit 0 only when
 * the slice holds exactly --total tests, none of them unexpected or flaky,
 * and none skipped (a skipped test is not a pass). Exit 2 when the report is
 * missing or has none of the specs: the run did not happen.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Every test of the report whose file is one of `specs`, with its project and status. */
export function collect(report, specs) {
  const want = specs.map((s) => s.replace(/^\.?\/?(e2e\/)?/, ""));
  const out = [];
  const walk = (suite, file) => {
    const f = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      const sf = (spec.file ?? f ?? "").replace(/^\.?\/?(e2e\/)?/, "");
      if (!want.includes(sf)) continue;
      for (const t of spec.tests ?? []) out.push({ file: sf, title: spec.title, project: t.projectName, status: t.status });
    }
    for (const s of suite.suites ?? []) walk(s, f);
  };
  for (const s of report.suites ?? []) walk(s, s.file);
  return out;
}

/** The verdict for one slice. */
export function judge(tests, total) {
  const n = (st) => tests.filter((t) => t.status === st).length;
  const r = { total: tests.length, expected: n("expected"), unexpected: n("unexpected"), flaky: n("flaky"), skipped: n("skipped"), projects: [...new Set(tests.map((t) => t.project))].sort() };
  r.ok = tests.length === total && r.expected === total && r.unexpected === 0 && r.flaky === 0 && r.skipped === 0;
  return r;
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const total = Number(opt("--total"));
  const outFile = opt("--out");
  const [reportPath, ...specs] = args;
  if (!reportPath || !specs.length || !Number.isInteger(total)) {
    console.error("usage: pw-slice.mjs <report.json> <spec>… --total <n> [--out <file>]");
    return 2;
  }
  if (!existsSync(reportPath)) {
    console.log(JSON.stringify({ report: reportPath, specs, ok: false, error: "report missing: run the e2e batch first" }));
    return 2;
  }
  const tests = collect(JSON.parse(readFileSync(reportPath, "utf8")), specs);
  const res = { report: reportPath, specs, want: total, ...judge(tests, total) };
  if (!tests.length) res.error = "none of these specs is in the report";
  const line = JSON.stringify(res);
  console.log(line);
  if (outFile) {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, line + "\n");
  }
  return tests.length ? (res.ok ? 0 : 1) : 2;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv));
