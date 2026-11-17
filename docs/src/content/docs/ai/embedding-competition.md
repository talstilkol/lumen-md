---
title: Choosing the Hebrew search model
description: How Lumen picks the model behind semantic search and suggested links. It runs a competition on a hard Hebrew question set, and the default changes only for a clear, measured gain.
type: how-to
tasks: ["W7.13", "W10.E53"]
---

Semantic search and suggested links depend on an *embedding model*. In 2026
three small multilingual models with open licences came out, and the old
question set could not tell them apart: plain word search (BM25) already scored
a perfect 1.0 on it.

## The hard set

300 Hebrew questions from HeQ, each rewritten the way people really ask:

| Rewrite | Example |
| --- | --- |
| paraphrase | `מתי נולד` → `באיזו שנה נולד` |
| inflection | a prefix added or dropped (`ו ה ב ל מ ש כ`), plural ↔ singular |
| spelling | full ↔ defective (`כתיב מלא/חסר`) |
| acronym | `צה״ל` ↔ `צבא ההגנה לישראל` |
| loanword | `מחשב` ↔ `קומפיוטר`, `תוכנה` ↔ `software` |

30% of the questions are held out and used only for the final decision. The
cross-lingual questions of the Hebrew→English probe are measured too.

The set is **synthetic**: the rewrites were made by rule for this project, the
cross-lingual questions were written for it, and the held-out questions are
in the repository. So it lives in `eval/synthetic/retrieval-hard`, not with
the golden sets, and every result on it is a development result. It can
choose between models, but it cannot prove a quality claim on its own.

## The candidates and the rules

The candidates are multilingual-e5-small (the current model), EmbeddingGemma 2
(also cut to 256 dimensions, which halves the index of a large vault),
Qwen3-Embedding-0.6B and, as a reranker, Qwen3-Reranker-0.6B. Each is measured
for nDCG@10, Recall@20, time per query, download size and index size.

- The set is valid only if it separates the best and worst model by at least 5 nDCG@10 points.
- The default changes only for at least **5 points** on the held-out part, and only if a query
  takes at most **150 ms** on 10,000 notes on an average computer.
- The reranker is turned on only if it adds at least **3 points**; otherwise it stays off.
- Every model needs a checked licence, a sha256 and a mirror before Lumen downloads it.

## From a run to the app

A run changes the app only through the ingest:

```bash
npm run eval:embed-compete      # writes eval/results/embed-compete-<date>.json
npm run eval:embed-ingest       # judges it, then writes src/ai/embeddingDefault.json
```

The ingest takes a run only when every row is measured on both the dev and
held-out parts, and the decision names a default with its reason. The
winner becomes the search model only when all four hold:
- the run's eval card is tagged `heldout` or `public`, on a set that is not
  synthetic (a run on `eval/synthetic/retrieval-hard` alone never changes
  the model: its numbers, the held-out part's too, are recorded as
  development numbers, and `src/ai/embeddingDefault.json` is left as it is);
- the set separated the models;
- the model's licence is verified;
- its files have a sha256.

Otherwise multilingual-e5-small stays. A winner at 256 dimensions
(`embeddinggemma-2@256`) is used at that size: the first 256 values,
renormalised. The index records the model and the size, so changing either
rebuilds it. `--check` judges a run without writing anything.
