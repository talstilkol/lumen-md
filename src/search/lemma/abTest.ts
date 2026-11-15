/**
 * The A/B of plan W11.H12: the same retrieval task searched with each
 * lemmatizer (and with none, today's setup), BM25 over lemmas, scored by
 * nDCG@10 — on HeQ (question → its paragraph) and the MMTEB Hebrew
 * retrieval task once their data is downloaded (eval/public manifests).
 *
 * The winner rule (W11.M3): Shoshan replaces the current setup only with
 * ≥ 92 % lemma accuracy out of domain (UD Hebrew IAHLT) AND an nDCG@10 not
 * lower than the current setup's; otherwise nothing changes.
 */
import { Bm25Index } from "../bm25";
import { lemmaText, type Lemmatizer } from "./lemmatizer";

export interface RetrievalCase {
  id: string;
  query: string;
  /** Ids of the relevant documents (binary relevance). */
  relevant: string[];
}

export interface RetrievalTask {
  docs: { id: string; text: string }[];
  queries: RetrievalCase[];
}

/** nDCG@k with binary relevance. */
export function ndcgAt(ranked: readonly string[], relevant: readonly string[], k = 10): number {
  const rel = new Set(relevant);
  let dcg = 0;
  ranked.slice(0, k).forEach((id, i) => {
    if (rel.has(id)) dcg += 1 / Math.log2(i + 2);
  });
  let idcg = 0;
  for (let i = 0; i < Math.min(k, rel.size); i++) idcg += 1 / Math.log2(i + 2);
  return idcg ? dcg / idcg : 0;
}

/** No lemmatizer: today's setup, words as they are. */
export const IDENTITY: Lemmatizer = { id: "none", lemmatize: async (w) => [...w] };

export async function ndcgWith(task: RetrievalTask, lz: Lemmatizer, k = 10): Promise<number> {
  const index = new Bm25Index();
  for (const d of task.docs) index.set(d.id, await lemmaText(d.text, lz));
  let sum = 0;
  for (const q of task.queries) {
    const hits = index.search(await lemmaText(q.query, lz), { limit: k });
    sum += ndcgAt(hits.map((h) => h.id), q.relevant, k);
  }
  return task.queries.length ? sum / task.queries.length : Number.NaN;
}

export interface AbResult {
  task: string;
  ndcg10: Record<string, number>;
}

export async function abTest(name: string, task: RetrievalTask, lemmatizers: readonly Lemmatizer[]): Promise<AbResult> {
  const ndcg10: Record<string, number> = {};
  for (const lz of [IDENTITY, ...lemmatizers]) ndcg10[lz.id] = Math.round((await ndcgWith(task, lz)) * 1e4) / 1e4;
  return { task: name, ndcg10 };
}

export const SHOSHAN_OOD_MIN = 0.92;

/** The lemmatizer search should use: Shoshan only when both conditions hold, else what is used now. */
export function pickLemmatizer(o: { shoshanOod: number | null; ndcg: Record<string, number>; current?: string }): string {
  const current = o.current ?? "none";
  const s = o.ndcg.shoshan;
  const c = o.ndcg[current];
  if (o.shoshanOod === null || !Number.isFinite(s) || !Number.isFinite(c)) return current;
  return o.shoshanOod >= SHOSHAN_OOD_MIN && s >= c ? "shoshan" : current;
}

/**
 * HeQ (NNLP-IL Hebrew Question Answering, SQuAD-style JSON) as a retrieval
 * task: every paragraph is a document, every question a query whose
 * relevant document is its own paragraph.
 */
export function heqRetrieval(json: unknown): RetrievalTask {
  const data = (json as { data?: { title?: string; paragraphs?: { context?: string; qas?: { id?: string; question?: string }[] }[] }[] }).data;
  if (!Array.isArray(data)) throw new Error("HeQ: expected SQuAD-style { data: [...] }");
  const docs: RetrievalTask["docs"] = [];
  const queries: RetrievalCase[] = [];
  data.forEach((art, a) =>
    (art.paragraphs ?? []).forEach((p, i) => {
      if (typeof p.context !== "string") throw new Error(`HeQ: paragraph ${a}/${i} has no context`);
      const id = `p${a}_${i}`;
      docs.push({ id, text: p.context });
      for (const q of p.qas ?? []) if (typeof q.question === "string") queries.push({ id: q.id ?? `${id}_q${queries.length}`, query: q.question, relevant: [id] });
    }),
  );
  return { docs, queries };
}
