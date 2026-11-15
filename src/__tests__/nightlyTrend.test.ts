// @vitest-environment node
/**
 * Plan 0.11 (W10.E11): the nightly runs the Lighthouse trend (desktop and
 * mobile, median of 3) into reports/trend/ without Actions and without any
 * upload, and one command installs the launchd or cron scheduler.
 * The Lighthouse results below are synthetic (hand-made LHR shapes), not
 * real measurements.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations
import { COMMITTED, lighthouseEntry, stepsFor, uploadsIn } from "../../scripts/nightly/run.mjs";
import {
  HISTORY,
  appendHistory,
  collectConfig,
  lhciArgs,
  medians,
  trendMarkdown,
  // @ts-expect-error — plain .mjs module without type declarations
} from "../../scripts/nightly/lighthouse-trend.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { MARK_BEGIN, MARK_END, mergeCrontab, nightlyCommand, parseAt, renderCron, renderPlist } from "../../scripts/nightly/scheduler.mjs";

type Step = { id: string; cmd: string[] };
const REPO = resolve(".");
const lhr = (perf: number, lcp: number) => ({
  categories: { performance: { score: perf }, accessibility: { score: 0.97 }, "best-practices": { score: 0.9 }, seo: { score: 0.92 } },
  audits: { "largest-contentful-paint": { numericValue: lcp }, "total-blocking-time": { numericValue: 120 }, "cumulative-layout-shift": { numericValue: 0.01 }, "first-contentful-paint": { numericValue: 800 }, "speed-index": { numericValue: 1200 } },
});
const entry = (date: string, d: number, m: number) => ({ date, sha: "a".repeat(40), desktop: medians([lhr(d, 1500)]), mobile: medians([lhr(m, 3000)]) });

describe("the Lighthouse trend in the nightly perf run", () => {
  it("perf runs the trend script every night, and no kind runs a command that uploads", () => {
    const none = () => false;
    const every = () => true;
    const perf = stepsFor("perf", none);
    expect(perf.find((s: Step) => s.id === "lighthouse-trend")?.cmd).toEqual(["node", "scripts/nightly/lighthouse-trend.mjs"]);
    for (const kind of ["flake", "perf", "triage", "weekly", "sr"]) expect(uploadsIn(stepsFor(kind, every)), kind).toEqual([]);
    // The guard does catch the old step.
    expect(uploadsIn([{ id: "lighthouse", cmd: ["npm", "run", "lighthouse"] }]).length).toBe(1);
    expect(uploadsIn([{ id: "x", cmd: ["npx", "lhci", "upload", "--target=temporary-public-storage"] }]).length).toBe(1);
  });

  it("collects desktop and mobile from lighthouserc.json's collect section only: 3 runs, no upload, collect not autorun", () => {
    const rc = JSON.parse(readFileSync("lighthouserc.json", "utf8"));
    // The PR gate's config (W10.E9/E10, #680: its upload is the filesystem), which the nightly does not use.
    expect(rc.ci.upload?.target).toBe("filesystem");
    const desktop = collectConfig(rc, "desktop", 3);
    const mobile = collectConfig(rc, "mobile", 3);
    expect(desktop.ci.collect.settings.preset).toBe("desktop");
    expect(mobile.ci.collect.settings.preset).toBeUndefined();
    for (const c of [desktop, mobile]) {
      expect(c.ci.collect.numberOfRuns).toBe(3);
      expect(Object.keys(c.ci)).toEqual(["collect"]);
      expect(JSON.stringify(c)).not.toContain("temporary-public-storage");
      expect(JSON.stringify(c)).not.toContain("upload");
    }
    const args = lhciArgs("x.json");
    expect(args).toContain("collect");
    expect(args.join(" ")).not.toMatch(/autorun|upload/);
  });

  it("takes the median of the runs and keeps 180 nights, with the change since the last night", () => {
    const m = medians([lhr(0.7, 2000), lhr(0.9, 1000), lhr(0.8, 1500)]);
    expect(m.runs).toBe(3);
    expect(m.scores.performance).toBeCloseTo(80);
    expect(m.metrics["largest-contentful-paint"]).toBe(1500);
    let h: unknown[] = [];
    for (let i = 0; i < 200; i++) h = appendHistory(h, { i });
    expect(h.length).toBe(180);
    expect(h[179]).toEqual({ i: 199 });
    const md = trendMarkdown([entry("2026-11-13T02:17:00Z", 0.8, 0.5), entry("2026-11-14T02:17:00Z", 0.84, 0.47)], 3);
    expect(md).toContain("median of 3 runs, 2 night(s)");
    expect(md).toContain("84 (+4)");
    expect(md).toContain("47 (-3)");
    expect(md).toContain("| 2026-11-14 | 84 | 47 |");
    expect(HISTORY).toBe(join("reports", "trend", "lighthouse-history.json"));
  });

  it("the sealed perf report carries tonight's entry only", () => {
    const dir = mkdtempSync(join(tmpdir(), "lh-"));
    try {
      const f = join(dir, "h.json");
      writeFileSync(f, JSON.stringify([entry("2026-11-14T02:20:00Z", 0.8, 0.5)]));
      expect(lighthouseEntry(f, "2026-11-14T02:17:00Z")?.date).toBe("2026-11-14T02:20:00Z");
      expect(lighthouseEntry(f, "2026-11-15T02:17:00Z")).toBeNull();
      expect(lighthouseEntry(join(dir, "none.json"), "2026-11-15T02:17:00Z")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it(".gitignore lets --commit add reports/nightly and reports/trend (before, `reports/` ignored both)", () => {
    expect(COMMITTED).toEqual(["reports/nightly", "reports/trend"]);
    const dir = mkdtempSync(join(tmpdir(), "gi-"));
    try {
      spawnSync("git", ["init", "-q"], { cwd: dir });
      copyFileSync(".gitignore", join(dir, ".gitignore"));
      for (const f of ["reports/nightly/a.json", "reports/trend/lighthouse-history.json", "reports/other.json", "reports/perf/baselines/b.json", "reports/perf/run.json"]) {
        mkdirSync(join(dir, f, ".."), { recursive: true });
        writeFileSync(join(dir, f), "{}");
      }
      const r = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: dir, encoding: "utf8" });
      const seen = r.stdout.split("\n").filter((l) => l.includes("reports/")).map((l) => l.slice(3)).sort();
      expect(seen).toEqual(["reports/nightly/a.json", "reports/perf/baselines/b.json", "reports/trend/lighthouse-history.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the runner names the doc that exists (contributing/nightly.md), not docs/dev/nightly.md", () => {
    const src = readFileSync("scripts/nightly/run.mjs", "utf8");
    expect(src).not.toContain("docs/dev/nightly");
    expect(src).not.toContain("docs dev/nightly");
    expect(src).toContain("docs/src/content/docs/contributing/nightly.md");
    expect(existsSync("docs/src/content/docs/contributing/nightly.md")).toBe(true);
    expect(existsSync("docs/src/content/docs/he/contributing/nightly.md")).toBe(true);
  });
});

describe("one command installs the scheduler", () => {
  const at = { repo: "/Users/tal/lumen nightly", hour: 2, minute: 17, log: "/Users/tal/Library/Logs/lumen-nightly.log" };

  it("reads HH:MM and refuses anything else", () => {
    expect(parseAt("02:17")).toEqual({ hour: 2, minute: 17 });
    expect(parseAt("23:59")).toEqual({ hour: 23, minute: 59 });
    for (const bad of ["24:00", "2:7", "noon", ""]) expect(() => parseAt(bad)).toThrow();
  });

  it("launchd: the repo's plist with the command, the time and the log, XML-escaped", () => {
    const plist = renderPlist(at);
    expect(plist).toContain("<string>dev.lumen-md.nightly</string>");
    expect(plist).toContain("<key>Hour</key><integer>2</integer><key>Minute</key><integer>17</integer>");
    expect(plist).toContain("cd '/Users/tal/lumen nightly' &amp;&amp; git pull -q --rebase origin main &amp;&amp; npm ci --silent &amp;&amp; npm run nightly -- --scheduled --commit");
    expect(plist).not.toMatch(/\{\{\w+\}\}/);
    expect(plist).not.toMatch(/&&/);
    if (spawnSync("xmllint", ["--version"]).status === 0) expect(spawnSync("xmllint", ["--noout", "-"], { input: plist }).status).toBe(0);
  });

  it("cron: one line between markers; installing twice keeps one, other lines stay, uninstall removes it", () => {
    const block = renderCron(at);
    expect(block.split("\n")).toEqual([MARK_BEGIN, `17 2 * * * ${nightlyCommand(at.repo)} >> '${at.log}' 2>&1`, MARK_END]);
    const mine = "MAILTO=me\n0 5 * * * backup\n";
    const once = mergeCrontab(mine, block);
    expect(mergeCrontab(once, block)).toBe(once);
    expect(once.startsWith(mine)).toBe(true);
    expect(once.split(MARK_BEGIN).length).toBe(2);
    expect(mergeCrontab(once, null)).toBe(mine);
    expect(mergeCrontab("", block)).toBe(`${block}\n`);
  });

  it("the CLI prints what it would install on either platform and changes nothing", () => {
    const run = (...a: string[]) => spawnSync(process.execPath, ["scripts/nightly/scheduler.mjs", ...a, "--print", "--repo", "/srv/lumen-nightly"], { cwd: REPO, encoding: "utf8" });
    const mac = run("--platform", "darwin", "--at", "03:41");
    expect(mac.status).toBe(0);
    expect(mac.stdout).toContain("Library/LaunchAgents/dev.lumen-md.nightly.plist");
    expect(mac.stdout).toContain("<integer>3</integer><key>Minute</key><integer>41</integer>");
    const linux = run("--platform", "linux");
    expect(linux.status).toBe(0);
    expect(linux.stdout).toContain(`17 2 * * * cd '/srv/lumen-nightly' && git pull`);
    expect(run("--platform", "win32").status).toBe(2);
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts["nightly:install"]).toBe("node scripts/nightly/scheduler.mjs");
  });
});
