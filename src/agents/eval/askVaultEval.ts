/**
 * Plan W12.A3 — "Ask the vault" measured on public data, through the path
 * the app runs (src/ui/SearchDialog.tsx askAi), not a stand-in for it:
 *
 *  1. **Retrieval** on the W11.I13 loaders (WebFAQ-heb, Belebele, BEIR; #793):
 *     heading chunks with their context prefix (W11.I14) in the app's BM25
 *     (search/bm25), one score per note (its best chunk), the scope filter
 *     (W12.A2) and the reranker off or on. nDCG@10 and Recall@20 per query.
 *  2. **Citations** on HeQ (Cohen et al. 2023; each question was written for
 *     one known paragraph): every HeQ paragraph is a note of the vault, the
 *     question goes through retrieval, the context builder (W12.A2), an
 *     answerer, and the citation checker (W12.A1). Per question:
 *       - cite_recall: a verified citation points at the official paragraph;
 *       - cite_precision: the share of verified citations that point at it
 *         (questions with at least one verified citation);
 *       - unsupported_rate: the share of the answer's claims with no
 *         verified quote.
 *
 * The answerer is pluggable. In the cloud there is no model, so the run
 * uses `extractiveAnswerer`, a labelled no-LLM baseline that quotes the
 * sentence of the retrieved notes closest to the question: it exercises
 * every step after the model and gives a floor, and its card is tagged
 * `dev`, never a claim. The real model runs on the Mac (W12.M1) through
 * `ollamaAnswerer`, on the full HeQ test split fetched at its pinned commit.
 */
import { contextualText, headingChunks } from "../../ai/headingChunks";
import { Bm25Index } from "../../search/bm25";
import { lexicalScore, rerank, type RerankMode } from "../../ai/reranker";
import { buildAskContext, type AskSource } from "../../ai/askVault";
import { scopeFilter, type ScopeFilter } from "../../ai/askScope";
import { CITE_INSTRUCTIONS, claimSupport, verifyVaultCitations } from "../../ai/vaultCitations";
import { ndcgAt, recallAt, type Retriever, type RetrievalSet } from "./retrievalPublic";

// ───────────────────────────── retrieval: the ask path ─────────────────────────────

export interface AskPathOptions {
  /** "off", or the reranker mode the app would use ("lexical" offline; "model" on the Mac). */
  rerank: "off" | RerankMode;
  /** The scope (W12.A2); default: no rules. */
  filter?: ScopeFilter;
  /** How many notes the reranker sees (the app reranks its candidates and keeps 8). */
  rerankDepth?: number;
}

/** The app's retrieval as a W11.I13 `Retriever`: heading chunks → BM25 → best chunk per note → scope → rerank. */
export function askPathRetriever(opts: AskPathOptions): Retriever {
  const idx = new Bm25Index();
  let docs = new Map<string, string>();
  const depth = opts.rerankDepth ?? 30;
  const filter = opts.filter ?? scopeFilter(undefined);
  return {
    id: `ask-path(chunks,bm25,scope,rerank=${opts.rerank})`,
    async index(corpus) {
      docs = corpus;
      let bytes = 0;
      for (const [id, text] of corpus) {
        headingChunks(text, { title: id }).forEach((c, i) => {
          const t = contextualText(c);
          idx.set(`${id}\u0000${i}`, t, "");
          bytes += t.length;
        });
      }
      return bytes;
    },
    async search(q, k) {
      const best = new Map<string, number>();
      for (const h of idx.search(q, { limit: Math.max(200, k * 10) })) {
        const doc = h.id.slice(0, h.id.indexOf("\u0000"));
        if (!best.has(doc)) best.set(doc, h.score);
      }
      let ranked = [...best.keys()].filter((d) => filter(d, docs.get(d) ?? ""));
      if (opts.rerank !== "off" && ranked.length > 1) {
        const head = await rerank(q, ranked.slice(0, depth).map((id) => ({ id, text: (docs.get(id) ?? "").slice(0, 1500) })), { mode: opts.rerank });
        ranked = [...head.map((h) => h.id), ...ranked.slice(depth)];
      }
      return ranked.slice(0, k);
    },
  };
}

export interface AskRetrievalRun {
  set: string;
  retriever: string;
  n: number;
  ndcg10: number[];
  recall20: number[];
}

/** nDCG@10 and Recall@20 per query (the task's two retrieval metrics). */
export async function runAskRetrieval(set: RetrievalSet, r: Retriever): Promise<AskRetrievalRun> {
  await r.index(set.corpus);
  const ndcg10: number[] = [];
  const recall20: number[] = [];
  for (const [qid, text] of set.queries) {
    const ranked = await r.search(text, 20);
    const rel = set.qrels.get(qid)!;
    ndcg10.push(ndcgAt(ranked, rel, 10));
    recall20.push(recallAt(ranked, rel, 20));
  }
  return { set: set.name, retriever: r.id, n: ndcg10.length, ndcg10, recall20 };
}

// ───────────────────────────── HeQ ─────────────────────────────

export interface HeqItem {
  id: string;
  question: string;
  /** The official HeQ paragraph the question was written for (a corpus id). */
  gold: string;
  answers: string[];
}
export interface HeqSet {
  name: string;
  /** Paragraph id → { title, text }. */
  corpus: Map<string, { title: string; text: string }>;
  items: HeqItem[];
}

/** The committed golden form (eval/golden/retrieval/<split>/heq.json, built from HeQ v1.1 test at a pinned commit). */
export function heqFromGolden(name: string, json: { items: Array<{ id: string; query: string; relevant: string[]; answers: string[] }>; corpus: Array<{ id: string; title: string; text: string }> }): HeqSet {
  const corpus = new Map(json.corpus.map((d) => [d.id, { title: d.title, text: d.text }]));
  const items = json.items.filter((i) => i.relevant.length === 1 && corpus.has(i.relevant[0])).map((i) => ({ id: i.id, question: i.query, gold: i.relevant[0], answers: i.answers }));
  return { name, corpus, items };
}

interface SquadQa {
  id: string;
  question: string;
  is_impossible?: boolean;
  answers?: Array<{ text: string }>;
  "question quality"?: string;
}

/**
 * The upstream SQuAD form (HeQ `data/data v1.1/test v1.1.json`): every
 * answerable question, with the paragraph it was written for as gold. The
 * same questions the golden builder keeps (scripts/golden/sets/retrieval.mjs):
 * not impossible, with an answer, and not deixis / second-person.
 */
export function heqFromSquad(name: string, json: { data: Array<{ title: string; paragraphs: Array<{ context: string; qas: SquadQa[] }> }> }): HeqSet {
  const corpus = new Map<string, { title: string; text: string }>();
  const items: HeqItem[] = [];
  for (const article of json.data) {
    for (const p of article.paragraphs) {
      const id = `heq-d${String(corpus.size + 1).padStart(3, "0")}`;
      corpus.set(id, { title: article.title, text: p.context });
      for (const q of p.qas) {
        if (q.is_impossible || !q.answers?.length || ["deixis", "second"].includes(q["question quality"] ?? "")) continue;
        items.push({ id: q.id, question: q.question, gold: id, answers: [...new Set(q.answers.map((a) => a.text))] });
      }
    }
  }
  return { name, corpus, items };
}

/** A HeQ paragraph as a vault note: its own file, the article title as heading. */
export const heqNotePath = (id: string) => `heq/${id}.md`;
export const heqNote = (p: { title: string; text: string }) => `# ${p.title}\n\n${p.text}\n`;

// ───────────────────────────── answerers ─────────────────────────────

export interface Answerer {
  /** Name and pinned digest for the card. */
  model: { name: string; digest: string };
  temperature: number;
  answer(input: { question: string; context: string; instructions: string; sources: readonly AskSource[] }): Promise<string>;
}

const SENTENCE = /[^.!?\n]+[.!?]?/g;

/**
 * No-LLM baseline (labelled as such on its card): the sentence of the given
 * sources that shares most words with the question, quoted (≤ 20 words) and
 * cited by its source number. It reads the same sources the model would.
 */
export function extractiveAnswerer(): Answerer {
  return {
    model: { name: "extractive-baseline (no LLM, W12.A3)", digest: "none:extractive-baseline-v1" },
    temperature: 0,
    async answer({ question, sources }) {
      let best: { n: number; s: string; score: number } | null = null;
      sources.forEach((src, i) => {
        const body = src.content.replace(/^#.*$/gm, "");
        for (const m of body.matchAll(SENTENCE)) {
          const s = m[0].trim();
          if (s.split(/\s+/).length < 3) continue;
          const score = lexicalScore(question, s) + 0.01 / (1 + i);
          if (!best || score > best.score) best = { n: i + 1, s, score };
        }
      });
      if (!best) return "The notes do not cover this.";
      const b = best as { n: number; s: string };
      const quote = b.s.split(/\s+/).slice(0, 20).join(" ").replace(/[.!?]$/, "");
      return `${b.s} [${b.n}] "${quote}"`;
    },
  };
}

/** A local model through Ollama's chat API (the Mac run, W12.M1): temperature 0, a fixed seed. */
export function ollamaAnswerer(model: string, digest: string, opts: { url?: string; seed?: number; fetch?: typeof fetch } = {}): Answerer {
  const url = (opts.url ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  const f = opts.fetch ?? fetch;
  return {
    model: { name: model, digest },
    temperature: 0,
    async answer({ question, context, instructions }) {
      const res = await f(`${url}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          options: { temperature: 0, seed: opts.seed ?? 1 },
          messages: [
            { role: "system", content: `${instructions}\n\nContext files:\n${context}` },
            { role: "user", content: question },
          ],
        }),
      });
      if (!res.ok) throw new Error(`ollama ${res.status}`);
      return ((await res.json()) as { message?: { content?: string } }).message?.content ?? "";
    },
  };
}

// ───────────────────────────── the citation run ─────────────────────────────

export interface CitationRun {
  set: string;
  retriever: string;
  n: number;
  /** Per question: 1 when a verified citation names the official paragraph. */
  citeRecall: number[];
  /** Per question with ≥ 1 verified citation: the share of them at the official paragraph. */
  citePrecision: number[];
  /** Per question: the share of claims with no verified quote (0 when there is no claim). */
  unsupportedRate: number[];
  /** Per question: 1 when the official paragraph was among the sources given. */
  goldInContext: number[];
}

export async function runHeqCitations(set: HeqSet, retriever: Retriever, answerer: Answerer, opts: { topK?: number; budgetTokens?: number; filter?: ScopeFilter } = {}): Promise<CitationRun> {
  const topK = opts.topK ?? 8;
  const filter = opts.filter ?? scopeFilter(undefined);
  const notes = new Map<string, string>();
  for (const [id, p] of set.corpus) notes.set(heqNotePath(id), heqNote(p));
  await retriever.index(notes);
  const deps = { untrustedOf: () => [] as string[], guard: (text: string) => ({ text }), noRelevant: "(no relevant notes)" };
  const out: CitationRun = { set: set.name, retriever: retriever.id, n: 0, citeRecall: [], citePrecision: [], unsupportedRate: [], goldInContext: [] };
  for (const item of set.items) {
    const gold = heqNotePath(item.gold);
    const hits = (await retriever.search(item.question, topK)).map((path) => ({ path, content: notes.get(path) ?? "" }));
    const { sources, context } = buildAskContext(item.question, hits, opts.budgetTokens ?? 5_000, filter, deps);
    const answer = await answerer.answer({ question: item.question, context, instructions: CITE_INSTRUCTIONS, sources });
    const { citations } = verifyVaultCitations(answer, sources);
    const verified = citations.filter((c) => c.verified);
    const claims = claimSupport(answer, citations);
    out.citeRecall.push(verified.some((c) => c.path === gold) ? 1 : 0);
    if (verified.length) out.citePrecision.push(verified.filter((c) => c.path === gold).length / verified.length);
    out.unsupportedRate.push(claims.length ? claims.filter((c) => !c.supported).length / claims.length : 0);
    out.goldInContext.push(sources.some((s) => s.path === gold) ? 1 : 0);
    out.n++;
  }
  return out;
}

/** The scores a card is made of (makeCard's `scores`), with the metric names the cards use. */
export function citationScores(run: CitationRun): Record<string, number[]> {
  const s: Record<string, number[]> = { cite_recall: run.citeRecall, unsupported_rate: run.unsupportedRate, gold_in_context: run.goldInContext };
  if (run.citePrecision.length) s.cite_precision = run.citePrecision;
  return s;
}
