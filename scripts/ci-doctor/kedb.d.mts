import type { Signature } from "./failSig.mjs";
export interface Outcome { at?: string; ok: boolean }
export interface KedbEntry { id: string; key?: string; match?: string; class: "env" | "code" | "flaky"; cause?: string; workaround?: string; runbook?: string; outcomes?: Outcome[] }
export interface Kedb { schema: number; entries: KedbEntry[] }
export const KEDB_FILE: string;
export const LEVELS: readonly ["suggest", "ask", "auto"];
export function wilson(ok: number, n: number, z?: number): [number, number];
export function autonomy(outcomes?: readonly Outcome[]): "suggest" | "ask" | "auto";
export function loadKedb(file?: string): Kedb;
export function lookup(db: Kedb, sig: Pick<Signature, "key" | "head">): KedbEntry | null;
export function diagnose(log: string, db: Kedb): Array<Signature & { known: { id: string; class: string; cause?: string; workaround?: string; runbook: string | null; autonomy: string } | null }>;
export function recordOutcome(db: Kedb, id: string, ok: boolean, at?: string): Kedb;
