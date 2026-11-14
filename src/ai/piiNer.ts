/**
 * Hebrew names for the PII redactor (plan 2.6): DictaBERT-NER (CC BY 4.0,
 * appendix 19), converted to ONNX by the model-convert workflow (plan 6.0).
 *
 * Only a model that is already on this device is used: a cloud request
 * never starts a download. Until the host of the converted models is
 * chosen (15.9, CONVERTED_MODELS_BASE is null) there is nothing to load,
 * and the redactor runs on patterns alone.
 */
import { alignNer, type NerFn } from "./pii";
import { CONVERTED_MODELS_BASE, loadConvertedRegistry } from "./convertedModels";

export const NER_MODEL_ID = "dictabert-ner";

/**
 * Every entity DictaBERT-NER finds (W11.H11), for unlinked mentions: the
 * same cached-only rule as the redactor. Null when the model is not on this
 * device.
 */
export async function entitiesIfCached(base: string | null = CONVERTED_MODELS_BASE): Promise<((text: string) => Promise<import("./ner/entities").TextEntity[]>) | null> {
  const model = await cachedModel(base);
  if (!model) return null;
  return async (text) => {
    const [{ nerLocal }, { alignEntities }] = await Promise.all([import("./transformersEngine"), import("./ner/entities")]);
    const [tokens] = await nerLocal([text], model);
    return alignEntities(text, tokens ?? []);
  };
}

/** The model's folder on the host when its int8 (q8) files are already cached, else null. */
async function cachedModel(base: string | null): Promise<string | null> {
  if (!base) return null;
  const entry = (await loadConvertedRegistry()).get(NER_MODEL_ID);
  if (!entry || typeof navigator === "undefined" || !navigator.storage?.getDirectory) return null;
  const { isModelCached } = await import("./modelCache");
  const root = (await navigator.storage.getDirectory()) as unknown as Parameters<typeof isModelCached>[0];
  if (!(await isModelCached(root, entry, "q8"))) return null;
  return `${base.endsWith("/") ? base : `${base}/`}${NER_MODEL_ID}`;
}

/** The name finder when DictaBERT-NER is cached, else null. */
export async function nerIfCached(base: string | null = CONVERTED_MODELS_BASE): Promise<NerFn | null> {
  const model = await cachedModel(base);
  if (!model) return null;
  return async (text) => {
    const { nerLocal } = await import("./transformersEngine");
    const [tokens] = await nerLocal([text], model);
    return alignNer(text, tokens ?? []);
  };
}
