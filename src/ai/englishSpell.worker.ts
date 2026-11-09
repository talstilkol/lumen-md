/// <reference lib="webworker" />
/**
 * English spelling worker (plan 6.10): builds nspell from the bundled
 * en-US Hunspell files (≈ 0.35 s, once) off the main thread and answers
 * check requests. Nothing here touches the network.
 */
import nspell from "nspell";
import { aff, dic } from "virtual:lumen-dictionary-en";
import { englishSpelling } from "./englishSpell";
import type { GrammarMatch } from "./grammar";

type In = { type: "check"; id: number; text: string; personal?: string[] };
type Out = { type: "result"; id: number; matches: GrammarMatch[] };

const spell = nspell(aff, dic);
const suggestCache = new Map<string, string[]>();

self.onmessage = (e: MessageEvent<In>) => {
  const msg = e.data;
  if (msg.type !== "check") return;
  const personal = new Set((msg.personal ?? []).map((w) => w.toLowerCase()));
  if (suggestCache.size > 2000) suggestCache.clear();
  const matches = englishSpelling(spell, msg.text, { personal, suggestCache });
  (self as unknown as Worker).postMessage({ type: "result", id: msg.id, matches } satisfies Out);
};
