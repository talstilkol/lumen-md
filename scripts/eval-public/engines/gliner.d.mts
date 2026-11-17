import type { GlinerFeeds, GlinerTokenizer } from "./ner-core.mjs";
import type { NerEngine } from "./dictabert-ner.mjs";
export const NEMO_LABELS: Record<string, string>;
export function glinerEngine(o: { id: string; digest: string; tok: GlinerTokenizer; run: (f: GlinerFeeds) => Promise<ArrayLike<number>>; labels?: Record<string, string>; threshold?: number; maxWidth?: number }): NerEngine;
export function ortFeeds(ort: { Tensor: new (type: string, data: unknown, dims: number[]) => unknown }, f: GlinerFeeds): Record<string, unknown>;
export function makeGliner(env?: Record<string, string | undefined>, deps?: { tok?: GlinerTokenizer; run?: (f: GlinerFeeds) => Promise<ArrayLike<number>>; digest?: string }): Promise<NerEngine>;
export default function make(): Promise<NerEngine>;
