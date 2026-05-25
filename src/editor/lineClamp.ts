/**
 * Clamp a 1-indexed line number to the valid range for a CodeMirror
 * `Text` of length `totalLines`. Returns 0 if the doc has no lines.
 *
 * Round-25 found that the split-view sync code held onto anchor.line
 * values from a previous (longer) doc state, then called
 * `doc.line(n)` with n > doc.lines once the doc shrank — which
 * throws `"Invalid line number N in M-line document"` and surfaces
 * as a pageerror. Clamping is the safest pragmatic fix: the slight
 * visual offset for one frame self-corrects when the MutationObserver
 * rebuilds anchors.
 */
export function clampLineNumber(line: number, totalLines: number): number {
  if (totalLines <= 0) return 0;
  if (Number.isNaN(line)) return 1;
  if (line === Number.POSITIVE_INFINITY || line > totalLines) return totalLines;
  if (line === Number.NEGATIVE_INFINITY || line < 1) return 1;
  return Math.floor(line);
}
