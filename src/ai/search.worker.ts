import { buildBM25Index, bm25Search, type BM25Index } from "./neuralSearch";

let currentIndex: BM25Index | null = null;

self.addEventListener("message", (e: MessageEvent) => {
  const data = e.data;
  
  if (data.type === "BUILD") {
    try {
      currentIndex = buildBM25Index(data.docs);
      self.postMessage({ type: "BUILT", docCount: data.docs.length, success: true });
    } catch (err: unknown) {
      self.postMessage({ type: "BUILT", success: false, error: err instanceof Error ? err.message : String(err) });
    }
  } else if (data.type === "SEARCH") {
    if (!currentIndex) {
      self.postMessage({ type: "SEARCH_RESULTS", results: [], seq: data.seq });
      return;
    }
    try {
      const results = bm25Search(data.query, currentIndex, data.topK ?? 8);
      self.postMessage({ type: "SEARCH_RESULTS", results, seq: data.seq });
    } catch (err: unknown) {
      self.postMessage({ type: "SEARCH_RESULTS", results: [], seq: data.seq, error: err instanceof Error ? err.message : String(err) });
    }
  }
});
