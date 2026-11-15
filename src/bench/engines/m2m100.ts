/**
 * M2M100-418M (transformers.js) through the app's translation worker (plan
 * 6.4, 7.8, W10.E34): Hebrew → English, the dtype the app picks for the
 * device. The weights come from Hugging Face on a cold cache.
 */
import { M2M100_MODEL, translateLocal, translationDtypeFor, transformersDevice } from "../../ai/transformersEngine";
import type { BenchEngine } from "../types";

async function translate(text: string): Promise<string> {
  const device = await transformersDevice();
  const [out] = await translateLocal(M2M100_MODEL, [text], { device, dtype: translationDtypeFor(device), srcLang: "he", tgtLang: "en" });
  return out ?? "";
}

export const engine: BenchEngine = {
  id: "m2m100",
  label: "M2M100 418M, he → en",
  set: "mt-he-en",
  models: [M2M100_MODEL],
  async load() {
    await translate("שלום");
    return { device: await transformersDevice(), model: M2M100_MODEL };
  },
  run: async (item) => translate((item.input as { text: string }).text),
};
