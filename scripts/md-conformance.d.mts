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
  kind: "parser" | "round-trip" | "app" | "gfm-parser" | "gfm-round-trip";
  what: string;
  spec: string;
  total: number;
  passed: number;
  rate: number;
  target: number;
  exceptions: Array<{ example: number; section: string; reason: string }>;
  /** GFM rows only: the examples left out, by why (GFM_LEFT_OUT). */
  leftOut?: { disabled: number[]; superseded: number[] };
}
export const GFM_SPEC: string;
export const GFM_SOURCE: string;
export const GFM_LEFT_OUT: { disabled: string; superseded: string };
export const GFM_PARSER_EXCEPTIONS: Record<number, string>;
export const GFM_ROUND_TRIP_EXCEPTIONS: Record<number, string>;
/** A GFM spec example, with its extension name ("" for core, table, strikethrough, autolink, tagfilter, disabled). */
export interface GfmExample extends Example {
  extension: string;
}
export function parseGfmSpecText(text: string): GfmExample[];
export interface Gfm {
  html: (md: string) => string;
  roundTrip: (md: string) => string;
  versions: Record<string, string>;
}
export function loadGfm(root: string, p: { micromark: (md: string, o?: object) => string }): Promise<Gfm | null>;
export function scoreGfm(gfmExamples: GfmExample[], cmExamples: Example[], g: Gfm): Row[];
export function parseSpecText(text: string): Example[];
export function loadParsers(root?: string): Promise<{ micromark: (md: string, o?: object) => string; fromMarkdown: (md: string) => unknown; toMarkdown: (tree: unknown) => string; versions: Record<string, string> }>;
export function score(examples: Example[], p: { micromark: (md: string, o?: object) => string; fromMarkdown: (md: string) => unknown; toMarkdown: (tree: never) => string; versions: Record<string, string> }): Row[];
export function appRows(report: unknown[], examples: Example[]): Row[];
export const SPEC_SOURCE: string;
export function rowScores(row: Row): number[];
export function mdCards(rows: Row[], versions: Record<string, string>): { card: Record<string, any>; cards: Record<"parser" | "round-trip", Record<string, any>> & Partial<Record<"gfm-parser" | "gfm-round-trip", Record<string, any>>> };
