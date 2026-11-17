/**
 * Calibrated approval thresholds and honest rates for agent evals (R12.15).
 *
 * 1. **Split-conformal, per kind of proposal (Mondrian).** A proposal kind
 *    (a tag, a link, a merge…) may be approved without review only when its
 *    score is above a threshold computed from the gold set's *negatives* of
 *    that kind: the proposals a person rejected. With n negatives and a
 *    declared α, the threshold is the ⌈(n + 1)(1 − α)⌉-th smallest negative
 *    score. For a new negative exchangeable with the calibration ones,
 *    P(score > threshold) ≤ α: at most an α share of bad proposals slips
 *    through (Vovk et al.; Angelopoulos and Bates, "A Gentle Introduction to
 *    Conformal Prediction", 2021). With too few negatives for that α
 *    (⌈(n + 1)(1 − α)⌉ > n) there is no threshold, and everything of that
 *    kind goes to review. The threshold moves when the gold moves.
 *
 * 2. **Wilson 95% intervals.** Every success rate is reported with its range,
 *    and an "improvement" or a "saving" only as a range of the difference,
 *    never as one number from one run. `compareRates` decides only with at
 *    least `minRuns` runs on each side.
 *
 * The Wilson function and the compare rule are from talstilkol/tasker
 * (owner's code), src/autopilot/evals.js (TK-G7) @ a696fd2, ported to
 * TypeScript. The conformal part is a clean reimplementation from the
 * literature; israelconnect's tools/agents/reviewer/conformal.py (AGPL) was a
 * design reference only.
 */

export interface Interval {
  /** Point estimate k/n, or null when n is 0. */
  p: number | null;
  lo: number | null;
  hi: number | null;
  n: number;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

function wilsonRaw(k: number, n: number, z: number): [number, number, number] {
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [p, Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

/** Wilson score interval (95% by default): the honest range of k successes out of n, to 3 decimals. */
export function wilson(k: number, n: number, z = 1.96): Interval {
  if (!n) return { p: null, lo: null, hi: null, n };
  const [p, lo, hi] = wilsonRaw(k, n, z);
  return { p: r3(p), lo: r3(lo), hi: r3(hi), n };
}

/** "0.50 (95% 0.09–0.91, n=2)" for k of n, rounded once from the exact interval. */
export function rateText(k: number, n: number, z = 1.96): string {
  if (!n) return "— (n=0)";
  const [p, lo, hi] = wilsonRaw(k, n, z);
  return `${p.toFixed(2)} (95% ${lo.toFixed(2)}–${hi.toFixed(2)}, n=${n})`;
}

/** "0.80 (95% 0.49–0.94, n=10)": a rate never travels without its range. */
export function formatRate(i: Interval): string {
  if (i.p === null) return "— (n=0)";
  return `${i.p.toFixed(2)} (95% ${i.lo!.toFixed(2)}–${i.hi!.toFixed(2)}, n=${i.n})`;
}

/* ─── Split-conformal thresholds ─────────────────────────────────────── */

/**
 * The conformal threshold over negative scores at level α, or null when
 * there are too few negatives to promise α.
 */
export function conformalThreshold(negativeScores: readonly number[], alpha: number): number | null {
  if (!(alpha > 0 && alpha < 1)) throw new Error("alpha must be in (0, 1)");
  const s = negativeScores.filter(Number.isFinite).sort((a, b) => a - b);
  const k = Math.ceil((s.length + 1) * (1 - alpha));
  return k > s.length ? null : s[k - 1];
}

export interface GoldItem {
  /** The kind of proposal (Mondrian class): "tag", "link", "merge"… */
  kind: string;
  /** The proposer's confidence, higher = surer. */
  score: number;
  /** What a person decided: true = approve, false = reject (a negative). */
  approved: boolean;
}

export interface KindThreshold {
  kind: string;
  alpha: number;
  /** Negatives the threshold was computed from. */
  negatives: number;
  positives: number;
  /** Approve without review only above this; null = always review. */
  threshold: number | null;
  /** Share of this kind's gold positives that would pass on their own: what the threshold costs, with its range. */
  autoRate: Interval;
}

/** One threshold per kind (Mondrian split-conformal) from a gold set. */
export function mondrianThresholds(gold: readonly GoldItem[], alpha: number): KindThreshold[] {
  const kinds = [...new Set(gold.map((g) => g.kind))].sort();
  return kinds.map((kind) => {
    const mine = gold.filter((g) => g.kind === kind);
    const neg = mine.filter((g) => !g.approved).map((g) => g.score);
    const pos = mine.filter((g) => g.approved);
    const threshold = conformalThreshold(neg, alpha);
    const passing = threshold === null ? 0 : pos.filter((g) => g.score > threshold).length;
    return { kind, alpha, negatives: neg.length, positives: pos.length, threshold, autoRate: wilson(passing, pos.length) };
  });
}

/** Approve on its own, or send to review? A kind with no threshold always goes to review. */
export function decide(kind: string, score: number, thresholds: readonly KindThreshold[]): "auto" | "review" {
  const t = thresholds.find((x) => x.kind === kind);
  return t && t.threshold !== null && score > t.threshold ? "auto" : "review";
}

/* ─── Comparing two configurations ───────────────────────────────────── */

export interface Comparison {
  a: Interval;
  b: Interval;
  /** The difference a − b as a range only: [a.lo − b.hi, a.hi − b.lo]. Conservative; never a single number. */
  diff: [number, number] | null;
  decision: "enforce" | "advise" | "insufficient";
  note: string;
}

/**
 * tasker's compare rule: with ≥ `minRuns` runs on each side, `a` is adopted
 * ("enforce") when its success rate is no more than `tolerancePp` points
 * below `b`'s; otherwise "advise". Fewer runs: "insufficient".
 */
export function compareRates(a: { ok: number; n: number }, b: { ok: number; n: number }, { minRuns = 20, tolerancePp = 2 } = {}): Comparison {
  const A = wilson(a.ok, a.n);
  const B = wilson(b.ok, b.n);
  const enough = A.n >= minRuns && B.n >= minRuns;
  const decision = !enough ? "insufficient" : A.p! >= B.p! - tolerancePp / 100 ? "enforce" : "advise";
  const diff: [number, number] | null = A.p === null || B.p === null ? null : [r3(A.lo! - B.hi!), r3(A.hi! - B.lo!)];
  const note = enough ? `a ${formatRate(A)} vs b ${formatRate(B)}; a − b in ${diff![0]}–${diff![1]}` : `needs ≥ ${minRuns} runs on each side (has ${A.n}/${B.n})`;
  return { a: A, b: B, diff, decision, note };
}
