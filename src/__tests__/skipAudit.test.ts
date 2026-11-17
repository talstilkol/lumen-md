import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations
import { auditSkips, E2E_SKIP_POINTS_TARGET, findSkips, MAX_E2E_HELPER_SKIPS, MAX_E2E_SKIP_POINTS, MAX_E2E_SKIPS, parseAnnotation, skipHelpers } from "../../scripts/lib/skipAudit.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { classify, vaultGatedTests } from "../../scripts/skip-report.mjs";

type Site = { line: number; call: string; condition: string; annotation: string | null; problems: string[] };
const TODAY = new Date(Date.UTC(2026, 10, 12));
const sites = (src: string, file = "e2e/x.spec.ts"): Site[] => findSkips(file, src, TODAY);
const REASON = "// skip-reason: Playwright's WebKit has no OPFS here | task: 0.5 | until: 2027-05-12";
const ROOT = join(__dirname, "..", "..");

const ENG = "./_engines";
const ENG_UP = "../_engines.ts";

describe("skip audit (plan W4.12)", () => {
  it("fails a planted skip without a reason, in every form the runners have", () => {
    const found = sites(
      [
        'test.skip(!ok, "no vault");',
        'test.describe.fixme("later", () => {});',
        'describe.skipIf(!model)("eval", () => {});',
        'it.runIf(process.env.X)("only with X", () => {});',
        'it.todo("max lines");',
        "test.skip();",
      ].join("\n"),
    );
    expect(found.map((s) => s.call)).toEqual(["test.skip", "test.describe.fixme", "describe.skipIf", "it.runIf", "it.todo", "test.skip"]);
    expect(found.every((s) => s.problems.length === 1 && /no `\/\/ skip-reason:/.test(s.problems[0]))).toBe(true);
  });

  it("accepts a complete reason on the line, above it, or continued over comment lines", () => {
    expect(sites(`test.skip(!ok, "x"); ${REASON}`)[0].problems).toEqual([]);
    expect(sites(`${REASON}\ntest.skip(!ok, "x");`)[0].problems).toEqual([]);
    const long = sites("  // skip-reason: a long reason that goes on\n  // over a second line | task: W4.12 | until: 2027-01-01\n  test.skip(dev, 'x');")[0];
    expect(long.problems).toEqual([]);
    expect(long.annotation).toContain("over a second line");
  });

  it("does not count the words in strings, comments or other calls", () => {
    const src = ['const s = "test.skip(!ok)";', "// test.skip(!ok, 'commented out')", "t.skip(); onboard.skip(); skip();", "page.getByText('Skip setup');"].join("\n");
    expect(sites(src)).toEqual([]);
  });

  it("a reason needs a task and a date that is neither past nor more than a year away", () => {
    expect(parseAnnotation("short", TODAY).problems).toHaveLength(3);
    expect(parseAnnotation("a reason that is long enough | until: 2027-01-01", TODAY).problems).toEqual([expect.stringMatching(/no task/)]);
    expect(parseAnnotation("a reason that is long enough | task: W4.12", TODAY).problems).toEqual([expect.stringMatching(/no review date/)]);
    expect(parseAnnotation("a reason that is long enough | task: W4.12 | until: 2027-02-30", TODAY).problems).toEqual([expect.stringMatching(/no review date/)]);
    expect(parseAnnotation("a reason that is long enough | task: #431 | until: 2026-11-11", TODAY).problems).toEqual([expect.stringMatching(/has passed/)]);
    expect(parseAnnotation("a reason that is long enough | task: 0.5 | until: 2026-11-12", TODAY).problems).toEqual([]);
    expect(parseAnnotation("a reason that is long enough | task: 0.5 | until: 2028-01-01", TODAY).problems).toEqual([expect.stringMatching(/more than 366 days/)]);
    // Plan ids since wave 10 carry a letter (W10.A6, W12.V5); a word or a lower-case id is still no task.
    expect(parseAnnotation("a reason that is long enough | task: W10.A6 | until: 2026-11-12", TODAY).problems).toEqual([]);
    for (const bad of ["W10.a6", "W10.AB", "later", "W10."]) expect(parseAnnotation(`a reason that is long enough | task: ${bad} | until: 2026-11-12`, TODAY).problems, bad).toEqual([expect.stringMatching(/no task/)]);
  });

  it(`e2e/ holds at most ${MAX_E2E_SKIPS} skips, annotated or not`, () => {
    const dir = mkdtempSync(join(tmpdir(), "skip-audit-"));
    try {
      mkdirSync(join(dir, "e2e"));
      const body = (n: number) => Array.from({ length: n }, (_, i) => `${REASON}\ntest.skip(!ok${i}, "x");`).join("\n");
      writeFileSync(join(dir, "e2e", "a.spec.ts"), body(MAX_E2E_SKIPS));
      expect(auditSkips(dir, { today: TODAY }).violations).toEqual([]);
      writeFileSync(join(dir, "e2e", "a.spec.ts"), body(MAX_E2E_SKIPS + 1));
      const r = auditSkips(dir, { today: TODAY });
      expect(r.e2eCount).toBe(MAX_E2E_SKIPS + 1);
      expect(r.violations.map((v: { rule: string }) => v.rule)).toEqual(["skip-count"]);
      // A planted skip without a reason fails on its own line.
      writeFileSync(join(dir, "e2e", "a.spec.ts"), `test("x", async ({ page }) => {\n  test.skip(!(await seed(page)), "no vault");\n});\n`);
      expect(auditSkips(dir, { today: TODAY }).violations).toEqual([{ file: "e2e/a.spec.ts", line: 2, rule: "skip-reason", text: expect.stringMatching(/^test\.skip: no `\/\/ skip-reason:/) }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a call of an e2e/_engines.ts skip helper is a skip of its own: it needs its own reason and counts (R8-L3)", () => {
    const helpers = 'import { test } from "@playwright/test";\nexport function chromiumOnly(b: string, what: string): void {\n  ' + REASON + '\n  test.skip(b !== "chromium", what);\n}\nexport function notASkip(): number {\n  return 1;\n}\nfunction privateSkip(): void {\n  ' + REASON + '\n  test.skip(true);\n}\n';
    expect([...skipHelpers(helpers)]).toEqual(["chromiumOnly"]);
    const dir = mkdtempSync(join(tmpdir(), "skip-audit-h-"));
    try {
      mkdirSync(join(dir, "e2e"));
      writeFileSync(join(dir, "e2e", "_engines.ts"), helpers);
      // Unannotated: the call site fails on its own line, even though the helper's own skip has a reason.
      writeFileSync(join(dir, "e2e", "a.spec.ts"), 'test("x", async ({ browserName }) => {\n  chromiumOnly(browserName, "the pixel baseline");\n  notASkip();\n});\n');
      let r = auditSkips(dir, { today: TODAY });
      expect(r.e2eHelperCount).toBe(1);
      expect(r.e2eCount).toBe(2); // the two test.skip calls in the helper file
      expect(r.violations).toEqual([{ file: "e2e/a.spec.ts", line: 2, rule: "skip-reason", text: expect.stringMatching(/^chromiumOnly: no `\/\/ skip-reason:/) }]);
      // Annotated: passes; one more than the cap of helper calls fails the count.
      const body = (n: number) => Array.from({ length: n }, () => `${REASON}\nchromiumOnly(browserName, "x");`).join("\n");
      writeFileSync(join(dir, "e2e", "a.spec.ts"), body(MAX_E2E_HELPER_SKIPS));
      expect(auditSkips(dir, { today: TODAY }).violations).toEqual([]);
      writeFileSync(join(dir, "e2e", "a.spec.ts"), body(MAX_E2E_HELPER_SKIPS + 1));
      r = auditSkips(dir, { today: TODAY });
      expect(r.e2eHelperCount).toBe(MAX_E2E_HELPER_SKIPS + 1);
      expect(r.violations.map((v: { rule: string }) => v.rule)).toEqual(["skip-count"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The fixtures name the module through ENG, not a literal: the offline train's import
  // check (scripts/lib/importCheck.mjs) reads TypeScript's pre-processor, which takes an
  // `import … from "./_engines"` at a line start of a template for a real import.
  it("a helper is seen however it is imported, and one used but not called fails (R8b-L4)", () => {
    const engines = 'import { test } from "@playwright/test";\nexport function chromiumOnly(b: string, w: string): void {\n  ' + REASON + '\n  test.skip(b !== "chromium", w);\n}\nexport const arrowOnly = (b: string): void => {\n  ' + REASON + '\n  test.skip(b !== "chromium");\n};\nconst later = function (): void {\n  ' + REASON + '\n  test.skip(true);\n};\nexport { later as laterOnly };\nexport const notASkip = (): number => 1;\nexport type Gap = "x";\n';
    const h = skipHelpers(engines);
    expect([...h].sort()).toEqual(["arrowOnly", "chromiumOnly", "laterOnly"]);
    const count = (src: string) => findSkips("e2e/x.spec.ts", src, TODAY, h);
    // The reviewer's four cases (review 8b): base saw only the first.
    expect(count(`import { chromiumOnly } from "${ENG}";\ntest("x", ({browserName}) => { chromiumOnly(browserName, "the pixel baseline"); });`)).toHaveLength(1);
    expect(count(`import * as E from "${ENG}";\ntest("x", ({browserName}) => { E.chromiumOnly(browserName, "the pixel baseline"); });`).map((s) => s.call)).toEqual(["E.chromiumOnly"]);
    expect(count(`import { chromiumOnly as only } from "${ENG}";\ntest("x", ({browserName}) => { only(browserName, "the pixel baseline"); });`).map((s) => s.call)).toEqual(["only"]);
    const ref = count(`import { laterOnly } from "${ENG}";\n["a fake microphone"].forEach(laterOnly);`);
    expect(ref).toHaveLength(1);
    expect(ref[0].problems).toEqual([expect.stringMatching(/used other than in a call/)]);
    // An annotated reference still fails: it has no call site of its own.
    expect(count(`import { chromiumOnly } from "${ENG}";\n${REASON}\nconst f = chromiumOnly;`)[0].problems).toEqual([expect.stringMatching(/used other than in a call/)]);
    // The exported const arrow helper, and the namespace in every escaping form.
    expect(count(`import { arrowOnly } from "${ENG_UP}";\n${REASON}\narrowOnly(browserName);`).map((s) => s.problems)).toEqual([[]]);
    const escapes = ["const f = E.chromiumOnly;", "use(E);", 'E["chromiumOnly"](b, "x");', "const { chromiumOnly: c } = E;", "x({ chromiumOnly });"];
    // Joined, not a template: a template's new lines would put "import" at a line start of the compiled test.
    const both = (esc: string) => [`import * as E from "${ENG}";`, `import { chromiumOnly } from "${ENG}";`, esc].join("\n");
    const missed = escapes.filter((esc) => !count(both(esc)).some((s) => s.problems.some((p) => /other than in a call/.test(p))));
    expect(missed).toEqual([]);
    // A re-export moves the helper out of sight.
    expect(count(`export { chromiumOnly } from "${ENG}";`)[0].problems).toEqual([expect.stringMatching(/used other than in a call/)]);
    expect(count(`export * from "${ENG}";`)).toHaveLength(1);
    // Not helpers: the type, a non-skipping export, an unrelated module's names, a property named like a helper.
    const plain = [`import { notASkip, type Gap } from "${ENG}";`, `import * as E from "${ENG}";`, 'import { only } from "./other";', 'const g: Gap = "x"; notASkip(); E.notASkip(); only(); const o = { chromiumOnly: 1 }; o.chromiumOnly;'];
    expect(count(plain.join("\n"))).toEqual([]);
    // The same file with a helper call in it is seen (so the empty result above is not a parse failure).
    expect(count([...plain, "E.chromiumOnly(b, \"x\");"].join("\n"))).toHaveLength(1);
  });

  it("a dynamic import, a call off one, and a default import reach the helpers too (review 9, L4)", () => {
    const engines = 'import { test } from "@playwright/test";\nexport function chromiumOnly(b: string, w: string): void {\n  ' + REASON + '\n  test.skip(b !== "chromium", w);\n}\nexport const other = (): number => 1;\n';
    const h = skipHelpers(engines);
    const count = (src: string) => findSkips("e2e/x.spec.ts", src, TODAY, h).map((s: Site) => [s.call, s.problems.length]);
    // The reviewer's cases: base saw none of the first three.
    expect(count(`const E = await import("${ENG}");\ntest("x", ({ browserName }) => { E.chromiumOnly(browserName, "w"); });`)).toEqual([["E.chromiumOnly", 1]]);
    expect(count(`test("x", async ({ browserName }) => { (await import("${ENG}")).chromiumOnly(browserName, "w"); });`)).toEqual([[`(await import("${ENG}")).chromiumOnly`, 1]]);
    expect(count(`import E from "${ENG}";\nE.chromiumOnly(b, "w");`)).toEqual([["E.chromiumOnly", 1]]);
    expect(count(`const { chromiumOnly: only } = await import("${ENG_UP}");\nonly(b, "w");`)).toEqual([["only", 1]]);
    // Annotated, the dynamic forms pass like the static ones.
    expect(count(`const E = await import("${ENG}");\n${REASON}\nE.chromiumOnly(b, "w");`)).toEqual([["E.chromiumOnly", 0]]);
    // A dynamic import used any other way fails: the check can't see what it calls.
    for (const esc of [`import("${ENG}").then((E) => E.chromiumOnly(b, "w"));`, `use(await import("${ENG}"));`, `const p = import("${ENG}");`.replace("const p = ", "")])
      expect(count(esc), esc).toEqual([[expect.stringMatching(/\(not a call\)$/), 1]]);
    // Not helpers: another export of the module, another module.
    expect(count(`(await import("${ENG}")).other();\nconst { other } = await import("${ENG}");\nother();\nconst o = await import("./other");\no.chromiumOnly(b);`)).toEqual([]);
  });

  it("the audit opens a file that reaches a helper only through an alias or a namespace", () => {
    const engines = 'import { test } from "@playwright/test";\nexport function chromiumOnly(b: string, w: string): void {\n  ' + REASON + '\n  test.skip(b !== "chromium", w);\n}\n';
    const dir = mkdtempSync(join(tmpdir(), "skip-audit-ns-"));
    try {
      mkdirSync(join(dir, "e2e"));
      writeFileSync(join(dir, "e2e", "_engines.ts"), engines);
      writeFileSync(join(dir, "e2e", "a.spec.ts"), `import * as E from "${ENG}";\ntest("x", ({ browserName }) => {\n  E.chromiumOnly(browserName, "x");\n});\n`);
      const r = auditSkips(dir, { today: TODAY });
      expect(r.e2eHelperCount).toBe(1);
      expect(r.violations).toEqual([{ file: "e2e/a.spec.ts", line: 3, rule: "skip-reason", text: expect.stringMatching(/^E\.chromiumOnly: no `\/\/ skip-reason:/) }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("W10.F11: e2e skip points count each place once: skips outside _engines.ts plus helper calls, not the helpers' own bodies", () => {
    expect([MAX_E2E_SKIP_POINTS, E2E_SKIP_POINTS_TARGET]).toEqual([19, 15]);
    const helpers = 'import { test } from "@playwright/test";\nexport function chromiumOnly(b: string, what: string): void {\n  ' + REASON + '\n  test.skip(b !== "chromium", what);\n}\n';
    const dir = mkdtempSync(join(tmpdir(), "skip-audit-p-"));
    try {
      mkdirSync(join(dir, "e2e"));
      writeFileSync(join(dir, "e2e", "_engines.ts"), helpers);
      writeFileSync(join(dir, "e2e", "a.spec.ts"), `${REASON}\ntest.skip(!ok, "x");\n${REASON}\nchromiumOnly(browserName, "x");\n${REASON}\nchromiumOnly(browserName, "y");\n`);
      const r = auditSkips(dir, { today: TODAY });
      // 1 direct + 2 helper calls; the helper's own test.skip is not a third place.
      expect([r.e2eCount, r.e2eHelperCount, r.e2eSkipPoints]).toEqual([2, 2, 3]);
      // Past the ratchet: the points fail even while each separate cap holds.
      const many = Array.from({ length: 12 }, (_, i) => `${REASON}\ntest.skip(!ok${i}, "x");`).join("\n") + "\n" + Array.from({ length: 8 }, () => `${REASON}\nchromiumOnly(browserName, "x");`).join("\n");
      writeFileSync(join(dir, "e2e", "a.spec.ts"), many);
      const r2 = auditSkips(dir, { today: TODAY });
      expect(r2.e2eCount).toBeLessThanOrEqual(MAX_E2E_SKIPS);
      expect(r2.e2eHelperCount).toBeLessThanOrEqual(MAX_E2E_HELPER_SKIPS);
      expect(r2.e2eSkipPoints).toBe(20);
      expect(r2.violations).toEqual([{ file: "e2e/", line: 0, rule: "skip-count", text: expect.stringMatching(/^20 skip points in e2e\//) }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the repository passes: every skip has a reason, and e2e/ is within the cap", () => {
    const r = auditSkips(ROOT);
    expect(r.violations).toEqual([]);
    expect(r.e2eCount).toBeLessThanOrEqual(MAX_E2E_SKIPS);
    // Every chromiumOnly / chromiumOnlyHere call site is seen and annotated (R8-L3).
    expect(r.e2eHelperCount).toBeGreaterThanOrEqual(8);
    expect(r.e2eHelperCount).toBeLessThanOrEqual(MAX_E2E_HELPER_SKIPS);
    expect(r.e2eSkipPoints).toBeLessThanOrEqual(MAX_E2E_SKIP_POINTS);
  });

  it("the report sorts skips by what they leave out, and lists the vault flows WebKit does not run", () => {
    expect(classify({ call: "it.todo", condition: "" })).toBe("deferred");
    expect(classify({ call: "test.skip", condition: 'browserName !== "chromium"' })).toBe("engine");
    expect(classify({ call: "test.skip", condition: "!process.env.OCR_CER" })).toBe("setup");
    const gated = vaultGatedTests(join(ROOT, "e2e")) as Array<{ file: string; title: string }>;
    expect(gated.length).toBeGreaterThan(20);
    expect(gated).toContainEqual({ file: "e2e/data-safety.spec.ts", title: "G7: the whole vault exports as a zip" });
  });
});
