/**
 * Plan 2.7: ProtectAI's deberta-v3-base-prompt-injection-v2 (Apache-2.0,
 * English) behind the injection-classifier seam (./injectionClassifier.ts).
 *
 * Registered only when the model is already on this device — the same rule
 * as the redactor's names model (src/ai/piiNer.ts): cleaning outside text
 * never starts a download. It runs in the transformers worker
 * (sequenceLogitsLocal); its logits become scores in protectAiClassifier.
 * Until the converted-model host is chosen (15.9, CONVERTED_MODELS_BASE is
 * null) nothing is cached and the rules work alone, as before.
 */
import { getInjectionClassifier, protectAiClassifier, setInjectionClassifier, type InjectionClassifier } from "./injectionClassifier";

export const PROTECTAI_ID = "deberta-v3-base-prompt-injection-v2";
/** The checkpoint's id2label, in index order. */
export const PROTECTAI_LABELS = ["SAFE", "INJECTION"] as const;
/** How often a missing model is looked for again (it may have been downloaded meanwhile). */
export const RECHECK_MS = 60_000;

export interface ProtectAiDeps {
  /** The converted-model host, or null (then nothing is cached). */
  base: string | null;
  /** Whether the model's q8 files are in the verified cache. */
  isCached: (id: string) => Promise<boolean>;
  logits: (texts: string[], model: string, host: string, signal?: AbortSignal) => Promise<{ logits: number[]; labels: string[] }>;
}

async function defaultDeps(): Promise<ProtectAiDeps> {
  const { CONVERTED_MODELS_BASE, loadConvertedRegistry } = await import("../ai/convertedModels");
  return {
    base: CONVERTED_MODELS_BASE,
    isCached: async (id) => {
      const entry = (await loadConvertedRegistry()).get(id);
      if (!entry || typeof navigator === "undefined" || !navigator.storage?.getDirectory) return false;
      const { isModelCached } = await import("../ai/modelCache");
      const root = (await navigator.storage.getDirectory()) as unknown as Parameters<typeof isModelCached>[0];
      return isModelCached(root, entry, "q8");
    },
    logits: async (texts, model, host, signal) => (await import("../ai/transformersEngine")).sequenceLogitsLocal(texts, model, { host, signal }),
  };
}

/** The classifier when the model is on this device, else null. */
export async function protectAiIfCached(deps?: ProtectAiDeps): Promise<InjectionClassifier | null> {
  const d = deps ?? (await defaultDeps());
  if (!d.base || !(await d.isCached(PROTECTAI_ID))) return null;
  const host = d.base.endsWith("/") ? d.base : `${d.base}/`;
  return protectAiClassifier(async (texts, signal) => {
    const r = await d.logits(texts, PROTECTAI_ID, host, signal);
    // A checkpoint with other labels is not this classifier: refuse rather than misread its scores.
    if (r.labels.join() !== PROTECTAI_LABELS.join()) throw new Error(`protectai: labels ${JSON.stringify(r.labels)}`);
    return r.logits;
  }, PROTECTAI_LABELS);
}

let checkedAt = -Infinity;

/**
 * Registers ProtectAI when no classifier is registered and the model is on
 * this device. Cheap to call before each cleaning: a miss is remembered for
 * RECHECK_MS. Never throws (the rules have run either way).
 */
export async function ensureInjectionClassifier(deps?: ProtectAiDeps, now: number = Date.now()): Promise<InjectionClassifier | null> {
  const have = getInjectionClassifier();
  if (have) return have;
  if (now - checkedAt < RECHECK_MS) return null;
  checkedAt = now;
  try {
    const c = await protectAiIfCached(deps);
    if (c && !getInjectionClassifier()) setInjectionClassifier(c);
    return getInjectionClassifier();
  } catch {
    return null; // why: an extra layer; a failed check leaves the rules alone, as with no model
  }
}

/** Test hook. */
export function __resetProtectAiCheck(): void {
  checkedAt = -Infinity;
}
