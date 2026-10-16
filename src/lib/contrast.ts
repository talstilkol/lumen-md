/**
 * Colour helpers for the theme customiser: strict hex parsing, HSL
 * conversion (the app's CSS variables are bare `H S% L%` triplets consumed
 * as `hsl(var(--x))`) and the WCAG 2.x contrast-ratio formula.
 *
 * Pure functions — no DOM access — so they're trivially unit-testable.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** True for `#rgb` / `#rrggbb` (case-insensitive). Nothing else is accepted. */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value);
}

/** Normalise `#ABC` / `#aabbcc` to lowercase `#aabbcc`. Throws on invalid input. */
export function normalizeHex(hex: string): string {
  if (!isHexColor(hex)) throw new Error(`Invalid hex colour: ${hex}`);
  const h = hex.slice(1).toLowerCase();
  if (h.length === 3) return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  return `#${h}`;
}

export function hexToRgb(hex: string): Rgb {
  const h = normalizeHex(hex).slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** HSL (h in degrees, s/l in percent) → sRGB 0-255. */
export function hslToRgb(h: number, s: number, l: number): Rgb {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) =>
    lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 };
}

/** sRGB → HSL with h in degrees and s/l in percent. */
export function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** `#7c5cff` → `"252.4 100% 68%"` — the bare triplet our CSS variables use. */
export function hexToHslTriplet(hex: string): string {
  const { h, s, l } = rgbToHsl(hexToRgb(hex));
  return `${round1(h)} ${round1(s)}% ${round1(l)}%`;
}

/** WCAG relative luminance of an sRGB colour (0 = black, 1 = white). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours, in [1, 21]. Order-independent. */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const la = relativeLuminance(typeof a === "string" ? hexToRgb(a) : a);
  const lb = relativeLuminance(typeof b === "string" ? hexToRgb(b) : b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * WCAG 2.x AA: 4.5:1 for normal text, 3:1 for large text (≥ 18pt, or
 * ≥ 14pt bold) and for non-text UI components.
 */
export function meetsAA(ratio: number, opts: { large?: boolean } = {}): boolean {
  return ratio >= (opts.large ? 3 : 4.5);
}

/** WCAG 2.x AAA: 7:1 normal text, 4.5:1 large text. */
export function meetsAAA(ratio: number, opts: { large?: boolean } = {}): boolean {
  return ratio >= (opts.large ? 4.5 : 7);
}

/** Black or white — whichever reads better on `bg`. */
export function bestTextOn(bg: string): "#000000" | "#ffffff" {
  return contrastRatio(bg, "#000000") >= contrastRatio(bg, "#ffffff")
    ? "#000000"
    : "#ffffff";
}
