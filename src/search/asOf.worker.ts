/** W12.S1 — builds a throwaway BM25 index over a past vault and answers one query. */
import "../ai/workerLedgerInstall"; // first: what this worker fetches reaches the privacy ledger (plan 2.4, W10.D22)
import { searchDocs, type AsOfDoc } from "./asOfSearch";

self.addEventListener("message", (e: MessageEvent<{ docs: AsOfDoc[]; query: string; limit: number }>) => {
  try {
    self.postMessage({ hits: searchDocs(e.data.docs, e.data.query, e.data.limit) });
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
});
