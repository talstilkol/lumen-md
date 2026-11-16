/**
 * bert-base-NER (English names) through the app's PII redactor: findPii with
 * nerIfCached(…, NER_MODEL_ID_EN), the model namesEngine() picks for English
 * text (plan 2.6, audit W10.C23), on the ner-pii set with the set's own
 * recall / precision rules, as dictabert-ner.ts does for Hebrew. The
 * redactor uses the model only when it is already on this device, so the
 * engine first downloads it with the converted-model consent step (running
 * the bench is the owner's consent). Until the converted-model host exists
 * (15.9) the run is an error, never a number. The set's names are Hebrew
 * (iahltwiki) and synthetic, so this measures what the English model finds
 * there; an English-names part is owed to the set (W10.E35 port, lane A1).
 */
import { CONVERTED_MODELS_BASE, requestConvertedModel } from "../../ai/convertedModels";
import { findPii, type NerFn } from "../../ai/pii";
import { NER_MODEL_ID_EN, nerIfCached } from "../../ai/piiNer";
import { transformersDevice } from "../../ai/transformersEngine";
import type { BenchEngine } from "../types";

let ner: NerFn | null = null;

export const engine: BenchEngine = {
  id: "bert-base-ner",
  label: "PII redactor with bert-base-NER (English names)",
  set: "ner-pii",
  models: [NER_MODEL_ID_EN],
  async load() {
    if (!CONVERTED_MODELS_BASE) throw new Error("the converted-model host is not set (15.9): bert-base-NER cannot be downloaded");
    const { isModelCachedInOpfs } = await import("../../ai/modelCache");
    const answer = await requestConvertedModel(NER_MODEL_ID_EN, "q8", { confirm: async () => true, isCached: (e, d) => isModelCachedInOpfs(e, d), t: (k) => k, base: CONVERTED_MODELS_BASE });
    if (answer !== "ready") throw new Error(`bert-base-NER: ${answer}`);
    ner = await nerIfCached(CONVERTED_MODELS_BASE, NER_MODEL_ID_EN);
    if (!ner) throw new Error("bert-base-NER is not cached after its download");
    await findPii("John Smith lives in Tel Aviv", { ner });
    return { device: await transformersDevice(), model: NER_MODEL_ID_EN };
  },
  run: async (item) => (await findPii((item.input as { text: string }).text, { ner })).map((s) => ({ start: s.start, end: s.end, type: s.type })),
};
