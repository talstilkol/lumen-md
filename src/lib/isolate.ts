/**
 * Bidi isolation for a user's string inside interface text (plan W13.H4).
 *
 * In markup, a note name, a path, a tag or a heading goes in <bdi> (or an
 * element with dir="auto"), so "פתק (2).md" keeps its brackets and
 * "README.md" stays readable inside a Hebrew interface. Where there is no
 * markup — the window title, a native tooltip, an aria-label — the string is
 * wrapped in FIRST STRONG ISOLATE … POP DIRECTIONAL ISOLATE (U+2068 … U+2069),
 * the plain-text form of the same thing (UAX #9, W3C "Inline markup and bidi").
 */

export const FSI = "⁨";
export const PDI = "⁩";

/** `s` as an isolate: laid out in its own direction, without disturbing the text around it. */
export function isolate(s: string): string {
  if (!s) return s;
  // Already isolated (or a caller isolated part of it): do not nest a second pair.
  if (s.startsWith(FSI) && s.endsWith(PDI)) return s;
  return FSI + s + PDI;
}

/** The window title for a note: the note's name isolated, then the app. */
export function windowTitle(noteName: string | null | undefined, app = "Lumen"): string {
  const name = (noteName ?? "").trim();
  return name ? `${isolate(name)} — ${app}` : app;
}
