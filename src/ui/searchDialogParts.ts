/**
 * Parts of the search dialog (W10.E30), moved verbatim out of
 * SearchDialog.tsx for the 800-line limit (W6.25): the retrieval and the
 * context of an Ask Workspace question, and a hit's highlighted snippet.
 */
import { t } from "../i18n";
import { readWorkspaceFile } from "../storage/workspace";
import { semanticSearch, type RagResult } from "../ai/embeddings";
import { searchHybrid, type SemanticHit } from "../ai/semanticSearch";
import { rerank } from "../ai/reranker";
import { keepInScope, type ScopeFilter } from "../ai/askScope";
import { buildAskContext as buildScopedContext } from "../ai/askVault";

/** The notes an Ask Workspace question is answered from: hybrid hits (or BM25), reranked, the best 8. */
export async function retrieveForQuestion(query: string, inScope: ScopeFilter): Promise<RagResult[]> {
  // Hybrid retrieval — when the user has built the embedding index
  // (Smart tab → Build) we fuse BM25 + semantic via RRF for genuinely
  // semantic-aware Q&A. When the index is empty, `searchHybrid` falls
  // back to BM25 alone, so we never block the AI tab on a missing index.
  // Smart search runs on this device, so it is never gated (W11.P12).
  const hybridHits = await searchHybrid(query, 30).catch(() => [] as SemanticHit[]);
  const fallback =
    hybridHits.length === 0
      ? // Whole notes (bounded), like the hybrid path: the packer trims.
        await semanticSearch(query, { topK: 8, maxContentChars: 200_000 })
      : [];
  // Materialise the hybrid hits into RagResult shape so the existing
  // citation-rendering code below works untouched.
  const hybridResults: RagResult[] = await Promise.all(
    hybridHits.map(async (h) => ({
      path: h.path,
      score: h.score,
      snippet: h.snippet,
      content: await readWorkspaceFile(h.path)
        // Whole notes (bounded): the context packer picks the parts.
        .then((c) => c.slice(0, 200_000))
        .catch(() => h.snippet),
    })),
  );
  // W12.A2: out-of-scope notes are dropped before reranking (and again in the context).
  // T29: rerank the candidates against the question, keep the best 8.
  const pool = keepInScope(hybridResults.length > 0 ? hybridResults : fallback, inScope);
  const results: RagResult[] = (
    await rerank(query, pool.map((r) => ({ ...r, text: `${r.snippet ?? ""}\n${r.content.slice(0, 1500)}` })))
  )
    .slice(0, 8)
    .map(({ text: _text, rerankScore: _r, ...r }) => r as RagResult);
  return results;
}

/** The context of the question: the relevant parts of each in-scope note, an outside note guarded (plan 2.7, W12.A1–A2 ../ai/askVault). */
export async function buildAskContext(query: string, results: RagResult[], inScope: ScopeFilter): Promise<{ contextStr: string; untrusted: string[] }> {
  // Only the parts relevant to the question, within the AI mode's token budget (context packer).
  const { CONTEXT_BUDGET, getAiMode } = await import("../ai/contextPacker");
  // Plan 2.7: a note from outside (clipped, imported, pulled) goes to the model cleaned and delimited, and taints the run.
  const { ensureProvenanceBackfill, guardUntrusted, untrustedSourcesOfNote } = await import("../agents/untrusted");
  await ensureProvenanceBackfill();
  const { context: contextStr, untrusted } = buildScopedContext(query, results, CONTEXT_BUDGET[getAiMode()], inScope, {
    untrustedOf: untrustedSourcesOfNote,
    guard: guardUntrusted,
    noRelevant: t("searchDialog.noRelevant"),
  });
  return { contextStr, untrusted };
}
