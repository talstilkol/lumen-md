---
title: Search reranking — measured
description: What the search reranker adds on Lumen's retrieval golden set, the decision that follows, and how to measure the model yourself.
type: how-to
tasks: ["W10.B18", "R12.16", "W7.13"]
---

Search ranks with BM25 (and, in smart search, embeddings). A **reranker**
then reorders the best candidates by reading the query and each candidate
together. Lumen has two, and **neither is on by default**: the default is the
BM25 order, because that is what measured best (below).

| Reranker | Where | Default |
|---|---|---|
| none (BM25 order) | every device | **the default** |
| built-in (lexical) | every device; Hebrew-aware word coverage blended with the retrieval rank; no download | off; opt-in setting (`lumen.ai.rerank` = `lexical`) |
| model: `bge-reranker-v2-m3` (Apache-2.0) | WebGPU browsers and the desktop app only; a one-time download of about 571 MB (q8), after you agree | off; the command "AI: Rerank search with the local model" |

`jina-reranker-v2` is not used (its licence is non-commercial), and
mMiniLM rerankers don't cover Hebrew.

## The measurement

On the retrieval golden set (plan 7.1, `eval/golden/retrieval`), HeQ dev
split — 12 Hebrew questions over 238 paragraphs, 20 BM25 candidates each,
nDCG@10:

| | nDCG@10 |
|---|---|
| BM25 alone | 1.0000 |
| BM25 + built-in reranker | 1.0000 |

BM25 already puts every answer first on this split, so no reranker can show
a gain there. That makes this split no basis for the decision.

On the **hard set** (`eval/synthetic/retrieval-hard`, a synthetic set, so these are development numbers: real HeQ test questions
changed by spelling, paraphrase and word order, over the same 238
paragraphs) BM25 is below the ceiling, and the built-in reranker makes it
**worse**:

| | dev (210 questions) | held-out (90) |
|---|---|---|
| BM25 alone | 0.9500 | 0.9521 |
| BM25 + built-in reranker | 0.9184 (−3.2) | 0.9072 (−4.5) |

So **BM25 alone is the default**, and the lexical reranker is an opt-in
setting. `src/__tests__/rerankHard.test.ts` re-measures both on every run and
fails if the default isn't the winner.

The model reranker (bge-reranker-v2-m3) **has not been measured** on this
set yet; it needs the model. It can become the default only after a Mac
measurement on this set beats BM25 by **at least 3 nDCG points on both the
dev and the held-out split**, recorded in an eval receipt
(`eval/results/rerank-<date>.json`, which records the machine):

```sh
LUMEN_EVAL_RERANK_DIRS=eval/synthetic/retrieval-hard npm run eval:rerank
```

The model is offered only where it runs fast, after consent. The cross-lingual
part (Belebele, an English question over Hebrew passages, where BM25 can't
match and a reranker might help) and the held-out test split are measured
with the model by:

```sh
npm run eval:rerank
# with the held-out split and Belebele built:
LUMEN_EVAL_RERANK_DIRS=eval/golden/retrieval/dev,<test split dir> npm run eval:rerank
```

It writes `eval/results/rerank-<date>.md` with BM25, BM25 + the model and the
gain per part, and the decision the plan's rule gives (< 5 points: off by
default).
