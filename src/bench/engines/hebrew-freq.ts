/** The Hebrew checker with the bundled FrequencyWords list only (no Hspell installed), on the typos set (W10.E35); see ../spell.ts. */
import { hebrewDictionaryInstalled } from "../../ai/hebrewSpellService";
import { checkItem, frequencyListLoaded } from "../spell";
import type { BenchEngine } from "../types";

export const engine: BenchEngine = {
  id: "hebrew-freq",
  label: "Hebrew checker, FrequencyWords he_50k",
  set: "typos-he",
  models: ["frequencywords-he-50k"],
  async load() {
    if (await hebrewDictionaryInstalled()) throw new Error("Hspell is installed in this profile: these would be the hspell engine's numbers");
    await frequencyListLoaded();
    return { device: "cpu", model: "frequencywords-he-50k" };
  },
  run: async (item) => checkItem(item.input),
};
