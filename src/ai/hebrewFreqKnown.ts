/**
 * Is a word in the frequency list (plan W11.H4), with valid Hebrew prefix
 * letters peeled? Apart from ai/hebrewFreq.ts so that the readability index
 * (W13.W9, a writing agent) loads only pure modules (W1's static check).
 */
import { PREFIX, PREFIX_NEXT, stripMarks } from "../text/hebrewPrefix";

export interface FrequencyList {
  counts: Map<string, number>;
  /** Every word in the list (the counts' keys), for `suggest`. */
  words: Set<string>;
}

const MIN_STEM = 3;

/**
 * Is the word in the list, as is or with valid prefix letters peeled (to a
 * stem of ≥ 3 letters)? An article on a word that already has one
 * ("ההיום", "בההסופה") is not peeled away.
 */
export function frequencyKnown(list: FrequencyList, raw: string): boolean {
  const word = stripMarks(raw);
  if (list.words.has(word)) return true;
  let rest = word;
  let prev: string | null = null;
  for (let i = 0; i < 3 && rest.length > MIN_STEM && PREFIX.has(rest[0]) && (prev === null || PREFIX_NEXT[prev].includes(rest[0])); i++) {
    prev = rest[0];
    rest = rest.slice(1);
    // An article (or ב/כ/ל, which swallow it) before a word that already has one: "ההיום", "בהבית".
    if ("הבכל".includes(prev) && rest[0] === "ה" && rest.length > 3 && list.words.has(rest.slice(1))) return false;
    if (list.words.has(rest) || (rest.startsWith("ו") && list.words.has(rest.slice(1))) || list.words.has("ו" + rest)) return true;
  }
  return false;
}
