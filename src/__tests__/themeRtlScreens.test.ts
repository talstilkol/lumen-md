/**
 * W12.S6, wave g5: the "screens" half of a theme's RTL check
 * (src/plugins/runtime/rtlScreens.ts), and the dark-mode token leak the
 * browser run found in the sepia theme.
 *
 * The box sets here are SYNTHETIC (hand-written in the shape the browser
 * probe returns, scripts/themes/rtl-probe.mjs). The browser run itself is
 * scripts/themes/rtl-screens-specimen.mjs (offline specimen) and
 * e2e/themes-rtl-screens.spec.ts (the running app).
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { judgeScreen, mirrorMisses, screensForCard, type ProbeBox, type ScreenMeasure } from "../plugins/runtime/rtlScreens";
import { RTL_SCREENS, rtlThemeCard, themeContrast, themeTokens } from "../plugins/runtime/rtlCheck";
// @ts-expect-error -- plain .mjs module without type declarations
import { PROBE, SCREENS, SPECIMEN_MD } from "../../scripts/themes/rtl-probe.mjs";

const W = 1000;
/** An LTR layout and its exact mirror. */
const ltr: ProbeBox[] = [
  { key: "h1#1", x: 40, y: 10, width: 600, height: 40 },
  { key: "div.callout#1", x: 40, y: 80, width: 920, height: 60 },
  { key: "td#1", x: 40, y: 160, width: 300, height: 30 },
];
const mirror = (b: ProbeBox[]): ProbeBox[] => b.map((x) => ({ ...x, x: W - (x.x + x.width) }));
const measure = (rtl: ProbeBox[], extra: Partial<ScreenMeasure> = {}): ScreenMeasure => ({ viewport: W, overflowX: { rtl: 0, ltr: 0 }, rtl, ltr, ...extra });

describe("a screen is judged by its mirror image", () => {
  it("a layout that mirrors passes in both directions", () => {
    expect(judgeScreen(measure(mirror(ltr)))).toMatchObject({ rtl: "pass", ltr: "pass", misses: [] });
  });

  it("a theme's `margin-left: 40px` on callouts moves the RTL callout 40 px off its mirror: RTL fails, naming the block", () => {
    const rtl = mirror(ltr).map((b) => (b.key === "div.callout#1" ? { ...b, x: b.x + 40, width: b.width - 40 } : b));
    const v = judgeScreen(measure(rtl));
    expect(v.rtl).toBe("fail");
    expect(v.ltr).toBe("pass");
    expect(v.misses.map((m) => m.key)).toEqual(["div.callout#1"]);
    expect(v.reasons[0]).toMatch(/div\.callout#1 at x=80, its mirror is x=40 \(width -40\)/);
  });

  it("2 px of rounding is not a miss; 4 px is", () => {
    expect(mirrorMisses(measure(mirror(ltr).map((b) => ({ ...b, x: b.x + 2 }))))).toEqual([]);
    expect(mirrorMisses(measure(mirror(ltr).map((b) => ({ ...b, x: b.x + 4 }))))).toHaveLength(3);
  });

  it("sideways scrolling fails the direction it happens in", () => {
    expect(judgeScreen(measure(mirror(ltr), { overflowX: { rtl: 120, ltr: 0 } }))).toMatchObject({ rtl: "fail", ltr: "pass" });
    expect(judgeScreen(measure(mirror(ltr), { overflowX: { rtl: 0, ltr: 50 } }))).toMatchObject({ rtl: "pass", ltr: "fail" });
  });

  it("an axe serious/critical violation fails its direction", () => {
    expect(judgeScreen(measure(mirror(ltr), { axe: { rtl: ["color-contrast:blockquote > p"], ltr: [] } }))).toMatchObject({ rtl: "fail", ltr: "pass" });
  });

  it("nothing probed proves nothing: the screen stays owed, never passes", () => {
    expect(judgeScreen({ viewport: W, overflowX: { rtl: 0, ltr: 0 }, rtl: [], ltr: [] })).toMatchObject({ rtl: "owed", ltr: "owed" });
    expect(judgeScreen(measure([{ key: "other#1", x: 0, y: 0, width: 5, height: 5 }])).rtl).toBe("fail");
  });

  it("what the app does with no theme at all is not held against a theme", () => {
    const rtl = mirror(ltr).map((b) => (b.key === "td#1" ? { ...b, x: b.x + 10 } : b));
    expect(judgeScreen(measure(rtl)).rtl).toBe("fail");
    expect(judgeScreen(measure(rtl), undefined, new Set(["td#1"])).rtl).toBe("pass");
  });
});

describe("the screens go into the card", () => {
  it("8 passing screens give the badge; one owed screen withholds it; one failing screen fails it", () => {
    const all = Object.fromEntries(RTL_SCREENS.map((s) => [s, measure(mirror(ltr))]));
    const app = themeTokens(readFileSync("src/index.css", "utf8"));
    expect(rtlThemeCard({ id: "t", version: "1", css: "", app, screens: screensForCard(all) }).rtlTested).toBe(true);
    const seven = Object.fromEntries(Object.entries(all).filter(([s]) => s !== "settings"));
    expect(rtlThemeCard({ id: "t", version: "1", css: "", app, screens: screensForCard(seven) }).checks.screens).toBe("owed");
    const broken = { ...all, callouts: measure(mirror(ltr).map((b) => ({ ...b, x: b.x + 40 }))) };
    const card = rtlThemeCard({ id: "t", version: "1", css: "", app, screens: screensForCard(broken) });
    expect(card.checks.screens).toBe("fail");
    expect(card.rtlTested).toBe(false);
  });

  it("the probe covers all 8 screens and the specimen note has every content screen in it", () => {
    expect(Object.keys(SCREENS).sort()).toEqual([...RTL_SCREENS].sort());
    expect(typeof PROBE).toBe("string");
    for (const s of ["| שם |", "> [!note]", "- פריט", "```js", "`npm run build`"]) expect(SPECIMEN_MD).toContain(s);
  });
});

describe("contrast: a theme's light tokens also apply in dark mode", () => {
  const app = themeTokens(readFileSync("src/index.css", "utf8"));

  it("a --bg-subtle set only in :root leaks into dark, where light text on it fails (the sepia theme did this)", () => {
    const css = ":root { --bg-subtle: 40 35% 93%; } .dark { --fg-subtle: 38 18% 72%; }";
    const quote = themeContrast(css, app).find((c) => c.mode === "dark" && c.fg === "--fg-subtle" && c.bg === "--bg-subtle")!;
    expect(quote.pass).toBe(false);
    expect(quote.ratio).toBeLessThan(2);
  });

  it("the gallery's sepia sets its dark --bg-subtle, and passes", () => {
    const css = readFileSync("public/themes/examples/sepia/theme.css", "utf8");
    expect(themeTokens(css).dark["--bg-subtle"]).toBeTruthy();
    expect(themeContrast(css, app).filter((c) => !c.pass)).toEqual([]);
  });
});
