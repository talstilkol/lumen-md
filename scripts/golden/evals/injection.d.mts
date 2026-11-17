import type { classifyText as ClassifyText, InjectionClassifier } from "../../../src/agents/injectionClassifier";
export function textsOf(item: Record<string, unknown>): { positive: string | null; negative: string | null };
export function scoreWith(classifyText: typeof ClassifyText, classifier: InjectionClassifier, items: Array<Record<string, unknown>>): Promise<Record<string, number>>;
export function score(set: { items: Array<Record<string, unknown>> }, env?: Record<string, string | undefined>): Promise<Record<string, number>>;
