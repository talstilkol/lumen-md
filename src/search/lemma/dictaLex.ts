/**
 * DictaBERT-lex (dicta-il/dictabert-lex) behind the lemmatizer seam (plan
 * W11.H12): the model writes each word's lemma itself. The ONNX export and
 * its decoding are W11.M3; the model's output per word comes through
 * `predict`, so the A/B can run now with a stand-in.
 */
import { normalizeLemma, type Lemmatizer } from "./lemmatizer";

export interface DictaLexModel {
  predict(words: readonly string[], sentence: string): Promise<string[]>;
}

export function dictaLexLemmatizer(model: DictaLexModel): Lemmatizer {
  return {
    id: "dictabert-lex",
    async lemmatize(words, sentence) {
      const out = await model.predict(words, sentence);
      if (out.length !== words.length) throw new Error(`dictabert-lex: ${out.length} lemmas for ${words.length} words`);
      // An empty prediction keeps the word, so search never loses a term.
      return out.map((l, i) => normalizeLemma(l) || normalizeLemma(words[i]));
    },
  };
}
