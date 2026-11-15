/**
 * Plan W11.L2 — the M1–M4 gates and the 1.0 GA exit checklist as code, on
 * top of W11.L1's launch:gate. Every item maps to a plan acceptance and names
 * the receipt that proves it; beta metrics come from the weekly opt-in beta
 * reports (W11.P4); docs/launch/ga-checklist.md is built from the file.
 *
 * The beta reports below are SYNTHETIC: hand-made objects in the shape of
 * src/beta/programme.ts's BetaReport, not data from any tester.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  BETA_METRICS,
  aggregateBetaReports,
  checklistMarkdown,
  evaluate,
  milestoneProblems,
  receiptProblems,
  // @ts-expect-error — plain .mjs helpers without types
} from "../../scripts/lib/launchGate.mjs";

const repo = resolve(".");
const script = join(repo, "scripts/launch-gate.mjs");
const real = JSON.parse(readFileSync(join(repo, "docs/launch/milestones.json"), "utf8"));
const gate = (root: string, ...a: string[]) => spawnSync(process.execPath, [script, ...a, "--root", root], { encoding: "utf8", env: { ...process.env, LAUNCH_GATE_TODAY: "2027-06-01" } });

type Criterion = { id: string; group?: string; source: { task: string; acceptance: string; research?: string }; receipt: { kind: string; from?: string; metrics?: Array<{ name: string; min?: number; max?: number }>; tests?: string[]; runs?: string[]; facts?: string[] } };
type Milestone = { id: string; after?: string; criteria: Criterion[] };
const milestone = (id: string): Milestone => real.milestones.find((m: Milestone) => m.id === id);

describe("milestones.json: M1–M4 and GA", () => {
  it("is well formed, and M0 → M1 → M2 → M3 → M4 → GA each opens after the one before", () => {
    expect(milestoneProblems(real)).toEqual([]);
    expect(real.milestones.map((m: Milestone) => m.id)).toEqual(["M0", "M1", "M2", "M3", "M4", "GA"]);
    expect(real.milestones.map((m: Milestone) => m.after ?? null)).toEqual([null, "M0", "M1", "M2", "M3", "M4"]);
  });

  it("no item without a check: every criterion names its plan acceptance and a receipt with something to check", () => {
    for (const m of real.milestones as Milestone[]) {
      for (const c of m.criteria) {
        expect(c.source.task, c.id).toMatch(/^(W\d+\.[A-Z]*\d+|\d+\.\d+)$/);
        expect(c.source.acceptance.trim().length, c.id).toBeGreaterThan(3);
        const r = c.receipt;
        const things = (r.tests ?? []).length + (r.runs ?? []).length + (r.facts ?? []).length + (r.metrics ?? []).length;
        expect(things, `${m.id}/${c.id} has nothing to check`).toBeGreaterThan(0);
      }
    }
  });

  it("the R6 §5 milestone gates are all there, with their thresholds", () => {
    const metric = (m: string, c: string, name: string) => milestone(m).criteria.find((x) => x.id === c)!.receipt.metrics!.find((x) => x.name === name);
    expect(metric("M1", "activation-and-d7", "activationRate")).toEqual({ name: "activationRate", min: 0.5 });
    expect(metric("M1", "activation-and-d7", "d7")).toEqual({ name: "d7", min: 0.3 });
    expect(metric("M1", "zero-data-loss-reports", "dataLossReports")).toEqual({ name: "dataLossReports", max: 0 });
    expect(metric("M1", "unmoderated-ten-of-twelve", "finishedWithoutHelp")).toEqual({ name: "finishedWithoutHelp", min: 10 });
    expect(metric("M2", "three-hundred-and-d30", "optInUsers")).toEqual({ name: "optInUsers", min: 300 });
    expect(metric("M2", "three-hundred-and-d30", "d30")).toEqual({ name: "d30", min: 0.15 });
    expect(metric("M2", "real-exports-eighteen", "exportsPassed")).toEqual({ name: "exportsPassed", min: 18 });
    expect(metric("M2", "mobile-capture-three-seconds", "captureP95Ms")).toEqual({ name: "captureP95Ms", max: 3000 });
    expect(milestone("M3").criteria.map((c) => c.id)).toEqual(["comparison-twenty-of-twenty", "external-audit-commissioned", "store-privacy-labels-submitted"]);
    expect(milestone("M4").criteria.map((c) => c.id)).toEqual(["stores-in-production", "pricing-page-live", "audit-report-or-unaudited-label"]);
  });

  it("GA has the whole R6 §5 exit checklist, grouped Product / Trust / Community and business", () => {
    const ga = milestone("GA");
    expect(ga.criteria.length).toBe(24);
    expect([...new Set(ga.criteria.map((c) => c.group))]).toEqual(["Product", "Trust", "Community and business"]);
    for (const c of ga.criteria) expect(c.source.research, c.id).toBe("R6 §5");
    // Spot checks against the checklist's own numbers.
    const byId = new Map(ga.criteria.map((c) => [c.id, c]));
    expect(byId.get("vault-10k-and-crash-free")!.receipt.metrics).toEqual([{ name: "vault10kOpenMs", max: 3000 }, { name: "crashFreeSessions", min: 0.995 }]);
    expect(byId.get("beta-300-activation-retention")!.receipt).toMatchObject({ from: "beta-reports" });
    expect(byId.get("ttfv1-cold-p75")!.receipt.runs).toEqual(["ttfv-chromium", "ttfv-firefox", "ttfv-webkit"]);
  });

  it("a metric criterion without a source of values or a threshold is rejected", () => {
    const bad = structuredClone(real);
    const c = bad.milestones.find((m: Milestone) => m.id === "M1").criteria[0];
    delete c.receipt.from;
    c.receipt.metrics[0] = { name: "activationRate" };
    const p = milestoneProblems(bad);
    expect(p.some((x: string) => x.includes("where its values come from"))).toBe(true);
    expect(p.some((x: string) => x.includes("numeric min or max"))).toBe(true);
    const bad2 = structuredClone(real);
    bad2.milestones.find((m: Milestone) => m.id === "M1").criteria[0].receipt.metrics.push({ name: "madeUp", min: 1 });
    expect(milestoneProblems(bad2).some((x: string) => x.includes("not a metric the beta reports give"))).toBe(true);
  });
});

describe("launch:gate -- GA lists every open item", () => {
  it("fails today with all 24 items open, each named, and says M4 isn't green", () => {
    const r = gate(repo, "GA");
    expect(r.status).toBe(1);
    for (const c of milestone("GA").criteria) expect(r.stdout).toContain(`FAIL  ${c.id} [`);
    expect(r.stdout).toMatch(/^open \(24\): desktop-signed-update-rollback, /m);
    expect(r.stdout).toMatch(/FAIL GA: 0\/24 criteria with a valid receipt; M4 is not green/);
  });

  it("each of M1–M4 runs and fails without receipts", () => {
    for (const id of ["M1", "M2", "M3", "M4"]) {
      const r = gate(repo, id, "--json");
      expect(r.status, id).toBe(1);
      const out = JSON.parse(r.stdout);
      expect(out.passed, id).toBe(0);
      expect(out.total, id).toBe(milestone(id).criteria.length);
    }
  });
});

describe("metric receipts", () => {
  const c = milestone("M1").criteria.find((x) => x.id === "activation-and-d7")!;
  const ctx = { today: "2027-06-01", commitExists: () => true, fileExists: () => true };
  const good = { criterion: c.id, kind: "metric", result: "pass", date: "2027-01-10", by: "Tal", commit: "abc1234", metrics: { activationRate: 0.52, d7: 0.31 }, reports: 54, evidence: "beta-reports/2027-W02" };

  it("passes at or above every threshold", () => {
    expect(receiptProblems(c, good, ctx)).toEqual([]);
    expect(receiptProblems(c, { ...good, metrics: { activationRate: 0.5, d7: 0.3 } }, ctx)).toEqual([]);
  });
  it("fails below a min, names the metric and the threshold", () => {
    expect(receiptProblems(c, { ...good, metrics: { activationRate: 0.49, d7: 0.31 } }, ctx)).toEqual(["activationRate = 0.49, below 0.5"]);
  });
  it("fails above a max", () => {
    const z = milestone("M1").criteria.find((x) => x.id === "zero-data-loss-reports")!;
    const r = { ...good, criterion: z.id, metrics: { dataLossReports: 1 }, reports: undefined };
    expect(receiptProblems(z, r, ctx)).toEqual(["dataLossReports = 1, above 0"]);
    expect(receiptProblems(z, { ...r, metrics: { dataLossReports: 0 } }, ctx)).toEqual([]);
  });
  it("a missing or non-numeric value, no evidence, or no report count fails", () => {
    const p = receiptProblems(c, { ...good, metrics: { activationRate: "52%" }, evidence: "", reports: 0 }, ctx);
    expect(p).toEqual([
      "the metric activationRate is not recorded as a number",
      "the metric d7 is not recorded as a number",
      "the metric receipt needs evidence (the reports folder, a protocol or a console export)",
      "the metric receipt needs `reports`: how many beta reports it was computed from",
    ]);
  });
  it("a whole milestone passes only when every receipt passes and M0 is green", () => {
    // An empty M0 stands in for a green M0 here.
    const r = evaluate({ milestones: [{ id: "M0", title: { en: "x", he: "x" }, criteria: [] }, { ...milestone("M1"), criteria: [c] }] }, "M1", { ...ctx, readReceipt: (m: string) => (m === "M1" ? good : null) });
    expect(r.criteria[0].pass).toBe(true);
    expect(r.pass).toBe(true);
  });
});

/** SYNTHETIC beta reports in BetaReport's shape (src/beta/programme.ts); no real tester. */
function syntheticReport(i: number, o: { activated: boolean | null; retained7: boolean | null; retained30: boolean | null; weeksInBeta: number }) {
  return {
    kind: "lumen-beta-report", v: 1, app: "0.2.0-beta.2", week: "2027-01-04", activatedWeeksAgo: 1, daysActive7: 3, daysActive30: 5,
    retained7: o.retained7, retained30: o.retained30, opens7: 4, errors7: 0, topFeatures: {}, unusedFeatures: 0,
    cohort: "2026-12-28", weeksInBeta: o.weeksInBeta, channel: "web",
    activation: { activated: o.activated, ownNote: true, imported: i % 2 === 0, returnedDay2: o.activated === true, ttfv1MeanMs: 1200, ttfv1Launches: 3, ttfv2Ms: 40_000 },
  };
}

describe("beta metrics from the weekly opt-in reports", () => {
  const reports = [
    syntheticReport(0, { activated: true, retained7: true, retained30: null, weeksInBeta: 1 }),
    syntheticReport(1, { activated: true, retained7: false, retained30: null, weeksInBeta: 1 }),
    syntheticReport(2, { activated: false, retained7: true, retained30: null, weeksInBeta: 2 }),
    syntheticReport(3, { activated: null, retained7: null, retained30: null, weeksInBeta: 0 }),
  ];

  it("counts reports, takes rates over the decided ones only, and gives null rather than a made-up 0", () => {
    expect(aggregateBetaReports(reports)).toEqual({ reports: 4, weeks: ["2027-01-04"], optInUsers: 4, testersWeek1: 3, activationRate: 0.667, d7: 0.667, d30: null });
    expect(Object.keys(aggregateBetaReports([])).filter((k) => BETA_METRICS.includes(k)).sort()).toEqual([...BETA_METRICS].sort());
  });

  it("ignores anything that isn't a beta report (the plain weekly usage report too)", () => {
    expect(aggregateBetaReports([{ kind: "lumen-usage-report", retained7: true }, null, "x", ...reports]).reports).toBe(4);
  });

  it("npm run launch:gate -- --beta-metrics <dir> prints them for a receipt", () => {
    const dir = mkdtempSync(join(tmpdir(), "beta-reports-"));
    try {
      reports.forEach((r, i) => writeFileSync(join(dir, `r${i}.json`), JSON.stringify(r)));
      const out = spawnSync(process.execPath, [script, "--beta-metrics", dir], { encoding: "utf8" });
      expect(out.status).toBe(0);
      expect(JSON.parse(out.stdout)).toMatchObject({ reports: 4, activationRate: 0.667, d30: null, evidence: dir });
      const empty = mkdtempSync(join(tmpdir(), "beta-reports-"));
      expect(spawnSync(process.execPath, [script, "--beta-metrics", empty], { encoding: "utf8" }).status).toBe(1);
      rmSync(empty, { recursive: true, force: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("docs/launch/ga-checklist.md is built from milestones.json", () => {
  it("matches the file in the repository", () => {
    expect(readFileSync(join(repo, "docs/launch/ga-checklist.md"), "utf8")).toBe(checklistMarkdown(real));
  });

  it("lists every criterion of every milestone with its source and its proof", () => {
    const md = checklistMarkdown(real);
    for (const m of real.milestones as Milestone[]) {
      expect(md).toContain(`## ${m.id}: `);
      for (const c of m.criteria) {
        expect(md).toContain(`- [ ] **${c.id}**: `);
      }
    }
    expect(md.match(/^ {2}- Source: /gm)?.length).toBe(real.milestones.reduce((n: number, m: Milestone) => n + m.criteria.length, 0));
    expect(md).toContain("metric (beta-reports): `activationRate` ≥ 0.5; `d7` ≥ 0.3");
  });

  it("--check fails when the checklist is stale, and --checklist rebuilds it", () => {
    const dir = mkdtempSync(join(tmpdir(), "launch-ga-"));
    try {
      mkdirSync(join(dir, "docs/launch"), { recursive: true });
      cpSync(join(repo, "docs/launch/milestones.json"), join(dir, "docs/launch/milestones.json"));
      writeFileSync(join(dir, "docs/launch/ga-checklist.md"), "- [x] everything, by hand\n");
      const stale = gate(dir, "--check");
      expect(stale.status).toBe(2);
      expect(stale.stderr).toContain("differs from milestones.json");
      expect(gate(dir, "--checklist").status).toBe(0);
      expect(gate(dir, "--check").status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
