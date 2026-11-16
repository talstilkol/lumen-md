/**
 * The Hebrew checker with Hspell's word list (AGPL-3.0, user download),
 * on the typos set (W10.E35): downloaded through the app's own command path
 * (downloadHebrewDictionary; running the bench is the owner's request), on
 * top of the frequency list, as the app runs it once installed. See ../spell.ts.
 */
import { downloadHebrewDictionary, hebrewDictionaryInstalled } from "../../ai/hebrewSpellService";
import { checkItem, frequencyListLoaded } from "../spell";
import type { BenchEngine } from "../types";

export const engine: BenchEngine = {
  id: "hspell",
  label: "Hebrew checker, Hspell + FrequencyWords",
  set: "typos-he",
  models: ["hspell-he-dictionary"],
  async load() {
    if (!(await hebrewDictionaryInstalled())) await downloadHebrewDictionary();
    await frequencyListLoaded();
    return { device: "cpu", model: "hspell-he-dictionary" };
  },
  run: async (item) => checkItem(item.input),
};
