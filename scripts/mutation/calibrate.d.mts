// Types for scripts/mutation/calibrate.mjs (W11.Q9), for the tests.
export const TOLERANCE: number;
export const OUT: string;
export interface StrykerScore {
  score: number | null;
  mutants: number;
  detected: number;
  undetected: number;
  invalid: number;
}
export interface OurScore {
  score: number;
  sampled: number;
  mutants: number;
  runner: string | null;
  from?: "receipt" | "report";
}
export interface Verdict {
  ours: number | null;
  stryker: number | null;
  diff: number | null;
  verdict: "verified" | "unverified" | "not measured";
  note?: string;
  oursRunner?: string | null;
  oursSampled?: string;
  strykerMutants?: number;
}
export function strykerScores(report: unknown): Record<string, StrykerScore>;
export function ourScores(reports: unknown[], receipt: unknown): Record<string, OurScore>;
export function calibrate(modules: string[], ours: Record<string, Omit<OurScore, "from">>, stryker: Record<string, Pick<StrykerScore, "score" | "mutants">>, tolerance?: number): Record<string, Verdict>;
