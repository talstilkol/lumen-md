/**
 * Plan W11.S13 (research R6.9): the store privacy labels are checked against
 * the privacy ledger (a label that doesn't match it is a store risk), the
 * App Store and Play drafts are built from them, pr:check fails on a ledger
 * route with no label entry, and the relay publishes a transparency report
 * every six months in Proton's shape.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations
import { DRAFTS, labelProblems, renderDrafts } from "../../scripts/privacy/store-labels.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { ledgerRoutes, unknownRecorders } from "../../scripts/privacy/ledgerRoutes.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { readReports, renderTransparency, reportProblems, staleness } from "../../scripts/privacy/transparency.mjs";

const labels = JSON.parse(readFileSync("store/privacy-labels.json", "utf8"));
const routes: string[] = ledgerRoutes(".");

describe("the store labels cover the privacy ledger", () => {
  it("every ledger route is under exactly one feature or onDevice, and every listed route is real", () => {
    expect(routes.length).toBeGreaterThan(30);
    expect(unknownRecorders(".")).toEqual([]);
    expect(labelProblems(labels, routes, [])).toEqual([]);
  });

  it("the gate fails on a ledger route with no entry, on a route listed twice, and on a made-up one", () => {
    const missing = { ...labels, onDevice: { ...labels.onDevice, routes: labels.onDevice.routes.slice(1) } };
    expect(labelProblems(missing, routes, [])).toEqual([expect.stringMatching(/the ledger route "Ollama \(this machine \/ LAN\)" has no store label entry/)]);
    const twice = { ...labels, onDevice: { ...labels.onDevice, routes: [...labels.onDevice.routes, "OpenAI"] } };
    expect(labelProblems(twice, routes, [])).toEqual([expect.stringMatching(/"OpenAI" is listed twice/)]);
    const madeUp = { ...labels, onDevice: { ...labels.onDevice, routes: [...labels.onDevice.routes, "Nowhere"] } };
    expect(labelProblems(madeUp, routes, [])).toEqual([expect.stringMatching(/names "Nowhere", which is not a ledger route/)]);
    expect(labelProblems(labels, routes, ["src/new/caller.ts"])).toEqual([expect.stringMatching(/src\/new\/caller.ts records into the privacy ledger/)]);
  });

  it("pr:check fails when a new ledger rule ships without its label entry", () => {
    const dir = mkdtempSync(join(tmpdir(), "labels-gate-"));
    try {
      // A copy of the repository's tracked files, then a new ledger route with no label.
      execFileSync("git", ["worktree", "add", "--detach", "-q", join(dir, "wt"), "HEAD"]);
      const wt = join(dir, "wt");
      const ledger = join(wt, "src/ai/privacyLedger.ts");
      writeFileSync(ledger, readFileSync(ledger, "utf8").replace('reason: "Mistral"', 'reason: "Mistral"},\n  { test: (h) => h === "example.invalid", category: "cloud-text", reason: "A new route with no label"'));
      expect(ledgerRoutes(wt)).toContain("A new route with no label");
      const r = spawnSync(process.execPath, ["scripts/pr-check.mjs", "--base", "HEAD", "--no-size"], { cwd: wt, encoding: "utf8" });
      expect(r.stdout).toMatch(/### ❌ Store privacy labels cover the ledger/);
      expect(r.stdout).toContain('the ledger route "A new route with no label" has no store label entry');
    } finally {
      spawnSync("git", ["worktree", "remove", "--force", join(dir, "wt")]);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("the drafts are built from the labels: Data Not Collected, No data collected or shared, crash reports only with consent", () => {
    const d = renderDrafts(labels);
    expect(d.apple).toContain("**Data Not Collected**");
    expect(d.apple).toMatch(/Crash Data \| No \| No \| Only in a build made with a crash-reporting key/);
    expect(d.google).toContain("**No data collected or shared**");
    expect(d.google).toMatch(/Crash logs \| Yes \| Only in a build/);
    expect(d.google).toContain("To confirm at submission");
    // Every route that leaves the device appears in the App Store draft by its ledger name.
    for (const r of routes.filter((x) => !labels.onDevice.routes.includes(x))) expect(d.apple, r).toContain(`\`${r.trimEnd()}`);
    expect(readFileSync(DRAFTS.apple, "utf8")).toBe(d.apple);
    expect(readFileSync(DRAFTS.google, "utf8")).toBe(d.google);
  });
});

describe("the relay's transparency report", () => {
  const reports = readReports(".");

  it("v1 is valid: Proton's shape (received, answered, rejected by kind) for a half-year", () => {
    expect(reports.map((r: { name: string }) => r.name)).toContain("2026-H2.json");
    for (const { name, report } of reports) expect(reportProblems(name, report)).toEqual([]);
    const page = renderTransparency(reports, "en");
    expect(page).toContain("| Request | Received | Answered | Rejected |");
    expect(page).toContain("| Court orders | 0 | 0 | 0 |");
    expect(renderTransparency(reports, "he")).toContain("| צווי בית משפט | 0 | 0 | 0 |");
    expect(readFileSync("docs/src/content/docs/security/transparency.md", "utf8")).toBe(page);
  });

  it("a report that doesn't add up, or covers the wrong period, is refused", () => {
    const r = reports[0].report;
    expect(reportProblems("2026-H2.json", { ...r, requests: { ...r.requests, court: { received: 1, answered: 1, rejected: 1 } } })).toEqual([expect.stringMatching(/answered \+ rejected is more than received/)]);
    expect(reportProblems("2026-H1.json", r)).toEqual([expect.stringMatching(/period must be 2026-01-01 to 2026-06-30/)]);
    expect(reportProblems("2026.json", r)).toEqual([expect.stringMatching(/name it/)]);
  });

  it("every six months: overdue a month after the next half-year ends, not before", () => {
    expect(staleness(reports, new Date("2027-07-15T00:00:00Z"))).toEqual([]);
    expect(staleness(reports, new Date("2027-08-15T00:00:00Z"))).toEqual([expect.stringMatching(/the next one is due/)]);
    expect(staleness([], new Date())).toEqual(["no transparency report yet"]);
  });

  it("/security links it", () => {
    expect(readFileSync("docs/src/content/docs/security/index.md", "utf8")).toContain("(/security/transparency/)");
    expect(readFileSync("docs/src/content/docs/he/security/index.md", "utf8")).toContain("(/he/security/transparency/)");
  });
});
