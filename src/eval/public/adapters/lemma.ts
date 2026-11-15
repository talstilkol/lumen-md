/**
 * Lemma accuracy on UD Hebrew (IAHLTwiki, the out-of-domain test for
 * Shoshan, which trains on the Knesset and Wikipedia parts of IAHLT; plan
 * W11.H12), from the treebank's CoNLL-U files.
 *
 * UD Hebrew splits prefixes into their own syntactic words under a
 * multiword token ("1-2 המחברות" → "1 ה", "2 מחברות"). A search lemmatizer
 * works on surface words, so each surface word is scored against the lemma
 * of its last syntactic word (the host: "המחברות" → "מחברת"); punctuation
 * is skipped. Lemmas are compared in Shoshan's normal form.
 */
import { normalizeLemma, type Lemmatizer } from "../../../search/lemma/lemmatizer";
import { r4 } from "../metrics";

export interface LemmaSentence {
  id: string;
  text: string;
  words: string[];
  lemmas: string[];
}

export function parseConllu(text: string): LemmaSentence[] {
  const out: LemmaSentence[] = [];
  let cur: LemmaSentence | null = null;
  let mwt: { end: number; form: string } | null = null;
  const start = () => (cur = { id: `s${out.length + 1}`, text: "", words: [], lemmas: [] });
  start();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      if (cur!.words.length) out.push(cur!);
      start();
      mwt = null;
      continue;
    }
    if (line.startsWith("#")) {
      const m = /^#\s*(sent_id|text)\s*=\s*(.*)$/.exec(line);
      if (m?.[1] === "sent_id") cur!.id = m[2].trim();
      if (m?.[1] === "text") cur!.text = m[2].trim();
      continue;
    }
    const c = line.split("\t");
    if (c.length < 10) throw new Error(`CoNLL-U: expected 10 columns, got ${c.length}: ${line.slice(0, 40)}`);
    const [id, form, lemma, upos] = c;
    const range = /^(\d+)-(\d+)$/.exec(id);
    if (range) {
      mwt = { end: Number(range[2]), form };
      continue;
    }
    if (/\./.test(id)) continue; // empty nodes
    if (mwt) {
      if (Number(id) === mwt.end) {
        cur!.words.push(mwt.form);
        cur!.lemmas.push(lemma);
        mwt = null;
      }
      continue;
    }
    if (upos === "PUNCT") continue;
    cur!.words.push(form);
    cur!.lemmas.push(lemma);
  }
  if (cur!.words.length) out.push(cur!);
  return out;
}

export async function lemmaAccuracy(sentences: readonly LemmaSentence[], lz: Lemmatizer): Promise<{ n: number; metrics: { accuracy: number }; words: number }> {
  let ok = 0;
  let n = 0;
  for (const s of sentences) {
    const got = await lz.lemmatize(s.words, s.text || s.words.join(" "));
    s.lemmas.forEach((g, i) => {
      n++;
      if (normalizeLemma(got[i] ?? "") === normalizeLemma(g)) ok++;
    });
  }
  return { n: sentences.length, words: n, metrics: { accuracy: r4(n ? ok / n : Number.NaN) } };
}
