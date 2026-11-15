// Types for scripts/md-conformance.mjs (W11.Q8), for the tests.
export const SPEC: string;
export const OUT: string;
export const TARGET: number;
export const ROUND_TRIP_EXCEPTIONS: Record<number, string>;
export interface Example {
  example: number;
  section: string;
  markdown: string;
  html: string;
}
export interface Row {
  kind: "parser" | "round-trip" | "app";
  what: string;
  spec: string;
  total: number;
  passed: number;
  rate: number;
  target: number;
  exceptions: Array<{ example: number; section: string; reason: string }>;
}
export function parseSpecText(text: string): Example[];
export function loadParsers(root?: string): Promise<{ micromark: (md: string, o?: object) => string; fromMarkdown: (md: string) => unknown; toMarkdown: (tree: unknown) => string; versions: Record<string, string> }>;
export function score(examples: Example[], p: { micromark: (md: string, o?: object) => string; fromMarkdown: (md: string) => unknown; toMarkdown: (tree: never) => string; versions: Record<string, string> }): Row[];
export function appRows(report: unknown[], examples: Example[]): Row[];
