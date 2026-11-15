// Types for scripts/perf/corpus-vault.mjs (W11.Q1), for the tests and the harness.
export const GENERATOR_VERSION: number;
export const SOURCES_FILE: string;

export interface Page {
  title: string;
  ns: number;
  redirect: boolean;
  text: string;
}
export interface Infobox {
  template: string;
  fields: Array<[string, string]>;
}
export interface Work {
  id: string;
  path: string;
  title: string;
  authors: string;
  genre: string;
  file: string;
  bytes: number;
}
export interface HugeNote {
  title: string;
  authors: string;
  parts: Work[];
}
export interface VaultNote {
  kind: string;
  lang: string;
  title: string;
  path: string;
  markdown?: string;
}
export interface Query {
  q: string;
  lang: string;
  expect: string;
}
export interface Source {
  id: string;
  url: string;
  file: string;
  sha256: string | null;
  license?: string;
  attribution?: string;
  pinnedAt?: string;
}
export interface Manifest {
  schema: number;
  generator: string;
  origin: "real" | "derived-from-docs" | "synthetic";
  requested: number;
  notes: { total: number; he: number; en: number; benyehudaLong: number; benyehudaHuge: number; hugeBytes: number[] };
  shortfall: { long: number; huge: number };
  bytes: number;
  links: { total: number; resolved: number };
  sha256: string;
  sources: Array<Record<string, unknown>>;
}
export type DumpInput = string | { chunks: AsyncIterable<string | Uint8Array>; close?: () => void };
export interface Inputs {
  hewiki?: DumpInput;
  enwiki?: DumpInput;
  benyehuda?: string;
  docs?: string;
}

export function xmlUnescape(s: string): string;
export function parsePage(xml: string): Page;
export function readPages(chunks: AsyncIterable<string | Uint8Array>): AsyncGenerator<Page>;
export function openDump(path: string): { chunks: AsyncIterable<string>; close(): void };
export function noteName(title: string, lang: string): string;
export function infobox(text: string): Infobox | null;
export function categoryTag(name: string): string;
export function wikitextToMarkdown(title: string, wikitext: string, lang: string, resolve?: (title: string) => string): { markdown: string; tags: string[]; infobox: Infobox | null; body: string };
export function parseCatalogueCsv(csv: string): Array<Omit<Work, "file" | "bytes">>;
export function benYehudaWorks(dir: string): Work[];
export function pickBenYehuda(works: Work[], opts?: { long?: number; huge?: number; hugeMin?: number; hugeMax?: number }): { long: Work[]; huge: HugeNote[]; shortfall: { long: number; huge: number } };
export function sha256File(path: string): Promise<string>;
export function loadSources(file?: string): { sources: Source[] };
export function checkPin(id: string, path: string, opts?: { file?: string; record?: boolean }): Promise<string>;
export function fetchSources(cache: string, opts?: { record?: boolean; file?: string }): Promise<{ hewiki?: string; enwiki?: string; benyehuda?: string }>;
export function split(n: number, byNotes: number): { heWiki: number; en: number; by: number };
export function linkTargets(md: string): string[];
export function pickQueries(notes: VaultNote[], count?: number): Query[];
export function buildVault(inputs: Inputs, opts?: { notes?: number; out?: string; long?: number; huge?: number; sources?: Array<Record<string, unknown>> | null }): Promise<Manifest>;
export function docsNotes(dir: string, want: number): VaultNote[];
