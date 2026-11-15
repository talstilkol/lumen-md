/**
 * Plan W11.S12, stacked on W11.S1: the public security page states the
 * encrypted sync's real status from security/crypto-audit.json (W11.S1's
 * record), and the findings register can't disagree with it.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
// @ts-expect-error — plain .mjs module without type declarations
import { cryptoAuditProblems, renderSecurityPage } from "../../scripts/lib/securityPage.mjs";

const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const findings = read("security/findings.json");
const audit = read("security/crypto-audit.json");

describe("the security page and W11.S1's audit record", () => {
  it("with no external audit: both pages say encrypted sync is experimental, off in every channel, with the audit's scope", () => {
    expect(audit.external).toBeNull();
    const en = renderSecurityPage(findings, [], "en", audit);
    const he = renderSecurityPage(findings, [], "he", audit);
    expect(en).toContain("**Encrypted sync is experimental.**");
    expect(en).toContain("off in every channel, beta included");
    expect(he).toContain("**הסנכרון המוצפן ניסיוני.**");
    for (const s of audit.scope) {
      expect(en).toContain(`\`${s}\``);
      expect(he).toContain(`\`${s}\``);
    }
    expect(cryptoAuditProblems(findings, audit)).toEqual([]);
  });

  it("the register can't claim an audit the record doesn't have, nor drop the open finding that says there is none", () => {
    expect(cryptoAuditProblems({ ...findings, audit: { ...findings.audit, external: true } }, audit)).toEqual([expect.stringMatching(/says external: true.*has no external audit/)]);
    const noSyncFinding = { ...findings, findings: findings.findings.filter((f: { area: string }) => f.area !== "sync") };
    expect(cryptoAuditProblems(noSyncFinding, audit)).toEqual([expect.stringMatching(/open finding \(area sync\)/)]);
  });

  it("once an audit is recorded: the page links the report, and a register still saying 'not audited' is a problem", () => {
    const done = { ...audit, external: { auditor: "Example Auditor", date: "2027-03-01", report: "https://example.org/report.pdf", openFindings: "https://example.org/findings" } };
    expect(renderSecurityPage({ ...findings, audit: { ...findings.audit, external: true, report: "https://example.org/report.pdf" } }, [], "en", done)).toContain("[the full report](https://example.org/report.pdf)");
    expect(cryptoAuditProblems(findings, done)).toEqual([expect.stringMatching(/says external: false.*records an external audit/)]);
    expect(cryptoAuditProblems({ ...findings, audit: { ...findings.audit, external: true } }, { ...audit, external: { auditor: "x", date: "2027-01-01", report: "not a link" } })).toEqual([expect.stringMatching(/published report/)]);
  });

  it("the committed pages are current (security-page --check reads the audit record)", () => {
    expect(execFileSync(process.execPath, ["scripts/security-page.mjs", "--check"], { encoding: "utf8" })).toMatch(/✓ security page/);
  });
});
