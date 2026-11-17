/**
 * Side notes (plan W13.R9): where each note sits in the margin.
 *
 * A note wants to sit level with its anchor (the footnote mark, the
 * commented words, the suggestion). When two would overlap, the later one
 * is pushed down; when a run of pushed notes would run past a hard floor
 * (the end of the text, or the next note pinned there), the run is pulled
 * back up as one block, as far as the note above it allows. The result:
 * no note covers another, every note is as close to its anchor as that
 * allows, and the order of the notes is the order of their anchors.
 *
 * Pure: no DOM. The margin itself is ./Sidenotes.tsx.
 */

export interface NoteBox {
  /** Where the anchor is (px from the top of the text). */
  anchor: number;
  /** The note's height (px). */
  height: number;
}

/**
 * The top of each note (same order as `notes`, which must be sorted by
 * anchor), at least `gap` px apart, none above `min`, and — if possible —
 * none ending below `max`.
 */
export function layoutSidenotes(notes: readonly NoteBox[], gap = 8, min = 0, max = Infinity): number[] {
  const n = notes.length;
  const tops = new Array<number>(n);
  // Pass 1: push down.
  let floor = min;
  for (let i = 0; i < n; i++) {
    tops[i] = Math.max(notes[i].anchor, floor);
    floor = tops[i] + notes[i].height + gap;
  }
  // Pass 2: past the end, pull the tail back up, never above its anchor's lowest legal place.
  if (Number.isFinite(max) && n) {
    let ceiling = max;
    for (let i = n - 1; i >= 0; i--) {
      const bottom = tops[i] + notes[i].height;
      if (bottom <= ceiling) break;
      tops[i] = Math.max(min, ceiling - notes[i].height);
      ceiling = tops[i] - gap;
    }
    // Pulling up may have made the head overlap: push down again (overflow beyond max is then unavoidable).
    floor = min;
    for (let i = 0; i < n; i++) {
      tops[i] = Math.max(tops[i], floor);
      floor = tops[i] + notes[i].height + gap;
    }
  }
  return tops;
}

/** Do any two laid-out notes overlap (closer than `gap`)? The acceptance check. */
export function overlaps(tops: readonly number[], heights: readonly number[], gap = 0): number {
  let count = 0;
  const order = tops.map((t, i) => i).sort((a, b) => tops[a] - tops[b]);
  for (let k = 1; k < order.length; k++) {
    const a = order[k - 1];
    const b = order[k];
    if (tops[a] + heights[a] + gap > tops[b] + 1e-6) count++;
  }
  return count;
}

/** How far each note ended up from its anchor (px; ≥ 0 when pushed down). */
export function drift(notes: readonly NoteBox[], tops: readonly number[]): number[] {
  return notes.map((n, i) => tops[i] - n.anchor);
}

export type SidenoteKind = "footnote" | "comment" | "insert" | "delete" | "replace" | "highlight";

/** Which side of the text the margin is on: the inline end (right in LTR, left in RTL). */
export function marginSide(dir: "rtl" | "ltr"): "left" | "right" {
  return dir === "rtl" ? "left" : "right";
}

/** Below this width the notes go under their paragraph instead of the margin. */
export const NARROW_PX = 700;
