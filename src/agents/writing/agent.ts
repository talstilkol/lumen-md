/**
 * What a writing agent is (plan W13.W1): a function from text to
 * suggestions. It gets the text, its language, the level the user writes
 * at and a cancel signal, and optionally the on-device model door
 * (`model.ts`). It gets no tools, no file system, no store and no network:
 * it cannot write anything anywhere, only propose. The static checks in
 * writingSuggestions.test.ts and writingNoNetwork.test.ts hold every file
 * under src/agents/writing to that.
 */
import type { WritingSuggestion } from "./suggestion";
import type { LocalModel } from "./model";

export type WritingLang = "he" | "en";
/** How formal the writing is meant to be (the coach is stricter for academic text). */
export type WritingLevel = "everyday" | "professional" | "academic";
export const WRITING_LEVELS: readonly WritingLevel[] = ["everyday", "professional", "academic"];

export interface WritingContext {
  text: string;
  lang: WritingLang;
  level: WritingLevel;
  signal: AbortSignal;
  /** The on-device model, when one is set up; null = rules only. */
  model: LocalModel | null;
  /** Agent-specific options (tone, target length …). */
  options?: Record<string, unknown>;
}

export interface WritingAgent {
  id: string;
  /** detector: finds spans in the text; generator: rewrites the text it is given. */
  kind: "detector" | "generator";
  /** Whether it needs the model (a generator does; a detector only ranks with it). */
  needsModel: boolean;
  run(ctx: WritingContext): Promise<WritingSuggestion[]>;
}

const agents = new Map<string, WritingAgent>();

export function registerWritingAgent<A extends WritingAgent>(a: A): A {
  agents.set(a.id, a);
  return a;
}

export function writingAgents(): WritingAgent[] {
  return [...agents.values()];
}

export function getWritingAgent(id: string): WritingAgent | undefined {
  return agents.get(id);
}

/** The text's main language: Hebrew when a fifth of its letters are Hebrew. */
export function langOf(text: string): WritingLang {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const he = text.match(/[א-ת]/g)?.length ?? 0;
  return letters && he / letters >= 0.2 ? "he" : "en";
}

/** Throws the signal's reason when it was aborted (agents call it between steps). */
export function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}
