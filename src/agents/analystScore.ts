/**
 * The data-analysis set's scoring rule (plan 6.15, 7.10), on its own so the
 * golden harness and the browser bench's scorer (scripts/bench/tasks.mjs,
 * bundled for Node) load it without the analyst and its strings.
 */
/** Numeric / exact scoring against a golden answer (the data-analysis set's rule). */
export function matchesGolden(got: number | string, want: number | string, tolerance?: number): boolean {
  if (typeof want === "number") {
    const n = typeof got === "number" ? got : Number(String(got).replace(/[,%\s]/g, ""));
    if (!Number.isFinite(n)) return false;
    return tolerance !== undefined ? Math.abs(n - want) <= tolerance + 1e-9 : n === want;
  }
  return String(got).trim() === want;
}
