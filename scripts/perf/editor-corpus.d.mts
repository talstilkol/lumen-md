// Types for scripts/perf/editor-corpus.mjs (W11.Q5), for the tests.
export const PINS_FILE: string;
export const OUT_DIR: string;
export const TWO_MIB: number;
export interface ByWork {
  id: string;
  title: string;
  authors: string;
  text: string;
}
export interface Pins {
  sources: Array<{ id: string; sha256: string | null; [k: string]: unknown }>;
}
export function stripGutenberg(text: string): string;
export function mobyDickNote(book: string): string;
export function benYehudaNote(works: ByWork[], target?: number): { text: string; ids: string[]; short: boolean };
export function readBenYehuda(dir: string): ByWork[];
export function checkPin(pins: Pins, id: string, content: string, record?: boolean): { pins: Pins; got: string; recorded: boolean };
