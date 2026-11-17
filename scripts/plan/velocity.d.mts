export interface PlanCounts { done: number; partial: number; total: number; countable: number; doneMinutes: number; totalMinutes: number }
export interface Point extends PlanCounts { sha: string; t: number }
export interface Velocity { perDay7: number | null; perDay30: number | null; trend: "up" | "down" | "flat" | "none"; etaDays: number | null; etaDate: string | null; etaRange: [number, number] | null; lastProgressAt: number | null; confidence: "none" | "low" | "mid"; points: number; spanDays: number }
export interface PlanVelocity { points: number; now: number | null; newest: string | null; current: PlanCounts; tasks: Velocity; minutes: Velocity }
export function countPlan(plan: unknown): PlanCounts;
export function historyFromGit(root: string, o?: { path?: string; days?: number; git?: (args: string[]) => string }): Point[];
export function buildHistory(points: readonly Point[], now: number): Array<Point & { invalid: boolean }>;
export function computeVelocity(history: ReadonlyArray<Point & { invalid?: boolean }>, counters: PlanCounts | null, now: number, key?: "done" | "doneMinutes"): Velocity;
export function planVelocity(points: readonly Point[], current: PlanCounts): PlanVelocity;
export function velocityLine(v: PlanVelocity): string;
export const VELOCITY_START: string;
export const VELOCITY_END: string;
export function withoutVelocity(html: string): string;
