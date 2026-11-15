/**
 * Parts of the search dialog (W10.E30), moved verbatim out of
 * SearchDialog.tsx for the 800-line limit (W6.25): the retrieval and the
 * context of an Ask Workspace question, and a hit's highlighted snippet.
 */
import type React from "react";
import { t } from "../i18n";
import type { SearchHit } from "../storage/workspaceIndex";
import { readWorkspaceFile } from "../storage/workspace";
import { semanticSearch, type RagResult } from "../ai/embeddings";
import { searchHybrid, type SemanticHit } from "../ai/semanticSearch";
import { rerank } from "../ai/reranker";

/** The notes an Ask Workspace question is answered from: hybrid hits (or BM25), reranked, the best 8. */
export async function retrieveForQuestion(query: string, smartAllowed: boolean): Promise<RagResult[]> {
  // Hybrid retrieval — when the user has built the embedding index
  // (Smart tab → Build) we fuse BM25 + semantic via RRF for genuinely
  // semantic-aware Q&A. When the index is empty, `searchHybrid` falls
  // back to BM25 alone, so we never block the AI tab on a missing index.
  const hybridHits = smartAllowed
    ? await searchHybrid(query, 30).catch(() => [] as SemanticHit[])
    : [];
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
  // T29: rerank the candidates against the question, keep the best 8.
  const pool = hybridResults.length > 0 ? hybridResults : fallback;
  const results: RagResult[] = (
    await rerank(query, pool.map((r) => ({ ...r, text: `${r.snippet ?? ""}\n${r.content.slice(0, 1500)}` })))
  )
    .slice(0, 8)
    .map(({ text: _text, rerankScore: _r, ...r }) => r as RagResult);
  return results;
}

/** The context of the question: the relevant parts of each note, an outside note guarded (plan 2.7). */
export async function buildAskContext(query: string, results: RagResult[]): Promise<{ contextStr: string; untrusted: string[] }> {
  // Build context from semantic results: only the parts relevant to the
  // question, within the AI mode's token budget (context packer).
  const { packContext, CONTEXT_BUDGET, getAiMode } = await import("../ai/contextPacker");
  const packed = packContext(
    query,
    results.map((r) => ({ path: r.path, content: r.content })),
    CONTEXT_BUDGET[getAiMode()],
  );
  // Plan 2.7: a note from outside (clipped, imported, pulled) goes to the model cleaned and delimited, and taints the run.
  const { ensureProvenanceBackfill, guardUntrusted, untrustedSourcesOfNote } = await import("../agents/untrusted");
  await ensureProvenanceBackfill();
  const untrusted: string[] = [];
  const contextStr = results.length > 0
    ? packed
        .map((r, i) => {
          const entry = `📄 [${i + 1}] ${r.path}\n${r.text}`;
          const from = untrustedSourcesOfNote(r.path, results.find((x) => x.path === r.path)?.content);
          untrusted.push(...from);
          return `---\n${from.length ? guardUntrusted(entry, from).text : entry}`;
        })
        .join("\n")
    : t("searchDialog.noRelevant");
  return { contextStr, untrusted };
}

export function renderSnippet(hit: SearchHit): React.ReactNode {
  if (!hit.snippet) return null;
  if (!hit.match) return hit.snippet;
  const { start, end } = hit.match;
  return (
    <>
      {hit.snippet.slice(0, start)}
      <mark
        style={{
          background: "hsl(var(--accent) / 0.25)",
          color: "hsl(var(--fg))",
          padding: 0,
        }}
      >
        {hit.snippet.slice(start, end)}
      </mark>
      {hit.snippet.slice(end)}
    </>
  );
}
