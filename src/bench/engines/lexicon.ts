/**
 * The Hebrew Wiktionary pack (user download) through the app's lexicon
 * store and lookup() (src/lexicon, W10.E35): of the real Hebrew words in
 * the typos set's clean sentences, how many the dictionary popover finds.
 * Downloaded with the app's own command path (downloadLexicon; running the
 * bench is the owner's request). Until the pack is published
 * (public/lexicon/manifest.json) the run is an error, never a number.
 */
import { lookup } from "../../lexicon/lexicon";
import { downloadLexicon, loadLexicon } from "../../lexicon/store";
import type { BenchEngine } from "../types";

export const engine: BenchEngine = {
  id: "lexicon",
  label: "Hebrew Wiktionary pack, lookup coverage",
  set: "typos-he",
  task: "lexicon-coverage",
  models: ["hewiktionary-lexicon"],
  async load() {
    await loadLexicon().catch(async () => {
      await downloadLexicon();
      await loadLexicon();
    });
    return { device: "cpu", model: "hewiktionary-lexicon" };
  },
  async run(item) {
    const index = await loadLexicon();
    return (item.input as { words: string[] }).words.filter((w) => lookup(index, w) !== null).length;
  },
};
