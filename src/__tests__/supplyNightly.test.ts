/**
 * W11.S5 (research R3.7): the supply-chain checks of the nightly —
 * Scorecard, osv-scanner, cargo deny and a syft SBOM — run without GitHub
 * Actions and land in a sealed receipt. A skipped check is never a pass.
 *
 * The scanner outputs below are SYNTHETIC: small hand-written documents in
 * the published JSON shapes of Scorecard v5 (`score`, `checks[].name/score`),
 * osv-scanner v2 (`results[].packages[].vulnerabilities` + `groups[].max_severity`),
 * cargo deny's `--format json` lines and CycloneDX 1.5. They are not results
 * of a real scan of this repository; the real numbers come from the Mac run.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations
import { CHECKS, GATES, band, evaluateGates, exitCode, parseCargoDeny, parseOsv, parseSbom, parseScorecard, planChecks, runSupply, tasksFor } from "../../scripts/supply/nightly.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { check, loadOrCreateKey } from "../../scripts/nightly/receipt.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { kindsDue, stepsFor } from "../../scripts/nightly/run.mjs";

type Gate = { gate: string; status: string; value: number | null };
type Task = { key: string; title: string };
type Result = { outcome: string; skipReason?: string; error?: string; parsed?: Record<string, unknown> };
type Summary = { dryRun: boolean; gates: Gate[]; results: Record<string, Result>; tasks: Task[]; summary: Record<string, number> };

/** Synthetic Scorecard v5 result. */
const scorecard = (aggregate: number, over: Record<string, number> = {}) => ({
  date: "2026-11-15T02:00:00Z",
  repo: { name: "github.com/talstilkol/lumen-md", commit: "c3f055218e6badbeecec9e28eba534b4740ffdea" },
  scorecard: { version: "v5.1.1", commit: "synthetic" },
  score: aggregate,
  checks: Object.entries({ "Branch-Protection": 8, "Code-Review": 9, "Dangerous-Workflow": 10, Maintained: 10, "Signed-Releases": -1, ...over }).map(([name, score]) => ({ name, score, reason: "synthetic", details: null, documentation: { short: "", url: "" } })),
  metadata: null,
});

/** Synthetic osv-scanner v2 result: one critical (by CVSS), one high (by the GHSA label only), one low. */
const osv = {
  results: [
    {
      source: { path: "/abs/repo/package-lock.json", type: "lockfile" },
      packages: [
        {
          package: { name: "synthetic-a", version: "1.0.0", ecosystem: "npm" },
          vulnerabilities: [
            { id: "GHSA-aaaa-aaaa-aaaa", aliases: ["CVE-2026-0001"], database_specific: { severity: "CRITICAL" } },
            { id: "CVE-2026-0001", aliases: ["GHSA-aaaa-aaaa-aaaa"] },
          ],
          groups: [{ ids: ["GHSA-aaaa-aaaa-aaaa", "CVE-2026-0001"], aliases: ["CVE-2026-0001", "GHSA-aaaa-aaaa-aaaa"], max_severity: "9.8" }],
        },
        {
          package: { name: "synthetic-b", version: "2.0.0", ecosystem: "npm" },
          vulnerabilities: [{ id: "GHSA-bbbb-bbbb-bbbb", database_specific: { severity: "HIGH" } }],
          groups: [{ ids: ["GHSA-bbbb-bbbb-bbbb"], max_severity: "" }],
        },
      ],
    },
    {
      source: { path: "/abs/repo/src-tauri/Cargo.lock", type: "lockfile" },
      packages: [{ package: { name: "synthetic-crate", version: "0.1.0", ecosystem: "crates.io" }, vulnerabilities: [{ id: "RUSTSEC-2026-0001" }], groups: [{ ids: ["RUSTSEC-2026-0001"], max_severity: "3.1" }] }],
    },
  ],
};

const cleanOsv = { results: [] };

const denyLines = [
  JSON.stringify({ type: "diagnostic", fields: { severity: "error", code: "vulnerability", message: "synthetic advisory", advisory: { id: "RUSTSEC-2026-0002" } } }),
  JSON.stringify({ type: "diagnostic", fields: { severity: "error", code: "banned", message: "crate `synthetic-banned` is explicitly banned" } }),
  JSON.stringify({ type: "diagnostic", fields: { severity: "warning", code: "duplicate", message: "found 2 duplicate entries" } }),
  "not json",
].join("\n");

const sbomText = JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.5", components: [{ name: "a" }, { name: "b" }] });

const tmp = () => mkdtempSync(join(tmpdir(), "supply-"));
const none = () => false;

describe("dry run without the network (W11.S5 acceptance 1)", () => {
  it("skips every check with a reason, measures no gate, opens no task, and exits 0", () => {
    const dir = tmp();
    try {
      const s = runSupply({ cwd: dir, dryRun: true, hasBin: none, previous: null }) as Summary;
      expect(Object.keys(s.results)).toEqual(["scorecard", "osv", "cargo-deny", "sbom"]);
      for (const r of Object.values(s.results)) {
        expect(r.outcome).toBe("skipped");
        expect(r.skipReason).toMatch(/^dry-run: nothing run/);
      }
      expect(s.results.scorecard.skipReason).toMatch(/needs the network.*scorecard is not installed/);
      expect(s.gates.every((g) => g.status === "unmeasured")).toBe(true);
      expect(s.tasks).toEqual([]);
      expect(s.summary).toMatchObject({ ran: 0, skipped: 4, errored: 0, gatesFailed: 0, gatesUnmeasured: 5 });
      expect(exitCode(s)).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the CLI writes a sealed dry-run receipt that verifies and carries the skip reasons", () => {
    const dir = tmp();
    try {
      const key = join(dir, "k.pem");
      const receipt = join(dir, "receipt.json");
      const r = spawnSync(process.execPath, [resolve("scripts/supply/nightly.mjs"), "--dry-run", "--receipt", receipt], { encoding: "utf8", env: { PATH: dir, LUMEN_NIGHTLY_KEY: key } });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain("- scorecard: skipped, dry-run");
      const sealed = JSON.parse(readFileSync(receipt, "utf8"));
      expect(sealed.dryRun).toBe(true);
      expect(sealed.results.osv.skipReason).toMatch(/dry-run/);
      expect(check(sealed, loadOrCreateKey(key).publicKeyPem)).toEqual({ ok: true, problems: [] });
      expect(check({ ...sealed, dryRun: false }, loadOrCreateKey(key).publicKeyPem).ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("what runs and what is skipped", () => {
  it("a missing binary or a missing read-only token is a skip with the reason, not a pass", () => {
    const plan = planChecks({ hasBin: (b: string) => b !== "syft", env: {} });
    expect(plan.map((p: { id: string; action: string }) => `${p.id}:${p.action}`)).toEqual(["scorecard:skip", "osv:run", "cargo-deny:run", "sbom:skip"]);
    expect(plan[0].why).toMatch(/GITHUB_AUTH_TOKEN is not set.*read-only/);
    expect(plan[3].why).toMatch(/syft is not installed/);
    expect(planChecks({ hasBin: () => true, env: { GITHUB_AUTH_TOKEN: "x" } }).every((p: { action: string }) => p.action === "run")).toBe(true);
  });

  it("the commands: Scorecard JSON on this repo, osv on both lockfiles (and mcp-server's), cargo deny advisories + bans, syft CycloneDX", () => {
    const cmd = (id: string) => CHECKS.find((c: { id: string }) => c.id === id).cmd.join(" ");
    expect(cmd("scorecard")).toBe("scorecard --repo=github.com/talstilkol/lumen-md --format json --show-details");
    expect(cmd("osv")).toContain("--lockfile=package-lock.json");
    expect(cmd("osv")).toContain("--lockfile=src-tauri/Cargo.lock");
    expect(cmd("osv")).toContain("--lockfile=mcp-server/package-lock.json");
    expect(cmd("cargo-deny")).toMatch(/check advisories bans$/);
    expect(cmd("sbom")).toMatch(/^syft dir:\. -o cyclonedx-json=/);
  });
});

describe("parsers over the published formats (synthetic documents)", () => {
  it("Scorecard: aggregate, version, commit and every check's score; -1 stays inconclusive", () => {
    const p = parseScorecard(JSON.stringify(scorecard(7.4)));
    expect(p).toMatchObject({ aggregate: 7.4, version: "v5.1.1", commit: "c3f055218e6badbeecec9e28eba534b4740ffdea" });
    expect(p.checks["Signed-Releases"]).toBe(-1);
    expect(() => parseScorecard("{}")).toThrow(/not a Scorecard/);
  });

  it("OSV: one finding per alias group, severity from CVSS or the database label (the higher), sorted worst first", () => {
    const p = parseOsv(JSON.stringify(osv));
    expect(p.counts).toEqual({ critical: 1, high: 1, medium: 0, low: 1, unknown: 0 });
    expect(p.findings.map((f: { id: string; severity: string; source: string }) => `${f.severity} ${f.id} ${f.source}`)).toEqual([
      "critical CVE-2026-0001 package-lock.json",
      "high GHSA-bbbb-bbbb-bbbb package-lock.json",
      "low RUSTSEC-2026-0001 src-tauri/Cargo.lock",
    ]);
    expect(p.findings[0].aliases).toEqual(["GHSA-aaaa-aaaa-aaaa"]);
    expect(parseOsv("").counts.critical).toBe(0);
    expect(band("7.0")).toBe("high");
    expect(band("6.9")).toBe("medium");
    expect(band("9.0")).toBe("critical");
  });

  it("cargo deny: errors, warnings, advisory ids and bans from the JSON lines", () => {
    expect(parseCargoDeny(denyLines)).toEqual({ errors: 2, warnings: 1, advisories: ["RUSTSEC-2026-0002"], bans: ["crate `synthetic-banned` is explicitly banned"] });
  });

  it("SBOM: CycloneDX only, with its component count and digest", () => {
    expect(parseSbom(sbomText)).toMatchObject({ format: "CycloneDX", specVersion: "1.5", components: 2 });
    expect(() => parseSbom('{"spdxVersion":"SPDX-2.3"}')).toThrow(/CycloneDX/);
  });
});

describe("gates (W11.M8: Scorecard ≥ 7.0, Branch-Protection ≥ 8, Code-Review ≥ 8, Dangerous-Workflow 10, OSV 0 critical)", () => {
  it("the floors are the acceptance numbers and are frozen", () => {
    expect(GATES).toEqual({ scorecardAggregate: 7.0, scorecardChecks: { "Branch-Protection": 8, "Code-Review": 8, "Dangerous-Workflow": 10 }, osvCritical: 0 });
    expect(Object.isFrozen(GATES) && Object.isFrozen(GATES.scorecardChecks)).toBe(true);
  });

  it("exactly at the floors passes; one below fails; a missing or inconclusive check fails", () => {
    const at = evaluateGates({ scorecard: { parsed: parseScorecard(scorecard(7.0, { "Code-Review": 8 })) }, osv: { parsed: parseOsv(cleanOsv) } });
    expect(at.map((g: Gate) => g.status)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
    const below = evaluateGates({ scorecard: { parsed: parseScorecard(scorecard(6.9, { "Branch-Protection": 7, "Dangerous-Workflow": -1 })) }, osv: { parsed: parseOsv(osv) } });
    expect(below.filter((g: Gate) => g.status === "fail").map((g: Gate) => g.gate)).toEqual(["scorecard.aggregate", "scorecard.Branch-Protection", "scorecard.Dangerous-Workflow", "osv.critical"]);
    const noCheck = { ...scorecard(8), checks: scorecard(8).checks.filter((c) => c.name !== "Code-Review") };
    expect(evaluateGates({ scorecard: { parsed: parseScorecard(noCheck) } }).find((g: Gate) => g.gate === "scorecard.Code-Review").status).toBe("fail");
  });

  it("a gate whose check did not run is unmeasured, never pass", () => {
    const g = evaluateGates({ scorecard: { outcome: "skipped" }, osv: { outcome: "error" } });
    expect(g.every((x: Gate) => x.status === "unmeasured")).toBe(true);
  });
});

describe("tasks: a score drop or a high finding opens one", () => {
  it("drop against the previous receipt, a floor, each critical/high OSV finding, cargo deny errors; low findings do not", () => {
    const results = { scorecard: { parsed: parseScorecard(scorecard(7.2, { "Code-Review": 7 })) }, osv: { parsed: parseOsv(osv) }, "cargo-deny": { parsed: parseCargoDeny(denyLines) } };
    const previous = { results: { scorecard: { parsed: parseScorecard(scorecard(7.6)) } } };
    const tasks = tasksFor(results, evaluateGates(results), previous) as Task[];
    expect(tasks.map((t) => t.key)).toEqual([
      "supply:scorecard-drop:7.2",
      "supply:scorecard.Code-Review",
      "supply:osv:CVE-2026-0001:synthetic-a",
      "supply:osv:GHSA-bbbb-bbbb-bbbb:synthetic-b",
      "supply:cargo-deny:RUSTSEC-2026-0002,crate `synthetic-banned` is explicitly banned",
    ]);
    expect(tasks[0].title).toBe("Scorecard dropped from 7.6 to 7.2");
    // The same results give the same keys, so a rerun does not open a second issue.
    expect((tasksFor(results, evaluateGates(results), previous) as Task[]).map((t) => t.key)).toEqual(tasks.map((t) => t.key));
  });

  it("a clean run with the score up opens nothing", () => {
    const results = { scorecard: { parsed: parseScorecard(scorecard(8.1)) }, osv: { parsed: parseOsv(cleanOsv) }, "cargo-deny": { parsed: parseCargoDeny("") } };
    expect(tasksFor(results, evaluateGates(results), { results: { scorecard: { parsed: parseScorecard(scorecard(7.9)) } } })).toEqual([]);
  });
});

describe("the real runner with stand-in binaries on PATH (no network)", () => {
  /** Shell scripts named like the scanners that print the synthetic documents. */
  function fakeBins(dir: string, { osvExit = 1 } = {}) {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const put = (name: string, body: string) => {
      writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    };
    writeFileSync(join(dir, "sc.json"), JSON.stringify(scorecard(7.5)));
    writeFileSync(join(dir, "osv.json"), JSON.stringify(osv));
    writeFileSync(join(dir, "deny.jsonl"), "");
    writeFileSync(join(dir, "sbom.json"), sbomText);
    put("scorecard", `cat "${dir}/sc.json"`);
    put("osv-scanner", `cat "${dir}/osv.json"; exit ${osvExit}`);
    put("cargo-deny", `cat "${dir}/deny.jsonl" >&2`);
    put("syft", `cp "${dir}/sbom.json" reports/supply/sbom.cdx.json`);
    return bin;
  }

  it("runs each scanner, parses its output, fails the OSV gate and lists the tasks", () => {
    const dir = tmp();
    try {
      const bin = fakeBins(dir);
      const env = { PATH: `${bin}:/usr/bin:/bin`, GITHUB_AUTH_TOKEN: "read-only" };
      const s = runSupply({ cwd: dir, env, hasBin: (b: string) => existsSync(join(bin, b)), previous: null }) as Summary;
      expect(Object.values(s.results).map((r) => r.outcome)).toEqual(["ran", "ran", "ran", "ran"]);
      expect(s.results.sbom.parsed).toMatchObject({ components: 2 });
      expect(s.gates.find((g) => g.gate === "osv.critical")).toMatchObject({ status: "fail", value: 1 });
      expect(s.gates.find((g) => g.gate === "scorecard.aggregate")).toMatchObject({ status: "pass", value: 7.5 });
      expect(s.tasks.map((t) => t.key)).toEqual(["supply:osv:CVE-2026-0001:synthetic-a", "supply:osv:GHSA-bbbb-bbbb-bbbb:synthetic-b"]);
      expect(exitCode(s)).toBe(1);
      expect(JSON.parse(readFileSync(join(dir, "reports/supply/osv.json"), "utf8")).results).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a scanner that crashes is an error (exit 1), not a clean result", () => {
    const dir = tmp();
    try {
      const bin = fakeBins(dir, { osvExit: 127 });
      const s = runSupply({ cwd: dir, env: { PATH: `${bin}:/usr/bin:/bin` }, hasBin: (b: string) => b === "osv-scanner", previous: null }) as Summary;
      expect(s.results.osv.outcome).toBe("error");
      expect(s.results.osv.error).toMatch(/exited 127/);
      expect(s.gates.find((g) => g.gate === "osv.critical")?.status).toBe("unmeasured");
      expect(exitCode(s)).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("nightly runner wiring (W4.36)", () => {
  it("supply is due every night on a host with a scanner, and not counted among 0.11's four kinds", () => {
    const sat = new Date("2026-11-14T02:00:00Z");
    expect(kindsDue(sat, null, { platform: "darwin", sr: false, supply: true })).toEqual(["flake", "perf", "triage", "fuzz", "supply"]) // fuzz: every night since #747 (W10.E58);
    expect(kindsDue(sat, null, { platform: "darwin", sr: false, supply: false })).toEqual(["flake", "perf", "triage", "fuzz"]);
    expect(kindsDue(sat, ["supply"])).toEqual(["supply"]);
    expect(stepsFor("supply", none).map((s: { cmd: string[] }) => s.cmd.join(" "))).toEqual(["node scripts/supply/nightly.mjs --no-seal --out reports/supply/summary.json"]);
  });
});
