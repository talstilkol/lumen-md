/**
 * The lemmatizer in the search index (plan W11.H12): what a lemmatizer model
 * (Shoshan or DictaBERT-lex, ./lemmatizer.ts) adds to BM25 over the vault.
 *
 * - Each note's words are lemmatized in their sentences, once per change of
 *   the note, off the typing path (the vault index worker); every lemma
 *   becomes a `≃` term next to the note's words (Bm25Index.set's `extra`),
 *   in the comparison form the index uses (normalizeForMatch), so "נשים"
 *   in a note meets a search for "אישה" — a pair the rule-based morphology
 *   (text/hebrewMorph) cannot relate.
 * - Queries stay synchronous: a query word's lemmas come from the lexicon the
 *   indexing built (surface form → the lemmas the model gave it in the
 *   vault), plus the word itself as a lemma (people search in lemma form).
 *   They weigh LEMMA_WEIGHT, below the exact word, in the word's group.
 *
 * Which lemmatizer, if any: `chosenLemmatizer()`, the W11.M3 winner rule
 * over the committed public results — and a runtime for its ONNX export.
 * Neither exists yet, so it is null and search is exactly what it was.
 */
import { normalizeForMatch } from "../../text/hebrew";
import { LEMMA, LEMMA_WEIGHT, type QueryTerm } from "../../text/searchTokens";
import { normalizeLemma, words, type Lemmatizer } from "./lemmatizer";

/** Surface comparison form → the lemmas (comparison form) the model gave it in this vault. */
export class LemmaLexicon {
  private readonly map = new Map<string, Set<string>>();
  /** Bounded: a vault's distinct words, not every typo forever. */
  constructor(private readonly max = 200_000) {}
  get size(): number {
    return this.map.size;
  }
  add(surface: string, lemma: string): void {
    let s = this.map.get(surface);
    if (!s) {
      if (this.map.size >= this.max) this.map.clear();
      this.map.set(surface, (s = new Set()));
    }
    s.add(lemma);
  }
  lemmasOf(surface: string): ReadonlySet<string> | undefined {
    return this.map.get(surface);
  }
}

/** The index's form of a lemma or a word: Shoshan's lemma form, then the search comparison form. */
export const lemmaForm = (s: string): string => normalizeForMatch(normalizeLemma(s)).replace(/['"]/g, "");

/**
 * The `≃` terms of a text, one per word (a word whose lemma is empty gives
 * none), and the lexicon learns each word's lemma. Sentences are split as
 * ./lemmatizer.ts `lemmaText` does.
 */
export async function documentLemmaTerms(text: string, lz: Lemmatizer, lexicon?: LemmaLexicon, signal?: AbortSignal): Promise<string[]> {
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?:;\n])\s+/)) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const w = words(sentence);
    if (!w.length) continue;
    const lemmas = await lz.lemmatize(w, sentence);
    if (lemmas.length !== w.length) throw new Error(`${lz.id}: ${lemmas.length} lemmas for ${w.length} words`);
    lemmas.forEach((l, i) => {
      const lemma = lemmaForm(l);
      if (!lemma) return;
      out.push(LEMMA + lemma);
      const surface = lemmaForm(w[i]);
      if (surface) lexicon?.add(surface, lemma);
    });
  }
  return out;
}

/** The lemma terms to add to a query: for each exact query word, its lexicon lemmas and itself as a lemma. */
export function expandWithLemmas(base: readonly QueryTerm[], lexicon: LemmaLexicon): QueryTerm[] {
  const have = new Map(base.map((t) => [t.term, t.weight]));
  const out: QueryTerm[] = [];
  for (const t of base) {
    if (t.weight !== 1) continue;
    const forms = new Set([t.term, ...(lexicon.lemmasOf(t.term) ?? [])]);
    for (const f of forms) {
      const term = LEMMA + f;
      if ((have.get(term) ?? -1) >= LEMMA_WEIGHT) continue;
      have.set(term, LEMMA_WEIGHT);
      out.push({ term, weight: LEMMA_WEIGHT, group: t.group });
    }
  }
  return out;
}

// ------------------------------------------------------------ which lemmatizer (W11.M3)

/** One lemmatizer's public numbers (eval/results, via eval/public/_verdicts.json `lemmatizers`). */
export interface LemmatizerVerdict {
  /** Lemma accuracy on UD Hebrew IAHLTwiki (out of domain), 0–1. */
  accuracyOod: number;
  /** nDCG@10 on HeQ with this lemmatizer, and with none (today's search). */
  ndcg10: number;
  ndcg10None: number;
}

/** The W11.M3 rule: ≥ 92 % lemma accuracy out of domain AND an nDCG@10 not below today's. */
export const lemmatizerWins = (v: LemmatizerVerdict | undefined): boolean =>
  !!v && Number.isFinite(v.accuracyOod) && Number.isFinite(v.ndcg10) && Number.isFinite(v.ndcg10None) && v.accuracyOod >= 0.92 && v.ndcg10 >= v.ndcg10None;

/** The winner among the candidates, best nDCG@10 first; null when none passes. */
export function lemmatizerWinner(verdicts: Record<string, LemmatizerVerdict> | undefined, candidates: readonly string[] = ["shoshan", "dictabert-lex"]): string | null {
  const ok = candidates.filter((id) => lemmatizerWins(verdicts?.[id]));
  ok.sort((a, b) => verdicts![b].ndcg10 - verdicts![a].ndcg10 || verdicts![b].accuracyOod - verdicts![a].accuracyOod);
  return ok[0] ?? null;
}

/** The lemmatizer models' runtimes: their ONNX exports are W11.M3, so there is none yet. */
const NO_RUNTIME = async (_id: string): Promise<Lemmatizer | null> => null;

/**
 * The lemmatizer the vault index should use, or null (today: always null —
 * no committed result passes the rule, and no runtime exists).
 */
export async function chosenLemmatizer(
  verdicts?: () => Promise<Record<string, LemmatizerVerdict> | undefined>,
  runtime: (id: string) => Promise<Lemmatizer | null> = NO_RUNTIME,
): Promise<Lemmatizer | null> {
  const read =
    verdicts ??
    (async () => {
      const v = (await import("../../../eval/public/_verdicts.json")) as { default?: { lemmatizers?: Record<string, LemmatizerVerdict> }; lemmatizers?: Record<string, LemmatizerVerdict> };
      return (v.default ?? v).lemmatizers;
    });
  const id = lemmatizerWinner(await read());
  return id ? runtime(id) : null;
}

/**
 * The `lemmatizers` part of eval/public/_verdicts.json from the latest public
 * results: lemma accuracy from lemma-ud-iahltwiki (by engine id), nDCG@10
 * from retrieval-heq's A/B (`ndcg10.<id>` next to `ndcg10.none`). A
 * lemmatizer with only one of the two has no verdict.
 */
export function lemmatizerVerdicts(latest: ReadonlyArray<{ task: string; engine?: string; model: { id: string }; metrics: Record<string, number> }>): Record<string, LemmatizerVerdict> {
  const acc = new Map<string, number>();
  const ndcg = new Map<string, { v: number; none: number }>();
  for (const r of latest) {
    if (r.task === "lemma-ud-iahltwiki" && typeof r.metrics.accuracy === "number") acc.set(r.engine ?? r.model.id, r.metrics.accuracy);
    if (r.task === "retrieval-heq") {
      const none = r.metrics["ndcg10.none"];
      for (const [k, v] of Object.entries(r.metrics)) {
        const id = k.startsWith("ndcg10.") ? k.slice(7) : "";
        if (id && id !== "none" && typeof v === "number" && typeof none === "number") ndcg.set(id, { v, none });
      }
    }
  }
  const out: Record<string, LemmatizerVerdict> = {};
  for (const [id, a] of acc) {
    const n = ndcg.get(id);
    if (n) out[id] = { accuracyOod: a, ndcg10: n.v, ndcg10None: n.none };
  }
  return out;
}
