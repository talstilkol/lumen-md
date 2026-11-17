/** franc-min through the app's detectLanguage() (src/text/langId.ts: the script rules, then franc's trigrams) on the language-id set (W10.E35). */
import { detectLanguage } from "../../text/langId";
import type { BenchEngine } from "../types";

export const engine: BenchEngine = {
  id: "franc",
  label: "franc-min, detectLanguage()",
  set: "langid",
  models: ["franc-min"],
  async load() {
    detectLanguage("שלום עולם, זה משפט בעברית");
    return { device: "cpu", model: "franc-min" };
  },
  run: async (item) => detectLanguage((item.input as { text: string }).text).lang,
};
