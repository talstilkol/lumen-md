/** Types of ./normalize-maps.mjs (plan W10.D21). */
export interface SourceMapV3 {
  version: number;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: Array<string | null>;
  names: string[];
  mappings: string;
  ignoreList?: number[];
}
export function decodeVlq(s: string): number[];
export function encodeVlq(values: readonly number[]): string;
export function decodeMappings(mappings: string): number[][][];
export function encodeMappings(lines: readonly (readonly (readonly number[])[])[]): string;
export function normalizeSource(source: string, o: { mapDir: string; root: string; sourceRoot?: string }): string;
export function normalizeMap(map: Partial<SourceMapV3>, o: { mapPath: string; root: string }): SourceMapV3;
export function normalizeMapsIn(dir: string, root?: string): string[];
