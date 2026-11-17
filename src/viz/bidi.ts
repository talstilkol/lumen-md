/**
 * Direction helpers for charts (plan W12.V1). A chart label is drawn on a
 * canvas, outside the page's bidi context: "ירושלים (2024)" or "Tel Aviv 3"
 * next to Hebrew comes out scrambled unless the label is its own isolate.
 * FSI … PDI (UAX #9, U+2068 / U+2069) takes the label's direction from its
 * first strong character, the same as `dir="auto"` on an element.
 */

export const FSI = "⁨";
export const PDI = "⁩";

/** The label wrapped in FSI … PDI; an empty label stays empty, and a label already isolated is left alone. */
export function isolate(label: string): string {
  if (!label) return label;
  if (label.startsWith(FSI) && label.endsWith(PDI)) return label;
  return FSI + label + PDI;
}

/** The label without the isolate around it (for the data table, where `dir="auto"` does the job). */
export function unisolate(label: string): string {
  return label.startsWith(FSI) && label.endsWith(PDI) ? label.slice(1, -1) : label;
}

export type Dir = "rtl" | "ltr";

/** The direction of a document or element: its `dir`, else the page's. */
export function dirOf(el?: Element | null): Dir {
  const node = el?.closest?.("[dir]") ?? (typeof document !== "undefined" ? document.documentElement : null);
  const d = node?.getAttribute("dir");
  if (d === "rtl" || d === "ltr") return d;
  if (typeof getComputedStyle === "function" && node) return getComputedStyle(node).direction === "rtl" ? "rtl" : "ltr";
  return "ltr";
}
