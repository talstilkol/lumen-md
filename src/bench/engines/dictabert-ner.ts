/**
 * DictaBERT-NER through the app's PII redactor (findPii with nerIfCached(),
 * plan 2.6, 7.8, W10.E35) on the ner-pii set: the redactor's spans per item,
 * scored with the set's recall / precision rules. The redactor uses the
 * model only when it is already on this device, so the engine first
 * downloads it with the converted-model consent step (running the bench is
 * the owner's consent). Until the converted-model host exists (15.9) the
 * run is an error, never a number.
 */
import { CONVERTED_MODELS_BASE, requestConvertedModel } from "../../ai/convertedModels";
import { findPii, type NerFn } from "../../ai/pii";
import { NER_MODEL_ID, nerIfCached } from "../../ai/piiNer";
import { transformersDevice } from "../../ai/transformersEngine";
import type { BenchEngine } from "../types";

let ner: NerFn | null = null;

export const engine: BenchEngine = {
  id: "dictabert-ner",
  label: "PII redactor with DictaBERT-NER",
  set: "ner-pii",
  models: [NER_MODEL_ID],
  async load() {
    if (!CONVERTED_MODELS_BASE) throw new Error("the converted-model host is not set (15.9): DictaBERT-NER cannot be downloaded");
    const { isModelCachedInOpfs } = await import("../../ai/modelCache");
    const answer = await requestConvertedModel(NER_MODEL_ID, "q8", { confirm: async () => true, isCached: (e, d) => isModelCachedInOpfs(e, d), t: (k) => k, base: CONVERTED_MODELS_BASE });
    if (answer !== "ready") throw new Error(`DictaBERT-NER: ${answer}`);
    ner = await nerIfCached();
    if (!ner) throw new Error("DictaBERT-NER is not cached after its download");
    await findPii("ישראל ישראלי גר בתל אביב", { ner });
    return { device: await transformersDevice(), model: NER_MODEL_ID };
  },
  run: async (item) => (await findPii((item.input as { text: string }).text, { ner })).map((s) => ({ start: s.start, end: s.end, type: s.type })),
};
