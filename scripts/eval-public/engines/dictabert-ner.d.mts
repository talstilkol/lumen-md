import type { Piece, Span } from "./ner-core.mjs";
export interface NerEngine { id: string; digest: string; extract(text: string): Promise<Span[]>; tag(tokens: string[]): Promise<string[]> }
export function nerEngine(id: string, digest: string, pipe: (text: string) => Promise<Piece[]>): NerEngine;
export function onnxFile(dir: string, dtype: string): string;
export function makeDictaBertNer(env?: Record<string, string | undefined>, deps?: { transformers?: unknown; pipeline?: (...a: never[]) => unknown; digest?: string }): Promise<NerEngine>;
export default function make(): Promise<NerEngine>;
