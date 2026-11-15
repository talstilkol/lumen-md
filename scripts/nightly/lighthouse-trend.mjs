#!/usr/bin/env node
/**
 * Lighthouse trend (plan 0.11; W10.E11): desktop and mobile, 3 runs each
 * against the built dist/, the median of each score and metric appended to
 * a JSON history in reports/trend/ (committed by `npm run nightly --
 * --commit`). The nightly perf run (scripts/nightly/run.mjs) runs it on the
 * owner's machine; no GitHub Actions.
 *
 *   node scripts/nightly/lighthouse-trend.mjs [history.json]
 *
 * Needs dist/ (npm run build) and Chrome. Writes reports/trend/lighthouse-history.json
 * and reports/trend/lighthouse-trend.md.
 *
 * Nothing leaves the machine: it runs `lhci collect` only, never `autorun`
 * or `upload`, and the config it writes has no `upload` section (the
 * checked-in lighthouserc.json uploads to temporary-public-storage, a public
 * Google bucket; that config is the PR gate's, not the nightly's).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { median, summary, table } from "./lib.mjs";

const LHCI = "@lhci/cli@0.15.1";
export const RUNS = Number(process.env.LH_RUNS ?? 3);
export const TREND_DIR = join("reports", "trend");
export const HISTORY = join(TREND_DIR, "lighthouse-history.json");
export const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];
export const METRICS = ["first-contentful-paint", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "speed-index"];
export const FORM_FACTORS = ["desktop", "mobile"];

/** The lhci config of one form factor: the collect section of lighthouserc.json only (no upload, no assert). */
export function collectConfig(rc, formFactor, runs = RUNS) {
  const base = rc.ci.collect;
  const settings = { ...base.settings };
  // The checked-in config is the desktop preset; mobile is Lighthouse's default.
  if (formFactor === "mobile") delete settings.preset;
  else settings.preset = "desktop";
  return { ci: { collect: { ...base, numberOfRuns: runs, settings } } };
}

/** The lhci command line: collect only. */
export const lhciArgs = (rcPath) => ["-y", LHCI, "collect", `--config=${rcPath}`];

/** Lighthouse results (LHRs) of one form factor → the medians. */
export function medians(lhrs) {
  const scores = Object.fromEntries(CATEGORIES.map((c) => [c, median(lhrs.map((l) => (l.categories?.[c]?.score ?? NaN) * 100))]));
  const metrics = Object.fromEntries(METRICS.map((m) => [m, median(lhrs.map((l) => l.audits?.[m]?.numericValue ?? NaN))]));
  return { runs: lhrs.length, scores, metrics };
}

/** history + entry, the newest 180 nights (half a year). */
export const appendHistory = (history, entry, max = 180) => [...(Array.isArray(history) ? history : []), entry].slice(-max);

const round = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? "–" : Number(v.toFixed(d)));
const delta = (now, prev) => (prev === null || prev === undefined || now === null || now === undefined ? "" : ` (${now - prev >= 0 ? "+" : ""}${round(now - prev)})`);

/** The trend as markdown: this night per form factor with the change since the last, and 14 nights of performance. */
export function trendMarkdown(history, runs = RUNS) {
  const entry = history[history.length - 1];
  const prev = history.length > 1 ? history[history.length - 2] : null;
  const lines = [`## Lighthouse trend: median of ${runs} runs, ${history.length} night(s) of history`, ""];
  for (const ff of FORM_FACTORS) {
    const s = entry[ff].scores;
    lines.push(
      `**${ff}**`,
      "",
      table(
        [...CATEGORIES, "LCP ms", "TBT ms", "CLS"],
        [
          [
            ...CATEGORIES.map((c) => `${round(s[c])}${delta(s[c], prev?.[ff]?.scores?.[c])}`),
            round(entry[ff].metrics["largest-contentful-paint"]),
            round(entry[ff].metrics["total-blocking-time"]),
            round(entry[ff].metrics["cumulative-layout-shift"], 3),
          ],
        ],
      ),
      "",
    );
  }
  lines.push(
    "Performance over the last nights:",
    "",
    table(["date", "desktop", "mobile"], history.slice(-14).map((h) => [h.date.slice(0, 10), round(h.desktop?.scores?.performance ?? null), round(h.mobile?.scores?.performance ?? null)])),
  );
  return lines.join("\n") + "\n";
}

function collect(formFactor) {
  const out = join(".lighthouseci", formFactor);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const rc = join(out, "..", `lighthouserc.${formFactor}.json`);
  writeFileSync(rc, JSON.stringify(collectConfig(JSON.parse(readFileSync("lighthouserc.json", "utf8")), formFactor), null, 2));
  const res = spawnSync("npx", lhciArgs(rc), { stdio: "inherit", env: { ...process.env, LHCI_BUILD_CONTEXT__CURRENT_HASH: process.env.GITHUB_SHA ?? "" } });
  if (res.status !== 0) throw new Error(`lhci collect (${formFactor}) failed with ${res.status}`);
  // lhci collect writes .lighthouseci/lhr-*.json; keep this form factor's apart.
  const lhrs = readdirSync(".lighthouseci")
    .filter((f) => /^lhr-.*\.json$/.test(f))
    .map((f) => {
      const p = join(".lighthouseci", f);
      const lhr = JSON.parse(readFileSync(p, "utf8"));
      rmSync(p);
      return lhr;
    });
  if (!lhrs.length) throw new Error(`lhci collect (${formFactor}) wrote no reports`);
  return medians(lhrs);
}

function main() {
  const historyIn = process.argv[2] ?? HISTORY;
  let history = [];
  if (existsSync(historyIn)) {
    try {
      history = JSON.parse(readFileSync(historyIn, "utf8"));
    } catch {
      history = [];
    }
  }
  const git = (...a) => spawnSync("git", a, { encoding: "utf8" }).stdout?.trim() || null;
  const entry = {
    date: new Date().toISOString(),
    sha: process.env.GITHUB_SHA ?? git("rev-parse", "HEAD"),
    ref: process.env.GITHUB_REF_NAME ?? git("rev-parse", "--abbrev-ref", "HEAD"),
    run: process.env.GITHUB_RUN_ID ?? null,
    desktop: collect("desktop"),
    mobile: collect("mobile"),
  };
  history = appendHistory(history, entry);
  const write = (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  write(historyIn, JSON.stringify(history, null, 2) + "\n");
  const md = trendMarkdown(history);
  write(join(dirname(historyIn), "lighthouse-trend.md"), md);
  summary(md);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
