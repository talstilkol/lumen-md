/**
 * W12.S6 — the "screens" part of a theme's RTL check: what a browser run
 * measures on each of the 8 screens (RTL_SCREENS), and how it is judged.
 *
 * A theme is RTL-safe on a screen when the right-to-left page is the mirror
 * image of the left-to-right one. The run renders the screen twice with the
 * theme applied (dir="ltr" and dir="rtl", same content, same width) and
 * records the box of every block it probes (headings, paragraphs, list
 * items, callouts, table cells, code blocks, form rows…). In a correct
 * layout each RTL box sits where the LTR box would be after a reflection
 * about the page's vertical axis: x_rtl = W − (x_ltr + width). A theme rule
 * like `.callout { margin-left: 12px }` moves the box by 12 px in one
 * direction only, and the screen fails, naming the block. Also failing:
 * horizontal overflow (a page wider than the viewport in either direction),
 * and blocking contrast violations found by axe on the rendered screen.
 *
 * Pure: the run (e2e/themes-rtl-screens.spec.ts, or the offline specimen
 * harness) passes the measurements in; the result goes to
 * `rtlThemeCard({ screens })` through `scripts/themes/rtl-check.mjs --screens`.
 */
import { RTL_SCREENS, type RtlCard, type ScreenResult } from "./rtlCheck";

export type RtlScreen = (typeof RTL_SCREENS)[number];

/** A probed block: its key (the same in both directions), and its border box in CSS pixels. */
export interface ProbeBox {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenMeasure {
  /** The viewport (layout) width the screen was rendered at. */
  viewport: number;
  /** document.scrollingElement.scrollWidth − clientWidth, per direction. */
  overflowX: { rtl: number; ltr: number };
  rtl: ProbeBox[];
  ltr: ProbeBox[];
  /** axe violations of impact serious or critical, per direction (ids). */
  axe?: { rtl: string[]; ltr: string[] };
}

export interface MirrorMiss {
  key: string;
  /** Where the RTL box is, and where the mirror of the LTR box says it should be. */
  x: number;
  expected: number;
  dWidth: number;
}

export interface ScreenVerdict {
  rtl: ScreenResult;
  ltr: ScreenResult;
  misses: MirrorMiss[];
  reasons: string[];
}

/** Sub-pixel rounding and scrollbar placement move boxes a little; more than this is layout. */
export const MIRROR_TOLERANCE_PX = 3;

/** The RTL boxes that are not the mirror of their LTR twin. */
export function mirrorMisses(m: Pick<ScreenMeasure, "viewport" | "rtl" | "ltr">, tol = MIRROR_TOLERANCE_PX): MirrorMiss[] {
  const ltr = new Map(m.ltr.map((b) => [b.key, b]));
  const misses: MirrorMiss[] = [];
  for (const r of m.rtl) {
    const l = ltr.get(r.key);
    if (!l) continue;
    const expected = m.viewport - (l.x + l.width);
    const dWidth = r.width - l.width;
    if (Math.abs(r.x - expected) > tol || Math.abs(dWidth) > tol) misses.push({ key: r.key, x: Math.round(r.x), expected: Math.round(expected), dWidth: Math.round(dWidth) });
  }
  return misses;
}

/**
 * The verdict for one screen. A mirror miss fails RTL (the theme's LTR layout
 * is the reference: the app was designed in both, and a physical rule is
 * right in one direction only). Overflow and axe fail the direction they
 * were found in. Nothing probed is "owed", not a pass: a run that found no
 * blocks proved nothing.
 */
export function judgeScreen(m: ScreenMeasure, tol = MIRROR_TOLERANCE_PX, baseline?: ReadonlySet<string>): ScreenVerdict {
  const reasons: string[] = [];
  if (m.rtl.length === 0 || m.ltr.length === 0) return { rtl: "owed", ltr: "owed", misses: [], reasons: ["nothing was probed"] };
  const keys = new Set(m.ltr.map((b) => b.key));
  const paired = m.rtl.filter((b) => keys.has(b.key)).length;
  if (paired < Math.min(m.rtl.length, m.ltr.length)) reasons.push(`only ${paired} of ${m.rtl.length} blocks found in both directions`);
  // A block the app itself leaves unmirrored (measured with no theme) is not the theme's doing.
  const misses = mirrorMisses(m, tol).filter((x) => !baseline?.has(x.key));
  for (const x of misses.slice(0, 5)) reasons.push(`rtl: ${x.key} at x=${x.x}, its mirror is x=${x.expected}${x.dWidth ? ` (width ${x.dWidth > 0 ? "+" : ""}${x.dWidth})` : ""}`);
  let rtl: ScreenResult = misses.length || paired === 0 ? "fail" : "pass";
  let ltr: ScreenResult = "pass";
  if (m.overflowX.rtl > tol) {
    rtl = "fail";
    reasons.push(`rtl: the page scrolls sideways by ${Math.round(m.overflowX.rtl)} px`);
  }
  if (m.overflowX.ltr > tol) {
    ltr = "fail";
    reasons.push(`ltr: the page scrolls sideways by ${Math.round(m.overflowX.ltr)} px`);
  }
  if (m.axe?.rtl.length) {
    rtl = "fail";
    reasons.push(`rtl axe: ${m.axe.rtl.join(", ")}`);
  }
  if (m.axe?.ltr.length) {
    ltr = "fail";
    reasons.push(`ltr axe: ${m.axe.ltr.join(", ")}`);
  }
  return { rtl, ltr, misses, reasons };
}

/** Every screen's verdict, in the shape `rtlThemeCard({ screens })` takes. Screens the run did not reach stay owed. */
export function screensForCard(
  measures: Partial<Record<RtlScreen, ScreenMeasure>>,
  baseline: Partial<Record<RtlScreen, ScreenMeasure>> = {},
): RtlCard["screens"] {
  const out: RtlCard["screens"] = {};
  for (const s of RTL_SCREENS) {
    const m = measures[s];
    if (!m) continue;
    const b = baseline[s];
    const v = judgeScreen(m, MIRROR_TOLERANCE_PX, b ? new Set(mirrorMisses(b).map((x) => x.key)) : undefined);
    out[s] = { rtl: v.rtl, ltr: v.ltr };
  }
  return out;
}
