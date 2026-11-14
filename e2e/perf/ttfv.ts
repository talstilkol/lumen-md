/**
 * Plan W11.P5: the budgets and the verdict for e2e/ttfv.spec.ts, kept apart
 * from Playwright so src/__tests__/ttfvPerf.test.ts can check them in Node.
 *
 *   - TTFV-1: navigation → the editor is up and takes input (the moment the
 *     app records as `editor.ready`, src/metrics/activation.ts). p75 ≤ 2 s.
 *   - First note: navigation on a fresh profile → the first note of the
 *     user's own is saved (`note.firstOwnSave`), with the first-run steps
 *     done as fast as a robot can. p75 ≤ 4 s.
 *
 * 10 runs per browser (Chromium, Firefox, WebKit), on a production build,
 * with every request outside the app's own origin refused (no network).
 */

import { quantile } from "./probes";

export const TTFV_RUNS = 10;
export const TTFV1_P75_BUDGET_MS = 2000;
export const FIRST_NOTE_P75_BUDGET_MS = 4000;

export interface TtfvVerdict {
  runs: number;
  p75: number;
  max: number;
  budget: number;
  pass: boolean;
}

/** p75 of the runs against the budget. Fewer than TTFV_RUNS runs never pass. */
export function ttfvVerdict(values: readonly number[], budget: number): TtfvVerdict {
  const clean = values.filter((v) => Number.isFinite(v) && v >= 0);
  const p75 = quantile(clean, 0.75);
  const max = clean.length ? Math.max(...clean) : 0;
  return { runs: clean.length, p75, max, budget, pass: clean.length >= TTFV_RUNS && p75 <= budget };
}

/** True for a request that would leave the app's origin (refused in the spec). */
export function isExternalRequest(url: string, baseURL: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return true;
  }
  if (u.protocol === "data:" || u.protocol === "blob:") return false;
  return u.origin !== new URL(baseURL).origin;
}
