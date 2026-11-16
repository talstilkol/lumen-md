/**
 * Plan W13.X2 (with W11.S12): public/.well-known/security.txt passes
 * RFC 9116 and has not expired, its Contact is a reporting channel that
 * works today (security/channels.json), and SECURITY.md and the public
 * security page state the CRA Article 14 timelines (24 h / 72 h / 14 days),
 * the safe harbor, the support period and the hall of fame in English and
 * Hebrew, from security/disclosure.json.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
// @ts-expect-error — plain .mjs module without type declarations
import { securityTxtProblems, securityTxtValues } from "../../scripts/lib/securityTxt.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { disclosureProblems, renderSecurityPage, renewalProblems } from "../../scripts/lib/securityPage.mjs";

const read = (p: string) => readFileSync(p, "utf8");
const disclosure = JSON.parse(read("security/disclosure.json"));
const txt = read(disclosure.securityTxt.path);
const channels = (JSON.parse(read("security/channels.json")) as { channels: { status: string; url?: string }[] }).channels;
const findings = JSON.parse(read("security/findings.json"));
const NOW = Date.parse("2026-11-16T00:00:00Z");
const good = ["Contact: mailto:security@example.org", "Expires: 2027-01-01T00:00:00.000Z", ""].join("\n");

describe("security.txt (RFC 9116)", () => {
  it("the committed file passes, today, at its canonical URL", () => {
    expect(securityTxtProblems(txt, { canonical: disclosure.securityTxt.canonical })).toEqual([]);
    expect(disclosure.securityTxt.path).toBe("public/.well-known/security.txt");
    expect(disclosure.securityTxt.canonical).toBe("https://lumen-md.vercel.app/.well-known/security.txt");
  });

  it("every Contact is a reporting channel that is on, and the languages are he, en", () => {
    const on = new Set(channels.filter((c) => c.status === "on").map((c) => c.url));
    const contacts = securityTxtValues(txt, "Contact");
    expect(contacts.length).toBeGreaterThan(0);
    for (const c of contacts) expect(on.has(c), c).toBe(true);
    expect(securityTxtValues(txt, "Preferred-Languages")).toEqual(["he, en"]);
    expect(securityTxtValues(txt, "Policy")[0]).toMatch(/SECURITY\.md$/);
  });

  it("fails on an Expires that has passed, is missing, repeated, malformed or over a year away", () => {
    expect(securityTxtProblems(good, { now: NOW })).toEqual([]);
    expect(securityTxtProblems(good, { now: Date.parse("2027-01-02T00:00:00Z") })).toEqual([expect.stringMatching(/has passed/)]);
    expect(securityTxtProblems("Contact: mailto:a@b.example\n", { now: NOW })).toEqual([expect.stringMatching(/no Expires/)]);
    expect(securityTxtProblems(good + "Expires: 2027-02-01T00:00:00Z\n", { now: NOW })).toEqual([expect.stringMatching(/Expires appears 2 times/)]);
    expect(securityTxtProblems("Contact: mailto:a@b.example\nExpires: 2027-01-01\n", { now: NOW })).toEqual([expect.stringMatching(/not an RFC 3339 date-time/)]);
    expect(securityTxtProblems("Contact: mailto:a@b.example\nExpires: 2028-06-01T00:00:00Z\n", { now: NOW })).toEqual([expect.stringMatching(/more than a year away/)]);
  });

  it("fails without a Contact, on an http:// web Contact or Policy, and on a field the RFC does not define", () => {
    expect(securityTxtProblems("Expires: 2027-01-01T00:00:00Z\n", { now: NOW })).toEqual([expect.stringMatching(/no Contact/)]);
    expect(securityTxtProblems(good + "Contact: http://example.org/report\n", { now: NOW })).toEqual([expect.stringMatching(/must be https/)]);
    expect(securityTxtProblems(good + "Policy: http://example.org/policy\n", { now: NOW })).toEqual([expect.stringMatching(/Policy must be an https/)]);
    expect(securityTxtProblems(good + "Contact: tel:+1-201-555-0123\n", { now: NOW })).toEqual([]);
    expect(securityTxtProblems(good + "Bounty: https://example.org\n", { now: NOW })).toEqual([expect.stringMatching(/Bounty is not an RFC 9116 field/)]);
  });

  it("fails on a line that is not a field, a bad language tag, a missing newline, and a Canonical that is not where it is served", () => {
    expect(securityTxtProblems(good + "just some text\n", { now: NOW })).toEqual([expect.stringMatching(/not "Field: value"/)]);
    expect(securityTxtProblems(good + "Preferred-Languages: he, en english\n", { now: NOW })).toEqual([expect.stringMatching(/invalid language tag/)]);
    expect(securityTxtProblems(good.trimEnd(), { now: NOW })).toEqual(["does not end with a newline"]);
    expect(securityTxtProblems(good, { now: NOW, canonical: "https://lumen-md.vercel.app/.well-known/security.txt" })).toEqual([expect.stringMatching(/no Canonical field names/)]);
    expect(securityTxtProblems(good + "Canonical: https://lumen-md.vercel.app/.well-known/security.txt\n", { now: NOW, canonical: "https://lumen-md.vercel.app/.well-known/security.txt" })).toEqual([]);
  });
});

describe("the disclosure policy (CRA Article 14)", () => {
  it("the record keeps the CRA's clock or faster, a current support line, and a hall-of-fame list", () => {
    expect(disclosureProblems(disclosure)).toEqual([]);
    expect(disclosure.cra).toMatchObject({ earlyWarningHours: 24, notificationHours: 72, finalReportDays: 14 });
    expect(disclosureProblems({ ...disclosure, cra: { ...disclosure.cra, notificationHours: 96 } })).toEqual([expect.stringMatching(/notificationHours: at most 72/)]);
    expect(disclosureProblems({ ...disclosure, support: [] })).toEqual([expect.stringMatching(/status current/)]);
  });

  it("the product support period (D1 §3): at least five years, an end year, ten years of downloads, a free newest line (CRA Art. 13(8)-(10))", () => {
    const sp = disclosure.supportPeriod;
    expect(sp).toMatchObject({ minYears: 5, notBefore: "2031-12-31", updatesAvailableYears: 10, newestLineFree: true });
    const bad = (o: object) => disclosureProblems({ ...disclosure, supportPeriod: { ...sp, ...o } });
    expect(disclosureProblems({ ...disclosure, supportPeriod: undefined })).toEqual([expect.stringMatching(/Art\. 13\(8\)/)]);
    expect(bad({ minYears: 2 })).toEqual([expect.stringMatching(/minYears: at least 5/)]);
    expect(bad({ notBefore: "2028-01-01" })[0]).toMatch(/five years after the decision/);
    expect(bad({ updatesAvailableYears: 5 })).toEqual([expect.stringMatching(/at least 10/)]);
    expect(bad({ newestLineFree: false })).toEqual([expect.stringMatching(/13\(10\)/)]);
    expect(bad({ he: "" })).toEqual([expect.stringMatching(/English and Hebrew/)]);
    const s = read("SECURITY.md");
    expect(s).toContain(sp.en);
    expect(s.slice(s.indexOf("### בעברית"))).toContain(sp.he);
    for (const lang of ["en", "he"]) expect(renderSecurityPage(findings, [], lang, null, disclosure)).toContain(sp[lang]);
  });

  it("security.txt is renewed a month ahead (D1 §4): renewBy is ≥ 30 days before Expires, and the check fails from renewBy on", () => {
    const expires = securityTxtValues(txt, "Expires")[0];
    expect(disclosure.securityTxt.renewBy).toBe("2027-04-16");
    expect(renewalProblems(disclosure, expires, NOW)).toEqual([]);
    expect(renewalProblems(disclosure, expires, Date.parse("2027-04-16T00:00:00Z"))).toEqual([expect.stringMatching(/due for renewal since 2027-04-16/)]);
    expect(renewalProblems({ securityTxt: { renewBy: "2027-05-01" } }, expires, NOW)).toEqual([expect.stringMatching(/less than 30 days/)]);
    expect(renewalProblems({ securityTxt: {} }, expires, NOW)).toHaveLength(1);
    expect(disclosureProblems({ ...disclosure, securityTxt: { ...disclosure.securityTxt, renewBy: undefined } })).toEqual([expect.stringMatching(/renewBy/)]);
  });

  it("security.txt names the private channel to come, but its Contact stays on a channel that is on (D1 §4: PVR is off)", () => {
    const pvr = channels.find((c) => c.url === "https://github.com/talstilkol/lumen-md/security/advisories/new")!;
    expect(pvr.status).toBe("off");
    expect(securityTxtValues(txt, "Contact")).not.toContain(pvr.url);
    expect(txt).toContain("# (https://github.com/talstilkol/lumen-md/security/advisories/new) once it is");
  });

  it("SECURITY.md states the timelines, safe harbor, support period and hall of fame in English and Hebrew", () => {
    const s = read("SECURITY.md");
    const he = s.slice(s.indexOf("### בעברית"), s.indexOf("## Maintainers and keys"));
    for (const t of ["≤ 24 hours", "≤ 72 hours", "≤ 14 days after a fix", "safe harbor", "## Hall of fame", "GitHub security advisory (GHSA)", "CVE"]) expect(s, t).toContain(t);
    for (const t of ["24 שעות", "72 שעות", "14 יום", "מחקר בתום לב", "תקופת תמיכה"]) expect(he, t).toContain(t);
    for (const line of disclosure.support) expect(s).toContain(line.en);
    for (const line of disclosure.support) expect(he).toContain(line.line);
    expect(he).toContain("עוד 90 יום אחרי שקו הגרסאות הבא יוצא");
  });

  it.each([["en"], ["he"]] as [string][])("%s: the security page has the timelines, safe harbor, support table and hall of fame", (lang: string) => {
    const page = renderSecurityPage(findings, [], lang, null, disclosure);
    const want = lang === "en" ? ["≤ 24 hours", "≤ 72 hours", "≤ 14 days", "safe harbor", "Supported versions", "Hall of fame", "/.well-known/security.txt"] : ["עד 24 שעות", "עד 72 שעות", "עד 14 יום", "safe harbor", "גרסאות נתמכות", "היכל התהילה", "/.well-known/security.txt"];
    for (const w of want) expect(page, w).toContain(w);
    for (const line of disclosure.support) expect(page).toContain(`| ${line.line} |`);
    const committed = read(lang === "en" ? "docs/src/content/docs/security/index.md" : "docs/src/content/docs/he/security/index.md");
    for (const w of want) expect(committed, w).toContain(w);
  });

  it("npm run security:page -- --check holds the page and security.txt together", () => {
    const r = spawnSync(process.execPath, ["scripts/security-page.mjs", "--check"], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("security.txt passes RFC 9116");
  });
});
