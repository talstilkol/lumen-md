/**
 * W12.S6 — the RTL check every theme in the gallery passes before it is
 * badged "tested in RTL", feeding the W11.S14 scorecard.
 *
 * Three parts:
 *   • physical CSS — `margin-left`, `padding-right`, `float: left`,
 *     `text-align: right`, `left:`/`right:` offsets, one-sided borders and
 *     corner radii: each breaks a right-to-left layout unless it sits in a
 *     rule scoped to one direction (`[dir="rtl"] …`, `:dir(ltr)`). The fix
 *     is the logical property (`margin-inline-start`, …), named in the
 *     finding.
 *   • contrast — WCAG 2.2 1.4.3: the theme's text colours against its
 *     backgrounds, in light and dark, with the app's own tokens where the
 *     theme leaves one unset.
 *   • screens — screenshots of 8 screens in RTL and LTR. They need a real
 *     browser (Playwright, on the Mac); until a run reports them the
 *     result is "owed" and there is no badge.
 *
 * The badge (`rtlTested`) is given only when all three pass.
 *
 * W10 port onto train 6: the result feeds #701's W11.S14 scorecard (the one
 * design on the train), not #714's: its findings become review warnings
 * through `withReviewWarnings`, which costs them what any review warning
 * costs, and the card carries `rtl` and `rtlTested`.
 */
import { withReviewWarnings, type ReviewFinding, type Scorecard } from "./review";

export const RTL_SCREENS = ["editor", "preview", "table", "lists", "callouts", "code-in-hebrew", "bases", "settings"] as const;

export interface PhysicalFinding {
  property: string;
  value: string;
  selector: string;
  line: number;
  /** The logical property or value to use instead. */
  use: string;
}

const LOGICAL: Record<string, string> = {
  "margin-left": "margin-inline-start",
  "margin-right": "margin-inline-end",
  "padding-left": "padding-inline-start",
  "padding-right": "padding-inline-end",
  "border-left": "border-inline-start",
  "border-right": "border-inline-end",
  "border-left-width": "border-inline-start-width",
  "border-right-width": "border-inline-end-width",
  "border-left-color": "border-inline-start-color",
  "border-right-color": "border-inline-end-color",
  "border-left-style": "border-inline-start-style",
  "border-right-style": "border-inline-end-style",
  "border-top-left-radius": "border-start-start-radius",
  "border-top-right-radius": "border-start-end-radius",
  "border-bottom-left-radius": "border-end-start-radius",
  "border-bottom-right-radius": "border-end-end-radius",
  left: "inset-inline-start",
  right: "inset-inline-end",
  "scroll-margin-left": "scroll-margin-inline-start",
  "scroll-margin-right": "scroll-margin-inline-end",
  "scroll-padding-left": "scroll-padding-inline-start",
  "scroll-padding-right": "scroll-padding-inline-end",
};
/** Properties whose `left`/`right` value is physical. */
const SIDE_VALUE: Record<string, string> = { float: "inline-start / inline-end", clear: "inline-start / inline-end", "text-align": "start / end" };

const lineAt = (css: string, i: number) => css.slice(0, i).split("\n").length;
/** A rule meant for one direction only. */
const directional = (selector: string) => /\[dir\s*=|:dir\(/i.test(selector);

/** Every physical left/right rule outside a direction-scoped selector. */
export function physicalCssFindings(css: string): PhysicalFinding[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const out: PhysicalFinding[] = [];
  // Innermost blocks: `selector { declarations }` (an @media wrapper is skipped by construction).
  for (const m of src.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, " ");
    if (!selector || selector.startsWith("@") || directional(selector)) continue;
    const bodyAt = (m.index ?? 0) + m[1].length + 1;
    for (const d of m[2].matchAll(/(^|;)\s*([a-z-]+)\s*:\s*([^;]*)/gi)) {
      const property = d[2].toLowerCase();
      const value = d[3].trim();
      const at = bodyAt + (d.index ?? 0) + d[0].indexOf(d[2]);
      if (LOGICAL[property]) out.push({ property, value, selector, line: lineAt(src, at), use: LOGICAL[property] });
      else if (SIDE_VALUE[property] && /^(left|right)\b/i.test(value)) out.push({ property, value, selector, line: lineAt(src, at), use: `${property}: ${SIDE_VALUE[property]}` });
    }
  }
  return out;
}

/* ─── contrast ─────────────────────────────────────────────────────── */

export type Tokens = Record<string, string>;

/** Custom properties set for light (`:root`, `html`, `body`) and dark (`.dark …`) in a stylesheet. */
export function themeTokens(css: string): { light: Tokens; dark: Tokens } {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const light: Tokens = {};
  const dark: Tokens = {};
  for (const m of src.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const sel = m[1];
    const target = /\.dark\b|\[data-theme\s*=\s*["']?dark/.test(sel) ? dark : /(^|[\s,]):root\b|(^|[\s,])html\b|(^|[\s,])body\b/.test(sel) ? light : null;
    if (!target) continue;
    for (const d of m[2].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+)/gi)) target[d[1]] = d[2].trim();
  }
  return { light, dark };
}

/** `h s% l%` (the app's HSL triplets) or `#rrggbb` → sRGB 0..1; null when it is neither. */
export function parseColour(v: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
  }
  const m = /^(?:hsl\()?\s*(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*\)?$/.exec(v.trim());
  if (!m) return null;
  const h = (((Number(m[1]) % 360) + 360) % 360) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  return [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)];
}

const lum = ([r, g, b]: [number, number, number]) => {
  const f = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

/** WCAG contrast ratio of two colours. */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Text token on background token, and the ratio WCAG 2.2 1.4.3 asks of it. */
export const CONTRAST_PAIRS: ReadonlyArray<[string, string, number]> = [
  ["--fg", "--bg", 4.5],
  ["--fg", "--bg-muted", 4.5],
  ["--fg", "--bg-subtle", 4.5],
  ["--fg-subtle", "--bg", 4.5],
  // A quote: .prose-lumen blockquote is --fg-subtle on --bg-subtle.
  ["--fg-subtle", "--bg-subtle", 4.5],
  ["--fg-muted", "--bg", 4.5],
  ["--fg-muted", "--bg-muted", 4.5],
  ["--accent", "--bg", 4.5],
  ["--accent-fg", "--accent", 4.5],
];

export interface ContrastResult {
  mode: "light" | "dark";
  fg: string;
  bg: string;
  ratio: number;
  min: number;
  pass: boolean;
}

/** Every pair in both modes; a theme token wins over the app's, which fill in the rest. */
export function themeContrast(css: string, app: { light: Tokens; dark: Tokens }): ContrastResult[] {
  const t = themeTokens(css);
  const out: ContrastResult[] = [];
  for (const mode of ["light", "dark"] as const) {
    // A theme's :root tokens also apply in dark mode (the theme sheet comes after the app's,
    // and `:root` and `.dark` match the same <html>): a token set only for light leaks into dark.
    const tokens = mode === "light" ? { ...app.light, ...t.light } : { ...app.dark, ...t.light, ...t.dark };
    for (const [fg, bg, min] of CONTRAST_PAIRS) {
      const a = parseColour(tokens[fg] ?? "");
      const b = parseColour(tokens[bg] ?? "");
      if (!a || !b) continue;
      const ratio = Math.round(contrastRatio(a, b) * 100) / 100;
      out.push({ mode, fg, bg, ratio, min, pass: ratio >= min });
    }
  }
  return out;
}

/* ─── the card ─────────────────────────────────────────────────────── */

export type ScreenResult = "pass" | "fail" | "owed";

export interface RtlCard {
  rtl: 1;
  id: string;
  version: string;
  checks: { physical: "pass" | "fail"; contrast: "pass" | "fail"; screens: ScreenResult };
  physical: PhysicalFinding[];
  contrast: ContrastResult[];
  /** Per screen and direction, from a browser run (absent: owed). */
  screens: Partial<Record<(typeof RTL_SCREENS)[number], { rtl: ScreenResult; ltr: ScreenResult }>>;
  /** The "tested in RTL" badge: everything passed, the screens included. */
  rtlTested: boolean;
}

export function rtlThemeCard(input: {
  id: string;
  version: string;
  css: string;
  app: { light: Tokens; dark: Tokens };
  screens?: RtlCard["screens"];
}): RtlCard {
  const physical = physicalCssFindings(input.css);
  const contrast = themeContrast(input.css, input.app);
  const screens = input.screens ?? {};
  const all = RTL_SCREENS.flatMap((s) => (screens[s] ? [screens[s]!.rtl, screens[s]!.ltr] : ["owed" as const]));
  const screensResult: ScreenResult = all.includes("fail") ? "fail" : all.includes("owed") ? "owed" : "pass";
  const checks = { physical: physical.length ? "fail" : "pass", contrast: contrast.every((c) => c.pass) ? "pass" : "fail", screens: screensResult } as const;
  return { rtl: 1, id: input.id, version: input.version, checks, physical, contrast, screens, rtlTested: checks.physical === "pass" && checks.contrast === "pass" && screensResult === "pass" };
}

/** The W11.S14 scorecard (#701's) with the RTL result in it: a warning per finding, `rtl` and the badge. A failing RTL check is a warning, not a delisting. */
export function withRtl(card: Scorecard, rtl: RtlCard): Scorecard & { rtl: RtlCard; rtlTested: boolean } {
  const warnings: ReviewFinding[] = [
    ...rtl.physical.map((f) => ({ rule: "rtl-physical-css" as const, severity: "warning" as const, detail: `${f.selector} { ${f.property}: ${f.value} } → ${f.use}`, line: f.line })),
    ...rtl.contrast.filter((c) => !c.pass).map((c) => ({ rule: "rtl-contrast" as const, severity: "warning" as const, detail: `${c.mode}: ${c.fg} on ${c.bg} is ${c.ratio}:1, needs ${c.min}:1` })),
  ];
  return { ...withReviewWarnings(card, warnings), rtl, rtlTested: rtl.rtlTested };
}
