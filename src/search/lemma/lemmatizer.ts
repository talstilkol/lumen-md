/**
 * The lemmatizer seam for Hebrew search (plan W11.H12, on W2.11): search
 * indexes and queries lemmas, so "המחברות" finds "מחברת". Two candidates
 * sit behind one interface, chosen by the A/B below and the W11.M3 run:
 *
 *  - Shoshan (HebArabNlpProject/shoshan; code MIT, DictaBERT encoder under
 *    its licence): retrieve the lemma from a fixed bank of ~117.6k lemmas;
 *    when the best bank entry is not a plausible lemma of the word,
 *    transduce the word with a learned edit script. Every output is a bank
 *    entry or a bounded edit of the word (./shoshan.ts).
 *  - DictaBERT-lex (dicta-il/dictabert-lex): the model writes the lemma
 *    directly (./dictaLex.ts).
 *
 * Research R2 §1.7: Shoshan 92.4 % out of domain, 94.3 % in domain, 0 %
 * errors on low-overlap words vs 12.3 % for DictaBERT-lex. The models run
 * after the ONNX export (W11.M3); until then the app keeps its rule-based
 * Hebrew morphology.
 */
export interface Lemmatizer {
  id: string;
  /** One lemma per word of `words`, which are the sentence's words in order. */
  lemmatize(words: readonly string[], sentence: string): Promise<string[]>;
}

const POINTS = /[֑-ׇ]/g;

/** Shoshan's lemma normal form: undotted, quote-folded (׳ ’ ‘ → ', ״ “ ” → "), NFC. */
export function normalizeLemma(s: string): string {
  return s
    .normalize("NFD")
    .replace(POINTS, "")
    .normalize("NFC")
    .replace(/[׳’‘`]/g, "'")
    .replace(/[״“”]/g, '"')
    .trim();
}

/** Words of a sentence as the search tokenizer sees them (letters, digits, inner quotes). */
export function words(sentence: string): string[] {
  return sentence.match(/[\p{L}\p{N}]+(?:['"״׳][\p{L}\p{N}]+)*/gu) ?? [];
}

/** Text → its lemmas joined by spaces: what the search index stores for a lemmatizer. */
export async function lemmaText(text: string, lz: Lemmatizer): Promise<string> {
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?:;\n])\s+/)) {
    const w = words(sentence);
    if (!w.length) continue;
    out.push(...(await lz.lemmatize(w, sentence)).map(normalizeLemma));
  }
  return out.join(" ");
}
