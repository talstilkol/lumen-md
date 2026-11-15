// Types for the run-filter copied from talstilkol/tasker (owner's code).
export const ERR_RE: RegExp;
export const DEFAULT_CHARS_PER_TOKEN: number;
export function estimateTokens(text: string, ratio?: number): number;
export function dedupe(lines: string[]): string[];
export function detectFamily(cmd: string, args?: string[], text?: string): string;
export function filterOutput(o: { cmd: string; args?: string[]; text: string; code?: number; cwd?: string | null; force?: boolean }): { family: string; summary: string; text: string; counts: Record<string, number>; passthrough: boolean };
export function lostErrorLines(raw: string, filtered: string, o?: { cwd?: string | null; family?: string | null }): string[];
export function isInteractive(cmd: string, args?: string[]): boolean;
export function saveFull(dataDir: string, r: { cmd: string; args: string[]; text: string; code: number }, now?: number): string;
export function readFull(dataDir: string, id: string, o?: { grep?: string | null; context?: number }): string;
export function pruneOld(dataDir: string, o?: { days?: number; now?: number }): number;
export function execCapture(cmd: string, args: string[], o?: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv }): Promise<{ code: number; text: string }>;
export function runFiltered(cmd: string, args: string[], o?: { cwd?: string; dataDir: string; store?: unknown; now?: number; exec?: typeof execCapture }): Promise<{ code: number; output: string; id: string | null; family: string; rawTokens: number; outTokens: number; addedTokens: number }>;
