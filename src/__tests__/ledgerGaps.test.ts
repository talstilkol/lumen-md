/**
 * Plan W6.29, W10.D16-D17: every network call goes through the privacy ledger.
 *
 * `npm run pr:check` checks the lines a PR adds. This test checks every line of
 * production source with the same rule (scripts/lib/prGate.mjs,
 * unregisteredNetworkCalls, through scripts/privacy-ledger-check.mjs): a fetch,
 * fetchWithRetry, XMLHttpRequest, WebSocket, EventSource, sendBeacon or
 * importScripts call must name a host the ledger knows, or carry
 * `// privacy-ledger: <the rule that records it>` on its line or the two above.
 *
 * There is no baseline any more (W10.D17): the 86 calls that predated W6.29
 * each carry their note, and one call without either fails here and in the
 * `privacy:ledger` gate of scripts/vercel-build.mjs.
 * @vitest-environment node
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain .mjs script, no types (as in prGate.test.ts)
import { ledgerGaps } from "../../scripts/privacy-ledger-check.mjs";
// @ts-expect-error -- plain .mjs script, no types
import { GATES, PREVIEW_GATES, PRODUCTION_GATES } from "../../scripts/vercel-build.mjs";
import { auditReason } from "../ai/privacyLedger";

const root = join(__dirname, "..", "..");

describe("every network call in the app goes through the privacy ledger (W6.29, W10.D17)", () => {
  it("0 calls outside the ledger, with no baseline", () => {
    const gaps = ledgerGaps(root).map((g: { file: string; line: number; text: string }) => `${g.file}:${g.line} ${g.text}`);
    // A new call: route it through a ledger rule, or add `// privacy-ledger: <rule>` above it.
    expect(gaps).toEqual([]);
    expect(existsSync(join(__dirname, "fixtures", "ledger-gaps-baseline.json"))).toBe(false);
  });

  it("the gate fails a seeded call without a note, and passes it once the note names its rule", () => {
    const dir = mkdtempSync(join(tmpdir(), "ledger-gate-"));
    try {
      mkdirSync(join(dir, "src", "ai"), { recursive: true });
      mkdirSync(join(dir, "src", "lib"), { recursive: true });
      writeFileSync(join(dir, "src", "ai", "privacyLedger.ts"), readFileSync(join(root, "src", "ai", "privacyLedger.ts"), "utf8"));
      const file = join(dir, "src", "lib", "beacon.ts");
      writeFileSync(file, "export async function send(url: string) {\n  return fetch(url, { method: \"POST\" });\n}\n");
      const cli = () => spawnSync(process.execPath, [join(root, "scripts", "privacy-ledger-check.mjs"), "--root", dir], { encoding: "utf8" });
      let r = cli();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("src/lib/beacon.ts:2");
      expect(ledgerGaps(dir)).toHaveLength(1);
      // A literal host the ledger doesn't know fails too, a note or not.
      writeFileSync(file, "// privacy-ledger: nothing\nexport const go = () => fetch(\"https://collect.example-tracker.io/x\");\n");
      expect(ledgerGaps(dir)[0].why).toMatch(/example-tracker/);
      writeFileSync(file, "export async function send(url: string) {\n  // privacy-ledger: the research endpoint (classify: researchEndpoint), research\n  return fetch(url, { method: \"POST\" });\n}\n");
      r = cli();
      expect(r.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is a Vercel gate of its own, on preview and production builds", () => {
    expect(GATES["privacy:ledger"]).toEqual(["run", "-s", "privacy:ledger"]);
    expect(PREVIEW_GATES).toContain("privacy:ledger");
    expect(PRODUCTION_GATES).toContain("privacy:ledger");
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["privacy:ledger"]).toBe("node scripts/privacy-ledger-check.mjs");
  });

  it("audit mode names the sync storages the rules don't track (they are never blocked)", () => {
    expect(auditReason("api.dropboxapi.com")).toMatch(/Dropbox/);
    expect(auditReason("content.dropboxapi.com")).toMatch(/Dropbox/);
    expect(auditReason("oauth2.googleapis.com")).toMatch(/Google Drive/);
    expect(auditReason("www.googleapis.com")).toMatch(/Google Drive/);
    expect(auditReason("example.org")).toBe("Other request (audit mode)");
  });
});
