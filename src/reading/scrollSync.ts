/**
 * Scroll sync in "line space" (plan W13.R7).
 *
 * Every pane that shows a note can say which source line is at its top and
 * scroll a line to its top: the source editor from CodeMirror's line
 * geometry, the preview from the lines its blocks carry (`data-sl` /
 * `data-sle`, ../renderer/rehypeSourceLines.ts), a second note's preview
 * the same way. Two panes are linked by moving the passive one to the
 * active one's line (./scrollLink.ts), so any pair links — source and
 * preview, preview and preview, two notes side by side.
 *
 * This file is the pure part: an anchor map from (line, y) breakpoints and
 * the piecewise-linear maps between lines and pixels. No DOM.
 */

/** A breakpoint: source line `line` (fractional, 1-based) starts at `y` px in the pane's content. */
export interface LinePoint {
  line: number;
  y: number;
}

/** A block on screen: its first and last source line and its box in the pane's content. */
export interface LineBox {
  start: number;
  end: number;
  top: number;
  bottom: number;
}

/**
 * The anchor map of a pane: every block gives two breakpoints, its first
 * line at its top and the line after its last at its bottom. Sorted by
 * line; a point that would make y go backwards (a nested block laid out
 * beside its parent, a float, a side note) is dropped, so both maps stay
 * monotonic. `lines` and `height` close the map at the end of the content.
 */
export function anchorMap(boxes: readonly LineBox[], end?: { lines: number; height: number }): LinePoint[] {
  const raw: LinePoint[] = [{ line: 1, y: 0 }];
  for (const b of boxes) {
    if (!(b.start >= 1) || !(b.bottom >= b.top)) continue;
    raw.push({ line: b.start, y: b.top });
    raw.push({ line: Math.max(b.start, b.end) + 1, y: b.bottom });
  }
  raw.sort((a, b) => a.line - b.line || a.y - b.y);
  const out: LinePoint[] = [];
  for (const p of raw) {
    const last = out[out.length - 1];
    if (!last) {
      out.push(p);
      continue;
    }
    if (p.y < last.y) continue;
    if (p.line === last.line) {
      // Same line: a container and its first child start together; the first (highest on screen) stays.
      continue;
    }
    out.push(p);
  }
  if (end && end.lines >= 1) {
    const last = out[out.length - 1];
    const line = end.lines + 1;
    if (line > last.line && end.height >= last.y) out.push({ line, y: end.height });
  }
  return out;
}

/** Index of the last point with `key(p) <= v` (−1 when v is before the first). */
function floorIndex(points: readonly LinePoint[], v: number, key: (p: LinePoint) => number): number {
  let lo = 0;
  let hi = points.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(points[mid]) <= v) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** The pixel where (fractional) `line` starts. */
export function lineToY(points: readonly LinePoint[], line: number): number {
  if (!points.length) return 0;
  const i = floorIndex(points, line, (p) => p.line);
  if (i < 0) return points[0].y;
  const a = points[i];
  const b = points[i + 1];
  if (!b) return a.y;
  return a.y + ((line - a.line) / (b.line - a.line)) * (b.y - a.y);
}

/** The (fractional) line at pixel `y`. A run of points at one y (blank lines, hidden blocks) maps to its last line. */
export function yToLine(points: readonly LinePoint[], y: number): number {
  if (!points.length) return 1;
  const i = floorIndex(points, y, (p) => p.y);
  if (i < 0) return points[0].line;
  const a = points[i];
  const b = points[i + 1];
  if (!b || b.y === a.y) return a.line;
  return a.line + ((y - a.y) / (b.y - a.y)) * (b.line - a.line);
}

/**
 * The block for the caret's line (selection follow): of the boxes that
 * hold `line`, the innermost (the latest start, then the shortest).
 */
export function boxAtLine<T extends LineBox>(boxes: readonly T[], line: number): T | null {
  let best: T | null = null;
  for (const b of boxes) {
    if (b.start > line || Math.max(b.start, b.end) < line) continue;
    if (!best || b.start > best.start || (b.start === best.start && b.end < best.end)) best = b;
  }
  return best;
}

/** Heading lines of a Markdown text (outside fences), the fallback anchors of a preview without line stamps. */
export function headingLines(text: string): { line: number; title: string }[] {
  const out: { line: number; title: string }[] = [];
  let fence: string | null = null;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(ln);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const m = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(ln);
    if (m) out.push({ line: i + 1, title: m[2] });
  }
  return out;
}

/**
 * Columns in visual order for keyboard moves (Ctrl+Alt+Shift+←/→): the DOM
 * order, mirrored in a right-to-left layout, where the first column is on
 * the right. `delta` is +1 for the column to the right, −1 to the left.
 */
export function nextColumn(count: number, current: number, key: "ArrowLeft" | "ArrowRight", dir: "rtl" | "ltr"): number {
  if (count <= 0) return -1;
  const right = key === "ArrowRight";
  const forward = dir === "rtl" ? !right : right;
  const n = current + (forward ? 1 : -1);
  return Math.min(count - 1, Math.max(0, n));
}
