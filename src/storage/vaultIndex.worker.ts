/// <reference lib="webworker" />
/**
 * The vault index worker (plan 8.4): holds the search / backlinks index
 * (./vaultIndexCore.ts) off the main thread. The main thread reads the
 * notes through the VaultBackend and sends their text here; queries come
 * back as plain results. See ./vaultIndexProtocol.ts.
 */
import "../ai/workerLedgerInstall"; // first: what this worker fetches reaches the privacy ledger (plan 2.4, W10.D22)
import { VaultIndex } from "./vaultIndexCore";
import { handleIndexRequest } from "./vaultIndexLocal";
import type { IndexProgress, IndexRequest } from "./vaultIndexProtocol";

const index = new VaultIndex();

// W11.H12: search lemmas from a lemmatizer model, only once one passed the W11.M3 rule
// (eval/public/_verdicts.json) and its runtime exists — today neither, so this ends at null.
void import("../search/lemma/lemmaIndex")
  .then((m) => m.chosenLemmatizer())
  .then((lz) => (lz ? index.useLemmatizer(lz) : undefined))
  .catch(() => {
    // why: without a lemmatizer search is BM25 over words with the rule-based morphology, as before
  });

// Requests run one after another: a snapshot restore finishes before the
// upserts sent after it (W2.22: some requests are asynchronous now).
let queue: Promise<void> = Promise.resolve();

self.onmessage = (e: MessageEvent<IndexRequest>) => {
  const req = e.data;
  queue = queue
    .then(async () => {
      // W6.36: work a request hands back runs after its answer, before the next request.
      const later: Array<() => Promise<void>> = [];
      // 2.39 (Z6-H1/M4): said right before the regex runs, from the parse that runs it; the main thread's time limit starts here.
      const onRegexStart = () => (self as unknown as Worker).postMessage({ id: req.id, progress: "regexStart" } satisfies IndexProgress);
      (self as unknown as Worker).postMessage(await handleIndexRequest(index, req, (w) => later.push(w), { onRegexStart }));
      for (const w of later) await w().catch(() => {
        // why: follow-up work of an answered request (the snapshot save) is best effort; the answer was sent
      });
    })
    .catch(() => {
      // why: a request that throws is answered by handleIndexRequest itself; the queue goes on
    });
};
