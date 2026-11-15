export interface Signature { key: string; test: string; head: string; frame: string; kind: string }
export interface FailureBlock { test: string; lines: string[]; kind: string }
export function maskLine(line: string): string;
export function failureBlocks(log: string): FailureBlock[];
export function signatures(log: string): Signature[];
export function drain(lines: readonly string[], opts?: { depth?: number; sim?: number; maxChildren?: number }): Array<{ id: number; template: string; size: number }>;
export function report(logs: Array<{ name: string; text: string }>): { failures: number; keys: number; clusters: Array<{ id: number; template: string; size: number }>; signatures: Array<Signature & { log: string }> };
