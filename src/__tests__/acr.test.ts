/**
 * W3.8 — the accessibility conformance report: every WCAG 2.2 A and AA
 * criterion has a status, none at level A is unsupported, every partial one
 * has a plan, the evidence exists, the report is for this version, and the
 * docs pages are the ones scripts/acr.mjs writes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

async function acr() {
  return (await import("../../scripts/acr.mjs" as string)) as {
    WCAG22: { A: string[]; AA: string[] };
    PAGES: Record<"en" | "he", string>;
    loadReport(root?: string): { version: string; criteria: Array<{ id: string; level: string; status: string; plan?: unknown }> };
    checkReport(report: unknown, root?: string, axe?: unknown): string[];
    summary(report: unknown): Record<"A" | "AA", Record<string, number>>;
    renderPage(report: unknown, lang: "en" | "he", en?: unknown, runs?: Set<string>, axe?: unknown): string;
    loadE2eRuns(root?: string): Set<string>;
    unrunE2e(entry: unknown, runs: Set<string>): string[];
    loadEn(root?: string): EnSource;
    enRows(report: unknown, en: unknown): EnRow[];
    checkEn(report: unknown, en: unknown, root?: string): string[];
    loadAxe(root?: string): Axe | null;
    automatedFor(id: string, axe: unknown): { rules: string[]; pass: number; fail: number; incomplete: number; failures: Array<{ rule: string; surface: string }> };
    automatedCell(id: string, axe: unknown, lang: "en" | "he"): string;
  };
}

type Axe = { version: string; runs: number; surfaces: string[]; setups: string[]; rules: Record<string, { criteria: string[]; pass: number; fail: number; incomplete: number; failures: Array<{ surface: string; setup: string }> }> };

async function acrAxe() {
  return (await import("../../scripts/acr-axe.mjs" as string)) as {
    criteriaOf(tags: string[]): string[];
    parseResults(text: string): unknown[];
    summarize(batches: unknown[], meta: { date: string; commit: string; source: string }): Axe & { notRun: string[] };
  };
}

interface EnRow {
  clause: number;
  id: string;
  wcag: string | null;
  status: string | null;
  mirrors?: string | null;
}
interface EnSource {
  softwareExcluded: string[];
  rows: Array<{ id: string; status: string; mirrors?: string; plan?: unknown; remarks: { en: string; he: string } }>;
}

describe("the ACR (WCAG 2.2)", () => {
  it("a status that rests on an e2e spec with no recorded run is marked not yet verified (audit A4)", async () => {
    const m = await acr();
    const report = m.loadReport(ROOT);
    const runs = m.loadE2eRuns(ROOT);
    const onE2e = report.criteria.filter((c) => c.status !== "not-applicable" && m.unrunE2e(c, runs).length);
    // No run receipt is committed yet: every criterion with e2e evidence is unverified.
    expect(onE2e.length).toBeGreaterThan(0);
    const page = m.renderPage(report, "en", m.loadEn(ROOT), runs);
    for (const c of onE2e) expect(page).toMatch(new RegExp(`\\[${c.id.replace(/\./g, "\\.")} [^\\]]+\\]\\([^)]+\\) \\| [^|]+ — \\*\\*not yet verified\\*\\*`));
    // With a passing run of every spec, the mark is gone.
    const all = new Set([...report.criteria, ...m.loadEn(ROOT).rows].flatMap((c) => (c as { evidence?: string[] }).evidence ?? []));
    expect(m.renderPage(report, "en", m.loadEn(ROOT), all)).not.toContain("— **not yet verified**");
    expect(m.renderPage(report, "he", m.loadEn(ROOT), runs)).toContain("עוד לא אומת");
  });

  it("lists all 55 A and AA criteria", async () => {
    const m = await acr();
    expect(m.WCAG22.A.length).toBe(31);
    expect(m.WCAG22.AA.length).toBe(24);
    expect(m.loadReport(ROOT).criteria.length).toBe(55);
  });

  it("passes its own checks: a status for each, 0 unsupported at A, a plan for each partial, real evidence, this version", async () => {
    const m = await acr();
    expect(m.checkReport(m.loadReport(ROOT), ROOT)).toEqual([]);
    const s = m.summary(m.loadReport(ROOT));
    expect(s.A["does-not-support"]).toBe(0);
  });

  it("rejects a report that breaks the rules", async () => {
    const m = await acr();
    const good = m.loadReport(ROOT);
    const bad = JSON.parse(JSON.stringify(good));
    bad.criteria = bad.criteria.filter((c: { id: string }) => c.id !== "2.4.7");
    const a = bad.criteria.find((c: { id: string }) => c.id === "2.1.1");
    a.status = "does-not-support";
    const p = bad.criteria.find((c: { id: string }) => c.id === "1.4.12");
    delete p.plan;
    bad.criteria.find((c: { id: string }) => c.id === "1.3.1").evidence = ["e2e/nope.spec.ts"];
    bad.version = "9.9.9";
    const problems = m.checkReport(bad, ROOT).join("\n");
    expect(problems).toMatch(/2\.4\.7 \(AA\) has no entry/);
    expect(problems).toMatch(/2\.1\.1: a level A criterion is "does not support"/);
    expect(problems).toMatch(/1\.4\.12: partially-supports needs a plan/);
    expect(problems).toMatch(/evidence e2e\/nope\.spec\.ts does not exist/);
    expect(problems).toMatch(/9\.9\.9/);
  });

  it("publishes in English and Hebrew, generated from the source", async () => {
    const m = await acr();
    const report = m.loadReport(ROOT);
    for (const lang of ["en", "he"] as const) {
      const page = readFileSync(join(ROOT, m.PAGES[lang]), "utf8");
      expect(page).toBe(m.renderPage(report, lang, m.loadEn(ROOT), m.loadE2eRuns(ROOT)));
      for (const id of [...m.WCAG22.A, ...m.WCAG22.AA]) expect(page).toContain(`[${id} `);
      expect(page).toContain("issues/new?template=accessibility.yml");
    }
    expect(readFileSync(join(ROOT, m.PAGES.he), "utf8")).toMatch(/נתמך חלקית/);
  });

  it("has an accessibility contact: the issue form and a palette command", () => {
    const form = readFileSync(join(ROOT, ".github/ISSUE_TEMPLATE/accessibility.yml"), "utf8");
    expect(form).toMatch(/labels: \["accessibility"\]/);
    const cmds = readFileSync(join(ROOT, "src/commands/domains/a11y.ts"), "utf8");
    expect(cmds).toMatch(/help\.a11yReport/);
    expect(cmds).toMatch(/template=accessibility\.yml/);
  });

  it("maps axe's WCAG tags to criteria and sums an axe run's results per rule (W3.8)", async () => {
    const x = await acrAxe();
    expect(x.criteriaOf(["cat.color", "wcag2aa", "wcag143", "wcag1410", "wcag2411", "wcag258", "EN-301-549"])).toEqual(["1.4.3", "1.4.10", "2.4.11", "2.5.8"]);
    const batch = {
      version: "4.11.3",
      failed: ["SearchDialog: import x"],
      tags: { "color-contrast": ["wcag2aa", "wcag143"], "button-name": ["wcag2a", "wcag412"], "target-size": ["wcag22aa", "wcag258"] },
      runs: [
        { surface: "Toolbar", lang: "he", theme: "light", passes: ["color-contrast", "button-name"], incomplete: [], violations: [] },
        { surface: "Toolbar", lang: "he", theme: "dark", passes: ["button-name"], incomplete: ["target-size"], violations: [{ id: "color-contrast", impact: "serious", nodes: 2 }] },
      ],
    };
    const lines = `noise\nAXE ${JSON.stringify(batch)}\nRESULT pass 1 fail 0`;
    const sum = x.summarize(x.parseResults(lines), { date: "2026-11-14", commit: "abc", source: "test" });
    expect(sum).toMatchObject({ version: "4.11.3", runs: 2, setups: ["he/light", "he/dark"], surfaces: ["Toolbar"], notRun: ["SearchDialog: import x"] });
    expect(sum.rules["color-contrast"]).toEqual({ criteria: ["1.4.3"], pass: 1, fail: 1, incomplete: 0, failures: [{ surface: "Toolbar", setup: "he/dark", impact: "serious", nodes: 2 }] });
    expect(sum.rules["target-size"]).toMatchObject({ criteria: ["2.5.8"], incomplete: 1 });
    expect(x.parseResults(JSON.stringify(batch))).toHaveLength(1);
    expect(() => x.summarize([{ ...batch, tags: {} }], { date: "d", commit: "c", source: "s" })).toThrow(/no tags/);
  });

  it("takes its automated part from axe: what each criterion's rules found, and a violation rules out 'supports'", async () => {
    const m = await acr();
    const report = m.loadReport(ROOT);
    const axe = m.loadAxe(ROOT);
    expect(axe, "docs/acr/axe.json, from an axe run").not.toBeNull();
    expect(axe!.version).toMatch(/^4\./);
    // The run behind it is on record: surfaces, setups, and each rule's criteria.
    expect(axe!.surfaces.length).toBeGreaterThan(20);
    expect(axe!.setups).toEqual(["he/light", "he/dark", "en/light"]);
    expect(m.automatedFor("1.4.3", axe).rules).toContain("color-contrast");
    expect(m.automatedFor("3.3.7", axe).rules).toEqual([]);
    // A criterion marked "supports" that axe finds a violation of is refused.
    const supported = report.criteria.find((c) => c.status === "supports" && m.automatedFor(c.id, axe).rules.length)!;
    const rule = m.automatedFor(supported.id, axe).rules[0];
    const failing = JSON.parse(JSON.stringify(axe));
    failing.rules[rule].fail = 1;
    failing.rules[rule].failures = [{ surface: "Toolbar", setup: "he/dark", impact: "serious", nodes: 1 }];
    expect(m.checkReport(report, ROOT, failing).join("\n")).toContain(`${supported.id}: axe finds 1 violation(s) (${rule}), so it can't be "supports"`);
    expect(m.automatedCell(supported.id, failing, "en")).toMatch(/^✗ 1 violation: /);
    expect(m.checkReport(report, ROOT, null).join("\n")).toContain("docs/acr/axe.json is missing");
    // On the page, every criterion has its axe cell, in both languages.
    for (const lang of ["en", "he"] as const) {
      const page = m.renderPage(report, lang, null, new Set(), axe);
      expect(page).toContain(lang === "en" ? "## Automated testing" : "## בדיקה אוטומטית");
      expect(page).toContain(`axe-core ${axe!.version}`);
      expect(page).toContain(m.automatedCell("1.4.3", axe, lang));
    }
    expect(m.automatedCell("3.3.7", axe, "he")).toContain("axe לא בודק");
  });
});

describe("the ACR, EN 301 549 V4.1.1 clauses 9–11 (W11.Q7)", () => {
  it("has a status for every row of clauses 9, 10 and 11: no row is left not evaluated", async () => {
    const m = await acr();
    const rows = m.enRows(m.loadReport(ROOT), m.loadEn(ROOT));
    expect(m.checkEn(m.loadReport(ROOT), m.loadEn(ROOT), ROOT)).toEqual([]);
    for (const r of rows) expect(["supports", "partially-supports", "does-not-support", "not-applicable"], r.id).toContain(r.status);
    expect(rows.filter((r) => r.clause === 9)).toHaveLength(55);
    expect(rows.filter((r) => r.clause === 10)).toHaveLength(1);
  });

  it("clause 9 is every WCAG 2.2 A / AA criterion, with its status", async () => {
    const m = await acr();
    const report = m.loadReport(ROOT);
    const rows = m.enRows(report, m.loadEn(ROOT));
    for (const c of report.criteria) expect(rows.find((r) => r.id === `9.${c.id}`)?.status, c.id).toBe(c.status);
  });

  it("clause 11 leaves out the WCAG criteria V4.1.1 does not apply to software, and has 11.5–11.8", async () => {
    const m = await acr();
    const rows = m.enRows(m.loadReport(ROOT), m.loadEn(ROOT)).filter((r) => r.clause === 11);
    for (const id of ["1.2.4", "2.4.1", "2.4.5", "3.1.2", "3.2.3", "3.2.6"]) expect(rows.some((r) => r.wcag === id), id).toBe(false);
    for (const id of ["11.2.4.2", "11.2.4.11", "11.2.5.8", "11.3.3.8", "11.4.1.2", "11.4.1.3"]) expect(rows.some((r) => r.id === id), id).toBe(true);
    const own = ["11.5.2.1", ...Array.from({ length: 14 }, (_, i) => `11.5.2.${i + 4}`), "11.6.1", "11.6.2", "11.7", "11.8.1", "11.8.2", "11.8.3", "11.8.4", "11.8.5"];
    expect(rows.filter((r) => !r.wcag).map((r) => r.id)).toEqual(own);
    expect(rows).toHaveLength(49 + own.length);
  });

  it("refuses a row without a status, a mirror that disagrees, and a partial row without a plan", async () => {
    const m = await acr();
    const report = m.loadReport(ROOT);
    const en = JSON.parse(JSON.stringify(m.loadEn(ROOT))) as EnSource;
    const row = (id: string) => en.rows.find((r) => r.id === id)!;
    row("11.6.2").status = "not-evaluated";
    row("11.5.2.6").status = "supports"; // 1.3.1 is partially-supports since the axe run (W3.8)
    delete row("11.8.2").plan;
    const problems = m.checkEn(report, en, ROOT).join("\n");
    expect(problems).toMatch(/EN 11\.6\.2: status "not-evaluated"/);
    expect(problems).toMatch(/EN 11\.5\.2\.6: mirrors 1\.3\.1 \(partially-supports\) but says supports/);
    expect(problems).toMatch(/EN 11\.8\.2: partially-supports needs a plan/);
  });

  it("is on both pages, and the statement points to it", async () => {
    const m = await acr();
    for (const lang of ["en", "he"] as const) {
      const page = readFileSync(join(ROOT, m.PAGES[lang]), "utf8");
      expect(page).toContain("## EN 301 549 V4.1.1");
      expect(page).toContain("| 11.8.4 Repair assistance |");
      expect(page).toContain("| 10 Non-web documents |");
    }
    expect(readFileSync(join(ROOT, "docs/src/content/docs/editor/accessibility-statement.md"), "utf8")).toMatch(/EN 301 549 V4\.1\.1[\s\S]*\(\/editor\/acr\/\)/);
    expect(readFileSync(join(ROOT, "docs/src/content/docs/he/editor/accessibility-statement.md"), "utf8")).toMatch(/EN 301 549 V4\.1\.1[\s\S]*\(\/he\/editor\/acr\/\)/);
  });
});

