/// <reference lib="webworker" />
/**
 * Clusters and gaps off the main thread (review-13 L4): Leiden, TF-IDF and
 * the gap search take about a second for 10,000 notes, which froze the
 * graph view. The panel sends the notes, links and (optional) note
 * embeddings; the worker sends back the analysis. Pure computation: it
 * fetches nothing.
 */
import "../ai/workerLedgerInstall"; // first: what this worker fetches reaches the privacy ledger (plan 2.4, W10.D22)
import { analyzeClusters } from "./clusterGaps";
import type { ClusterRequest, ClusterResponse } from "./clusterGapsClient";

self.onmessage = (e: MessageEvent<ClusterRequest>) => {
  const { id, input, opts } = e.data;
  const post = (msg: ClusterResponse) => (self as unknown as Worker).postMessage(msg);
  try {
    post({ id, analysis: analyzeClusters(input, opts) });
  } catch (err) {
    post({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
