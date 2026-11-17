/**
 * Plan W13.H1 — the expectation table for the 40 W11.H3 caret scenarios
 * (10 lines × Home, End, a 3-press round trip from the middle, a word move)
 * in both cursor-movement modes of the source editor.
 *
 * What each column means, per mode:
 *   home / end  the offset Home / End reach in one press (the same in both
 *               modes: the start / end of the visual line in text order, so
 *               Shift+End selects the whole line), and whether the caret is
 *               drawn at the paragraph's visual edge. `edge: false` where the
 *               line starts (ends) with a run of the other direction: UAX #9
 *               draws offset 0 (the end) at that run's inner boundary — the
 *               edge itself is a different offset, and going there would make
 *               Shift+End select part of the line.
 *   trip        the offset after each of 6 presses from the middle: 3 of the
 *               arrow that points toward the line's end (Left in RTL), then 3
 *               of the other.
 *                 logical: +1, +1, +1, −1, −1, −1 in text order, always;
 *                 visual:  the drawn caret moves toward the key's side on every
 *                          press (or stays at that edge of the line), so inside
 *                          a run of the other direction the offset goes down.
 *   word        Ctrl/⌥ + the arrow toward the end from offset 0, then the
 *               other one: [offset after the first, offset after the second].
 *                 logical: the end of the first word in text order, then 0;
 *                 visual:  a word toward the key's side on screen, then a word
 *                          back (in "2026 שנה…" that is not 0: offset 0 sits at
 *                          the inner edge of the number, see `home`).
 *
 * Checked by src/__tests__/cursorMovementMode.test.ts (the logical column
 * against the text-order oracle, the table's shape) and in the browser by
 * e2e/rtl-caret.spec.ts. Line 6 is LTR: a bare URL is Latin under the golden
 * set's direction rule (W11.H2), so the URL line reads left to right.
 */

export type CursorMode = "visual" | "logical";

export interface CaretExpect {
  home: { head: number; edge: boolean };
  end: { head: number; edge: boolean };
  /** The offset before the first press and after each of the 6. */
  trip: number[];
  word: [forward: number, back: number];
}

export interface CaretScenario {
  text: string;
  dir: "rtl" | "ltr";
  logical: CaretExpect;
  visual: CaretExpect;
}

export const CARET_SCENARIOS: CaretScenario[] = [
  {
    text: "iPhone חדש הגיע היום",
    dir: "ltr",
    logical: { home: { head: 0, edge: true }, end: { head: 20, edge: false }, trip: [10, 11, 12, 13, 12, 11, 10], word: [6, 0] },
    visual: { home: { head: 0, edge: true }, end: { head: 20, edge: false }, trip: [10, 9, 8, 7, 8, 9, 10], word: [6, 0] },
  },
  {
    text: "שלום לכולם 2026",
    dir: "rtl",
    logical: { home: { head: 0, edge: true }, end: { head: 15, edge: false }, trip: [7, 8, 9, 10, 9, 8, 7], word: [4, 0] },
    visual: { home: { head: 0, edge: true }, end: { head: 15, edge: false }, trip: [7, 8, 9, 10, 9, 8, 7], word: [4, 0] },
  },
  {
    text: "2026 שנה טובה לכולם",
    dir: "rtl",
    logical: { home: { head: 0, edge: false }, end: { head: 19, edge: true }, trip: [9, 10, 11, 12, 11, 10, 9], word: [4, 0] },
    visual: { home: { head: 0, edge: false }, end: { head: 19, edge: true }, trip: [9, 10, 11, 12, 11, 10, 9], word: [8, 5] },
  },
  {
    text: "ראה `npm run dev`",
    dir: "rtl",
    logical: { home: { head: 0, edge: true }, end: { head: 17, edge: true }, trip: [8, 9, 10, 11, 10, 9, 8], word: [3, 0] },
    visual: { home: { head: 0, edge: true }, end: { head: 17, edge: true }, trip: [8, 7, 6, 16, 6, 7, 8], word: [3, 0] },
  },
  {
    text: "`git status` לפני הכול",
    dir: "rtl",
    logical: { home: { head: 0, edge: true }, end: { head: 22, edge: true }, trip: [11, 12, 13, 14, 13, 12, 11], word: [1, 0] },
    visual: { home: { head: 0, edge: true }, end: { head: 22, edge: true }, trip: [11, 12, 13, 14, 13, 12, 11], word: [1, 0] },
  },
  {
    text: "https://lumen-md.vercel.app היא הכתובת",
    dir: "ltr",
    logical: { home: { head: 0, edge: true }, end: { head: 38, edge: false }, trip: [19, 20, 21, 22, 21, 20, 19], word: [5, 0] },
    visual: { home: { head: 0, edge: true }, end: { head: 38, edge: false }, trip: [19, 20, 21, 22, 21, 20, 19], word: [5, 0] },
  },
  {
    text: "ראו [[מתכון עוגה]] היום",
    dir: "rtl",
    logical: { home: { head: 0, edge: true }, end: { head: 23, edge: true }, trip: [11, 12, 13, 14, 13, 12, 11], word: [3, 0] },
    visual: { home: { head: 0, edge: true }, end: { head: 23, edge: true }, trip: [11, 12, 13, 14, 13, 12, 11], word: [3, 0] },
  },
  {
    text: "הערה[^1] בסוף השורה",
    dir: "rtl",
    logical: { home: { head: 0, edge: true }, end: { head: 19, edge: true }, trip: [9, 10, 11, 12, 11, 10, 9], word: [4, 0] },
    visual: { home: { head: 0, edge: true }, end: { head: 19, edge: true }, trip: [9, 10, 11, 12, 11, 10, 9], word: [4, 0] },
  },
  {
    text: "Hello עולם יפה",
    dir: "ltr",
    logical: { home: { head: 0, edge: true }, end: { head: 14, edge: false }, trip: [7, 8, 9, 10, 9, 8, 7], word: [5, 0] },
    visual: { home: { head: 0, edge: true }, end: { head: 14, edge: false }, trip: [7, 6, 6, 6, 7, 8, 9], word: [5, 0] },
  },
  {
    text: "תגית בסוף #todo",
    dir: "rtl",
    logical: { home: { head: 0, edge: true }, end: { head: 15, edge: false }, trip: [7, 8, 9, 10, 9, 8, 7], word: [4, 0] },
    visual: { home: { head: 0, edge: true }, end: { head: 15, edge: false }, trip: [7, 8, 9, 10, 9, 8, 7], word: [4, 0] },
  },
];
