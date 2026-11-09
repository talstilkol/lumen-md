/// <reference lib="webworker" />
/**
 * Hebrew spelling worker (T28): holds the 340k-word dictionary off the
 * main thread and answers check requests.
 */
import { buildDictionary, hebrewRules, hebrewSpelling } from "./hebrewSpell";
import type { GrammarMatch } from "./grammar";

let dict: Set<string> | null = null;

type In = { type: "load"; dic: string } | { type: "check"; id: number; text: string };
type Out = { type: "loaded"; words: number } | { type: "result"; id: number; matches: GrammarMatch[] };

self.onmessage = (e: MessageEvent<In>) => {
  const msg = e.data;
  if (msg.type === "load") {
    dict = buildDictionary(msg.dic);
    (self as unknown as Worker).postMessage({ type: "loaded", words: dict.size } satisfies Out);
  } else if (msg.type === "check") {
    const matches = [...hebrewRules(msg.text), ...(dict ? hebrewSpelling(dict, msg.text) : [])];
    (self as unknown as Worker).postMessage({ type: "result", id: msg.id, matches } satisfies Out);
  }
};
