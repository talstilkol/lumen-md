export interface HistoryRow { at: string; commit: string; file: string; test: string; key: string | null; ok: boolean; alone: boolean }
export interface QuarantineEntry { test: string; file: string; reason: string; owner?: string; evidence: string; since: string; expires: string }
export interface Quarantine { schema: number; note?: string; entries: QuarantineEntry[] }
export const QUARANTINE_FILE: string;
export const HISTORY_FILE: string;
export const MAX_QUARANTINE_DAYS: number;
export function classify(rows: readonly HistoryRow[], opts?: { commit?: string }): { verdict: "real" | "flaky" | "isolation" | "unknown"; why: string; commit?: string };
export function readHistory(file?: string): HistoryRow[];
export function appendHistory(rows: readonly HistoryRow[], file?: string): void;
export function rowsFromLog(log: string, o: { file: string; commit: string; alone: boolean; at?: string; code: number }): HistoryRow[];
export function rerunAlone(file: string, o?: { times?: number; commit?: string; runner?: string; exec?: (cmd: string) => { code: number; text: string } }): HistoryRow[];
export function loadQuarantine(file?: string): Quarantine;
export function entryProblems(e: Partial<QuarantineEntry>): string[];
export function checkQuarantine(q: Quarantine, now?: number): { active: QuarantineEntry[]; expired: QuarantineEntry[]; invalid: Array<QuarantineEntry & { problems: string[] }> };
export function quarantine(q: Quarantine, o: { test: string; file: string; reason: string; owner?: string; history: readonly HistoryRow[]; now?: number; days?: number }): Quarantine;
export function reportFailure(q: Quarantine, f: { test: string; file: string }, now?: number): { status: "red" | "quarantined"; note?: string };
