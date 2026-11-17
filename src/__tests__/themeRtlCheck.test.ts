/**
 * W12.S6 — the RTL check for gallery themes: physical left/right CSS,
 * WCAG 2.2 contrast in light and dark, the screens that are owed to a
 * browser run, and the result inside the W11.S14 scorecard — #701's, the
 * one design on train 6 (W10 port of #910 onto the #714 port).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { contrastRatio, parseColour, physicalCssFindings, RTL_SCREENS, rtlThemeCard, themeContrast, themeTokens, withRtl } from "../plugins/runtime/rtlCheck";
import { reviewPluginVersion } from "../plugins/runtime/review";

const ROOT = resolve(__dirname, "../..");
const app = themeTokens(readFileSync(join(ROOT, "src/index.css"), "utf8"));
const allScreens = Object.fromEntries(RTL_SCREENS.map((s) => [s, { rtl: "pass" as const, ltr: "pass" as const }]));

describe("physical CSS", () => {
  it("a theme with a fixed margin-left fails, naming the logical property and the line", () => {
    const f = physicalCssFindings(".callout {\n  color: red;\n  margin-left: 12px;\n}");
    expect(f).toEqual([{ property: "margin-left", value: "12px", selector: ".callout", line: 3, use: "margin-inline-start" }]);
    const card = rtlThemeCard({ id: "t", version: "1.0.0", css: ".callout { margin-left: 12px }", app, screens: allScreens });
    expect(card.checks.physical).toBe("fail");
    expect(card.rtlTested).toBe(false);
  });

  it("finds side values and offsets; leaves logical properties, direction-scoped rules and comments alone", () => {
    const css = `
      /* margin-left: 1px in a comment */
      .a { float: left; text-align: right; right: 0; border-top-left-radius: 4px }
      .b { margin-inline-start: 1em; text-align: start; float: inline-end; inset-inline-end: 0 }
      [dir="rtl"] .c { margin-right: 4px }
      .d:dir(ltr) { padding-left: 2px }
      @media (max-width: 600px) { .e { padding-right: 3px } }`;
    expect(physicalCssFindings(css).map((f) => `${f.selector}:${f.property}→${f.use}`)).toEqual([
      ".a:float→float: inline-start / inline-end",
      ".a:text-align→text-align: start / end",
      ".a:right→inset-inline-end",
      ".a:border-top-left-radius→border-start-start-radius",
      ".e:padding-right→padding-inline-end",
    ]);
  });
});

describe("contrast (WCAG 2.2 1.4.3)", () => {
  it("measures known ratios", () => {
    expect(contrastRatio(parseColour("0 0% 0%")!, parseColour("0 0% 100%")!)).toBeCloseTo(21, 5);
    expect(contrastRatio(parseColour("#777777")!, parseColour("#ffffff")!)).toBeCloseTo(4.48, 2);
    expect(parseColour("var(--x)")).toBeNull();
  });

  it("the app's own tokens pass in light and dark", () => {
    const r = themeContrast("", app);
    expect(r.length).toBe(18) // 9 pairs (quotes: --fg-subtle and --fg on --bg-subtle, wave g5) × light and dark;
    expect(r.filter((c) => !c.pass)).toEqual([]);
  });

  it("a pale grey text colour fails, in the mode it was set for only", () => {
    const r = themeContrast(":root { --fg-muted: 0 0% 70%; }", app);
    expect(r.filter((c) => !c.pass).map((c) => `${c.mode} ${c.fg}/${c.bg}`)).toEqual(["light --fg-muted/--bg", "light --fg-muted/--bg-muted"]);
  });
});

describe("the badge and the scorecard", () => {
  it("no badge while the screens are owed; with all 16 screenshots passing, the badge", () => {
    const owed = rtlThemeCard({ id: "t", version: "1.0.0", css: "", app });
    expect(owed.checks).toEqual({ physical: "pass", contrast: "pass", screens: "owed" });
    expect(owed.rtlTested).toBe(false);
    expect(rtlThemeCard({ id: "t", version: "1.0.0", css: "", app, screens: allScreens }).rtlTested).toBe(true);
    const oneFails = { ...allScreens, bases: { rtl: "fail" as const, ltr: "pass" as const } };
    expect(rtlThemeCard({ id: "t", version: "1.0.0", css: "", app, screens: oneFails }).checks.screens).toBe("fail");
  });

  it("goes into #701's W11.S14 scorecard: a review warning per finding (10 points each), the RTL card and the badge", async () => {
    const manifest = { schema: 1, id: "lumen.theme.t", name: "T", version: "1.0.0", description: "d", author: "a", license: "MIT", main: "theme.js", capabilities: [] };
    const css = ".x { padding-left: 1px }\n:root { --fg-muted: 0 0% 70%; }";
    const base = await reviewPluginVersion({ manifest, main: "", css, inRepo: true, now: 0 });
    expect(base).toMatchObject({ kind: "lumen-plugin-scorecard", reviewer: "lumen-review/1", passed: true });
    const card = withRtl(base, rtlThemeCard({ id: "lumen.theme.t", version: "1.0.0", css, app }));
    expect(card.kind).toBe("lumen-plugin-scorecard");
    expect(card.findings).toContainEqual({ rule: "rtl-physical-css", severity: "warning", detail: ".x { padding-left: 1px } → padding-inline-start", line: 1 });
    expect(card.findings.filter((f) => f.rule === "rtl-contrast")).toHaveLength(2);
    expect(card.score).toBe(Math.max(0, base.score - 3 * 10));
    expect(card.grade).toBe(card.score >= 90 ? "A" : card.score >= 75 ? "B" : "C");
    expect(card.passed).toBe(base.passed); // RTL is a warning, never a delisting
    expect(card.rtl.checks).toMatchObject({ physical: "fail", contrast: "fail", screens: "owed" });
    expect(card.rtlTested).toBe(false);
  });

  it("a theme that fails the review itself (remote CSS) stays failed with score 0; RTL warnings don't change that", async () => {
    const manifest = { schema: 1, id: "lumen.theme.bad", name: "Bad", version: "1.0.0", description: "d", author: "a", license: "MIT", main: "theme.js", capabilities: [] };
    const css = "a { background: u\\72l(https://collect.example/p) } .x { margin-left: 1px }";
    const base = await reviewPluginVersion({ manifest, main: "", css, inRepo: true });
    const card = withRtl(base, rtlThemeCard({ id: "lumen.theme.bad", version: "1.0.0", css, app }));
    expect(card).toMatchObject({ passed: false, score: 0, grade: "F" });
    expect(card.findings.map((f) => f.rule)).toEqual(expect.arrayContaining(["css-remote-url", "rtl-physical-css"]));
  });

  it("the three sample themes get a card, pass physical and contrast, and their scorecards are current", () => {
    const r = spawnSync(process.execPath, ["scripts/themes/rtl-check.mjs", "--check"], { cwd: ROOT, encoding: "utf8", timeout: 600_000 });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const dir = join(ROOT, "public/themes/examples/scorecards");
    const cards = readdirSync(dir).map((n: string) => JSON.parse(readFileSync(join(dir, n), "utf8")) as { kind: string; id: string; passed: boolean; rtlTested: boolean; rtl: { checks: Record<string, string> } });
    expect(cards.map((c) => c.id).sort()).toEqual(["lumen.theme.high-contrast", "lumen.theme.night-ink", "lumen.theme.sepia"]);
    for (const c of cards) {
      expect(c.kind).toBe("lumen-plugin-scorecard");
      expect(c.passed).toBe(true);
      expect(c.rtl.checks).toEqual({ physical: "pass", contrast: "pass", screens: "owed" });
      expect(c.rtlTested).toBe(false);
    }
  });
});
